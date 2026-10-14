import { useNotifications } from "@vuetify/v0";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { backend } from "@/api";
import type { Profile } from "@/api";
import { useDialogs } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";
import type { Doc } from "@/shell/ejson";
import { toShell } from "@/shell/ejson";
import { replyError } from "@/shell/plan";
import { useConnectionsStore } from "@/stores/connections";
import type { TreeSelection } from "@/stores/connections";
import { useTabsStore } from "@/stores/tabs";

/** The script behind "Collections statistics"; views have no storage and are left out. */
const COLLECTIONS_STATS = `// Sizes in bytes, as the server counts them.
db.getCollectionInfos({ type: "collection" }).map(info => {
    const stats = db.getCollection(info.name).stats();
    return {
        name: info.name,
        documents: stats.count,
        size: stats.size,
        averageSize: stats.avgObjSize,
        storageSize: stats.storageSize,
        indexes: stats.nindexes,
        indexSize: stats.totalIndexSize
    };
}).sort((a, b) => a.name.localeCompare(b.name))`;

/**
 * What the menus, the toolbar of the dock and the keyboard shortcuts do. They act on the row
 * selected in the tree; without one, on what the active tab shows.
 */
export function useActions() {
    const { t } = useI18n();
    const { say, report } = useMessages();
    const notifications = useNotifications();
    const dialogs = useDialogs();
    const connections = useConnectionsStore();
    const tabs = useTabsStore();

    const target = computed<TreeSelection | undefined>(() => {
        if (connections.selected) return connections.selected;
        const tab = tabs.active;
        return tab && tab.kind !== "start" ? { connectionId: tab.connectionId, database: tab.database, collection: tab.collection } : undefined;
    });
    const hasConnection = computed(() => target.value !== undefined && connections.sessions[target.value.connectionId] !== undefined);
    const hasDatabase = computed(() => hasConnection.value && target.value?.database !== undefined);
    const hasCollection = computed(() => hasDatabase.value && target.value?.collection !== undefined);

    /** Runs a command and reloads the tree; errors go to a toast. */
    async function command(connectionId: string, database: string, document: Doc): Promise<boolean> {
        try {
            const failure = replyError(await backend.runCommand(connectionId, database, document));
            if (failure) throw new Error(say(failure));
            await connections.loadDatabases(connectionId);
            return true;
        } catch (error) {
            report(error);
            return false;
        }
    }

    function openShell(at = target.value) {
        if (!at) return;
        const database = at.database ?? connections.sessions[at.connectionId]?.databases[0]?.name ?? "test";
        tabs.openShell({ connectionId: at.connectionId, database, collection: at.collection });
    }

    function browse(at = target.value) {
        if (at?.database !== undefined && at.collection !== undefined) {
            tabs.openBrowse({ connectionId: at.connectionId, database: at.database, collection: at.collection });
        }
    }

    /** A shell with the frame of a pipeline for the collection. */
    function aggregation(at = target.value) {
        if (at?.database === undefined || at.collection === undefined) return;
        const text = `db.getCollection(${JSON.stringify(at.collection)}).aggregate([\n    { $match: { } }\n])`;
        tabs.openShell({ connectionId: at.connectionId, database: at.database, text });
    }

    /** A shell that runs one statement right away (statistics, server status …). */
    function inspect(at: TreeSelection, database: string, text: string) {
        const tab = tabs.openShell({ connectionId: at.connectionId, database, text });
        void tabs.run(tab, 0);
    }

    function collectionStats(at = target.value) {
        if (at?.database !== undefined && at.collection !== undefined) inspect(at, at.database, `db.getCollection(${JSON.stringify(at.collection)}).stats()`);
    }

    function databaseStats(at = target.value) {
        if (at?.database !== undefined) inspect(at, at.database, "db.stats()");
    }

    /** One row per collection of the database: documents, sizes, indexes; shown as a table. */
    function collectionsStats(at = target.value) {
        if (at?.database === undefined) return;
        const tab = tabs.openShell({ connectionId: at.connectionId, database: at.database, text: COLLECTIONS_STATS });
        tab.view = "table";
        void tabs.run(tab, 0, undefined, true);
    }

    function serverStatus(at = target.value) {
        if (at) inspect(at, "admin", "db.serverStatus()");
    }

    function indexes(at = target.value) {
        if (at?.database !== undefined && at.collection !== undefined) inspect(at, at.database, `db.getCollection(${JSON.stringify(at.collection)}).getIndexes()`);
    }

    function createCollection(at = target.value) {
        if (at?.database !== undefined) dialogs.editCollection({ mode: "collection", connectionId: at.connectionId, database: at.database });
    }

    function createView(at = target.value) {
        if (at?.database !== undefined) dialogs.editCollection({ mode: "view", connectionId: at.connectionId, database: at.database, collection: at.collection });
    }

    function editValidator(at = target.value) {
        if (at?.database !== undefined && at.collection !== undefined) {
            dialogs.editCollection({ mode: "validator", connectionId: at.connectionId, database: at.database, collection: at.collection });
        }
    }

    /** A database comes into being with its first collection. */
    async function createDatabase(at = target.value) {
        if (!at) return;
        const database = await dialogs.ask({ title: t("database.create.title"), label: t("database.name"), action: t("action.next") });
        if (!database) return;
        const name = await dialogs.ask({ title: t("database.create.collection", { database }), label: t("collection.name"), action: t("action.create") });
        if (name) await command(at.connectionId, database, { create: name });
    }

    async function renameCollection(at = target.value) {
        if (at?.database === undefined || at.collection === undefined) return;
        const name = await dialogs.ask({ title: t("collection.rename.title"), label: t("collection.name"), value: at.collection, action: t("action.rename") });
        if (!name || name === at.collection) return;
        const done = await command(at.connectionId, "admin", { renameCollection: `${at.database}.${at.collection}`, to: `${at.database}.${name}` });
        if (done) connections.selected = { ...at, collection: name };
    }

    async function dropCollection(at = target.value) {
        if (at?.database === undefined || at.collection === undefined) return;
        const confirmed = await dialogs.confirm({
            title: t("collection.drop.title"),
            text: t("collection.drop.text", { name: at.collection, database: at.database }),
            action: t("action.drop")
        });
        if (confirmed && await command(at.connectionId, at.database, { drop: at.collection })) connections.selected = { connectionId: at.connectionId, database: at.database };
    }

    async function dropDatabase(at = target.value) {
        if (at?.database === undefined) return;
        const confirmed = await dialogs.confirm({ title: t("database.drop.title"), text: t("database.drop.text", { name: at.database }), action: t("action.drop") });
        if (confirmed && await command(at.connectionId, at.database, { dropDatabase: 1 })) connections.selected = { connectionId: at.connectionId };
    }

    function createIndex(at = target.value) {
        if (at?.database !== undefined && at.collection !== undefined) {
            dialogs.editIndex({ connectionId: at.connectionId, database: at.database, collection: at.collection });
        }
    }

    /** The index the selection points at, as `listIndexes` gave it. */
    function indexOf(at: TreeSelection | undefined): Doc | undefined {
        if (at?.database === undefined || at.collection === undefined || at.index === undefined) return undefined;
        const database = connections.sessions[at.connectionId]?.databases.find(item => item.name === at.database);
        return database?.details[at.collection]?.indexes?.find(item => item.name === at.index);
    }

    /** The dialog filled with an existing index, to create one like it. */
    function duplicateIndex(at = target.value) {
        const index = indexOf(at);
        if (index && at?.database !== undefined && at.collection !== undefined) {
            dialogs.editIndex({ connectionId: at.connectionId, database: at.database, collection: at.collection, index });
        }
    }

    function indexInfo(at = target.value) {
        const index = indexOf(at);
        if (index && at?.index !== undefined) dialogs.showText({ title: t("index.info", { name: at.index }), text: toShell(index) });
    }

    /** A hidden index is kept up to date but not used by queries (MongoDB 4.4 and later). */
    async function toggleIndexHidden(at = target.value) {
        const index = indexOf(at);
        if (!index || at?.database === undefined || at.collection === undefined || at.index === undefined) return;
        const hidden = index.hidden !== true;
        if (await command(at.connectionId, at.database, { collMod: at.collection, index: { name: at.index, hidden } })) {
            await connections.loadIndexes(at.connectionId, at.database, at.collection).catch(report);
            notifications.send({ subject: t(hidden ? "index.hidden" : "index.shown", { name: at.index }), timeout: 3000 });
        }
    }

    async function dropIndex(at = target.value) {
        if (at?.database === undefined || at.collection === undefined || at.index === undefined) return;
        const confirmed = await dialogs.confirm({
            title: t("index.drop.title"),
            text: t("index.drop.text", { name: at.index, collection: at.collection }),
            action: t("action.drop")
        });
        if (confirmed && await command(at.connectionId, at.database, { dropIndexes: at.collection, index: at.index })) {
            connections.selected = { connectionId: at.connectionId, database: at.database, collection: at.collection };
        }
    }

    async function refresh(at = target.value) {
        if (at) await connections.loadDatabases(at.connectionId).catch(report);
    }

    async function connect(profile: Profile) {
        const session = connections.sessions[profile.id];
        if (session) session.open = true;
        else await connections.connect(profile.id).catch(report);
        connections.selected = { connectionId: profile.id };
    }

    async function disconnect(at = target.value) {
        if (!at) return;
        tabs.closeConnection(at.connectionId);
        await connections.disconnect(at.connectionId).catch(report);
    }

    async function viewUri(at = target.value) {
        if (!at) return;
        try {
            dialogs.showText({ title: t("connection.uri.title"), text: await backend.connectionUri(at.connectionId) });
        } catch (error) {
            report(error);
        }
    }

    function connectionSettings(at = target.value) {
        const profile = connections.profiles.find(item => item.id === at?.connectionId);
        if (profile) dialogs.editConnection(profile);
    }

    async function deleteConnection(profile: Profile) {
        const confirmed = await dialogs.confirm({
            title: t("connection.delete.title"),
            text: t("connection.delete.text", { name: profile.name }),
            action: t("action.delete")
        });
        if (!confirmed) return;
        tabs.closeConnection(profile.id);
        await connections.remove(profile.id).catch(report);
    }

    return {
        target, hasConnection, hasDatabase, hasCollection,
        openShell, browse, aggregation, collectionStats, databaseStats, collectionsStats, serverStatus, indexes,
        createCollection, createView, editValidator, createDatabase, renameCollection, dropCollection, dropDatabase, createIndex, duplicateIndex, toggleIndexHidden, dropIndex, indexInfo, indexOf,
        refresh, connect, disconnect, viewUri, connectionSettings, deleteConnection,
        newConnection: () => dialogs.editConnection()
    };
}
