import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import { backend } from "@/api";
import type { Profile, ProfileInput } from "@/api";
import { isDoc, scalar } from "@/shell/ejson";
import type { Doc, Json } from "@/shell/ejson";
import { useNotesStore } from "@/stores/notes";

/** What the tree knows about a collection once it was unfolded. */
export interface CollectionDetail {
    open: boolean;
    loading: boolean;
    /** As `listIndexes` gives them. */
    indexes?: Doc[];
}

export interface DatabaseNode {
    name: string;
    /** Absent until the database was opened in the tree. */
    collections?: string[];
    /** `collection`, `view` or `timeseries`, per collection, as `listCollections` says. */
    types: Record<string, string>;
    /** Per collection that was unfolded: its indexes. */
    details: Record<string, CollectionDetail>;
    open: boolean;
    loading: boolean;
}

/** An open connection. */
export interface Session {
    /** Version of the server, for example `8.0.4`. */
    version: string;
    databases: DatabaseNode[];
    open: boolean;
}

/** What is selected in the tree: a connection, a database of it, or a collection of that. */
export interface TreeSelection {
    connectionId: string;
    database?: string;
    collection?: string;
    /** Name of an index of the collection. */
    index?: string;
}

/** Documents looked at to learn the fields of a collection. */
const FIELD_SAMPLE = 50;
/** Sub documents are followed this deep. */
const FIELD_DEPTH = 4;

/** The field paths of a document (and of documents in its arrays), a few levels deep. */
export function collectFields(value: Json, prefix: string, depth: number, into: Set<string>): void {
    if (Array.isArray(value)) {
        // The fields of the documents in an array count for the array's path.
        for (const item of value.slice(0, 5)) if (isDoc(item) && !scalar(item)) collectFields(item, prefix, depth, into);
        return;
    }
    if (!isDoc(value) || scalar(value) || depth > FIELD_DEPTH) return;
    for (const [key, item] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        into.add(path);
        collectFields(item, path, depth + 1, into);
    }
}

