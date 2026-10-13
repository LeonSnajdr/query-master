import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { backend } from "@/api";
import type { Profile, ProfileInput } from "@/api";
import { isDoc, scalar } from "@/shell/ejson";
import type { Doc, Json } from "@/shell/ejson";

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

function collectFields(value: Json, prefix: string, depth: number, into: Set<string>): void {
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
    /** Field paths per `connection/database/collection`; filled when the editor first asks. */
    const fields = reactive(new Map<string, string[]>());
    const fieldRequests = new Set<string>();
    /** The row of the tree the toolbar and the menus act on. */
    const selected = ref<TreeSelection>();

    async function load(): Promise<void> {
        profiles.value = await backend.listConnections();
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
        session.databases = names.map(name => session.databases.find(database => database.name === name) ?? { name, open: false, loading: false, details: {} });
        await Promise.all(session.databases.filter(database => database.open).map(database => loadCollections(id, database.name)));
    }

    async function loadCollections(id: string, name: string): Promise<void> {
        const database = sessions[id]?.databases.find(item => item.name === name);
        if (!database) return;
        database.loading = true;
        try {
            const page = await backend.runCursorCommand(id, name, { listCollections: 1, nameOnly: true }, 10_000);
            database.collections = page.documents.map(collection => String(collection.name)).sort((a, b) => a.localeCompare(b));
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
        connecting.add(id);
        try {
            const info = await backend.connect(id);
            sessions[id] = { version: info.version, databases: [], open: true };
            await loadDatabases(id);
        } finally {
            connecting.delete(id);
        }
    }

    async function disconnect(id: string): Promise<void> {
        if (!sessions[id]) return;
        delete sessions[id];
        if (selected.value?.connectionId === id) selected.value = undefined;
        for (const key of [...fields.keys()]) if (key.startsWith(`${id}/`)) fields.delete(key);
        await backend.disconnect(id);
    }

    /** The collections of a database as far as known, loading them if they are not. */
    function collectionsOf(id: string, name: string): string[] {
        const database = sessions[id]?.databases.find(item => item.name === name);
        if (database && !database.collections && !database.loading) void loadCollections(id, name).catch(() => undefined);
        return database?.collections ?? [];
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

    return { profiles, sessions, connecting, selected, load, save, remove, connect, disconnect, loadDatabases, loadCollections, loadIndexes, collectionsOf, fieldsOf };
});