export const useConnectionsStore = defineStore("connections", () => {
    const profiles = ref<Profile[]>([]);
    const sessions = reactive<Record<string, Session>>({});
    /** Connections being opened. */
    const connecting = reactive(new Set<string>());
    /**
     * Connections that could not be opened, with the reason. they stay in the
     * tree (with a red mark) until they are connected again or closed.
     */
    const failed = reactive(new Map<string, unknown>());
    /** Field paths per `connection/database/collection`; filled when the editor first asks. */
    const fields = reactive(new Map<string, string[]>());
    const fieldRequests = new Set<string>();
    /** The row of the tree the toolbar and the menus act on. */
    const selected = ref<TreeSelection>();

    /** Connections made from a string that is not saved; they go with `disconnect`. */
    const transient: Profile[] = [];
    /** The typed string of each of them, to connect again after a failure. */
    const transientUris = new Map<string, string>();

    /** Whether a connection shows in the tree: open, being opened, or failed. */
    function inTree(id: string): boolean {
        return sessions[id] !== undefined || connecting.has(id) || failed.has(id);
    }

    async function load(): Promise<void> {
        profiles.value = [...await backend.listConnections(), ...transient];
    }

    /** The saved connections, without those from a typed string. */
    const saved = computed(() => profiles.value.filter(profile => !isTransient(profile.id)));

    function isTransient(id: string): boolean {
        return transient.some(profile => profile.id === id);
    }

    /** "Connect from URI": connects without saving anything; the tree shows the address. */
    async function connectUri(uri: string): Promise<string> {
        const id = crypto.randomUUID();
        // Shown in the tree right away, under the address as far as it can be read without the server.
        const address = uri.trim().replace(/\/\/[^@/]*@/, "//").split("?")[0]!;
        transient.push({ id, name: address.replace(/^mongodb(\+srv)?:\/\//, ""), address });
        transientUris.set(id, uri);
        await load();
        selected.value = { connectionId: id };
        await open(id, () => backend.connectUri(id, uri));
        return id;
    }

    /**
     * Opens a connection. Its row is in the tree from the start; a failure leaves it there,
     * marked, and is thrown. Closed while it was being opened, the new session is closed again.
     */
    async function open(id: string, start: () => Promise<{ version: string }>): Promise<void> {
        failed.delete(id);
        connecting.add(id);
        try {
            const info = await start();
            if (!connecting.has(id)) {
                await backend.disconnect(id);
                return;
            }
            sessions[id] = { version: info.version, databases: [], open: true };
            // Read-only marks must be known before anything can be written.
            if (!isTransient(id)) await useNotesStore().load(id);
            await loadDatabases(id);
        } catch (error) {
            // Closed meanwhile: nobody waits for this connection any more.
            if (!connecting.has(id)) return;
            if (!sessions[id]) failed.set(id, error);
            throw error;
        } finally {
            connecting.delete(id);
        }
    }

    async function save(input: ProfileInput): Promise<Profile> {
        const profile = await backend.saveConnection(input);
        await load();
        return profile;
    }

    async function remove(id: string): Promise<void> {
        await disconnect(id);
        await backend.deleteConnection(id);
        await load();
    }

    async function loadDatabases(id: string): Promise<void> {
        const session = sessions[id];
        if (!session) return;
        let names: string[];
        try {
            const reply = await backend.runCommand(id, "admin", { listDatabases: 1, nameOnly: true });
            names = (reply.databases as Doc[]).map(database => String(database.name)).sort((a, b) => a.localeCompare(b));
        } catch (error) {
            // A user who may not list databases still sees the one their connection string names.
            const named = /^[^/]+\/\/[^/]+\/([^/?]+)/.exec(profiles.value.find(profile => profile.id === id)?.address ?? "")?.[1];
            if (!named) throw error;
            names = [decodeURIComponent(named)];
        }
        session.databases = names.map(name => session.databases.find(database => database.name === name) ?? { name, open: false, loading: false, details: {}, types: {} });
        await Promise.all(session.databases.filter(database => database.open).map(database => loadCollections(id, database.name)));
    }

    async function loadCollections(id: string, name: string): Promise<void> {
        const database = sessions[id]?.databases.find(item => item.name === name);
        if (!database) return;
        database.loading = true;
        try {
            const page = await backend.runCursorCommand(id, name, { listCollections: 1, nameOnly: true }, 10_000);
            database.collections = page.documents.map(collection => String(collection.name)).sort((a, b) => a.localeCompare(b));
            database.types = Object.fromEntries(page.documents.map(collection => [String(collection.name), String(collection.type ?? "collection")]));
            await Promise.all(Object.entries(database.details).filter(([, detail]) => detail.open).map(([collection]) => loadIndexes(id, name, collection)));
        } finally {
            database.loading = false;
        }
    }

    /** Reads the indexes of a collection for the tree. */
    async function loadIndexes(id: string, name: string, collection: string): Promise<void> {
        const database = sessions[id]?.databases.find(item => item.name === name);
        if (!database) return;
        const detail = database.details[collection] ??= { open: false, loading: false };
        detail.loading = true;
        try {
            detail.indexes = (await backend.runCursorCommand(id, name, { listIndexes: collection }, 1000)).documents;
        } finally {
            detail.loading = false;
        }
    }

    async function connect(id: string): Promise<void> {
        await open(id, () => backend.connect(id));
    }

    /** Tries a connection again that is open, failed or still being opened. */
    async function reconnect(id: string): Promise<void> {
        const uri = transientUris.get(id);
        if (sessions[id]) {
            delete sessions[id];
            for (const key of [...fields.keys()]) if (key.startsWith(`${id}/`)) fields.delete(key);
        }
        connecting.delete(id);
        await open(id, () => (uri === undefined ? backend.connect(id) : backend.connectUri(id, uri)));
    }

    async function disconnect(id: string): Promise<void> {
        const wasOpen = sessions[id] !== undefined;
        failed.delete(id);
        // A connection still being opened is closed as soon as it is (see `open`).
        connecting.delete(id);
        if (selected.value?.connectionId === id) selected.value = undefined;
        if (!wasOpen) {
            dropTransient(id);
            return;
        }
        delete sessions[id];
        for (const key of [...fields.keys()]) if (key.startsWith(`${id}/`)) fields.delete(key);
        await backend.disconnect(id);
        dropTransient(id);
    }

    /** Nothing was saved for a connection from a typed string: once closed, it is gone. */
    function dropTransient(id: string): void {
        const index = transient.findIndex(profile => profile.id === id);
        if (index === -1) return;
        transient.splice(index, 1);
        transientUris.delete(id);
        profiles.value = profiles.value.filter(profile => profile.id !== id);
    }

    /** The collections of a database as far as known, loading them if they are not. */
    function collectionsOf(id: string, name: string): string[] {
        const database = sessions[id]?.databases.find(item => item.name === name);
        if (database && !database.collections && !database.loading) void loadCollections(id, name).catch(() => undefined);
        return database?.collections ?? [];
    }

    /** Folds every connection, database and collection of the tree. */
    function collapseAll(): void {
        for (const session of Object.values(sessions)) {
            session.open = false;
            for (const database of session.databases) {
                database.open = false;
                for (const detail of Object.values(database.details)) detail.open = false;
            }
        }
    }

    /** The field paths of a collection as far as known; a sample is read on the first call. */
    function fieldsOf(id: string, database: string, collection: string): string[] {
        const key = `${id}/${database}/${collection}`;
        if (!fields.has(key) && !fieldRequests.has(key) && sessions[id]) {
            fieldRequests.add(key);
            backend.runCursorCommand(id, database, { aggregate: collection, pipeline: [{ $sample: { size: FIELD_SAMPLE } }], cursor: {} }, FIELD_SAMPLE)
                .then((page) => {
                    const found = new Set<string>();
                    for (const document of page.documents) collectFields(document, "", 1, found);
                    fields.set(key, [...found].sort((a, b) => a.localeCompare(b)));
                })
                // A view that can not be sampled, or missing rights: then no fields are suggested.
                .catch(() => fields.set(key, []))
                .finally(() => fieldRequests.delete(key));
        }
        return fields.get(key) ?? [];
    }

    return { profiles, saved, sessions, connecting, failed, selected, inTree, load, save, remove, connect, reconnect, connectUri, isTransient, disconnect, loadDatabases, loadCollections, loadIndexes, collectionsOf, fieldsOf, collapseAll };
});
