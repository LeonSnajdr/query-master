import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { backend } from "@/api";
import type { Profile } from "@/api";
import { useDialogs } from "@/composables/dialogs";
import { useExportWizard } from "@/composables/exportWizard";
import { useImportWizard } from "@/composables/importWizard";
import { useMessages } from "@/composables/messages";
import { useNotices } from "@/composables/notices";
import type { Doc } from "@/shell/ejson";
import { toShell } from "@/shell/ejson";
import { bucketIndexes } from "@/shell/gridfs";
import { ShellError } from "@/shell/message";
import { replyError } from "@/shell/plan";
import { useConnectionsStore } from "@/stores/connections";
import type { TreeSelection } from "@/stores/connections";
import { useNotesStore } from "@/stores/notes";
import { folderLabel, parentFolder } from "@/tree/folders";
import { isQueryTab, useTabsStore } from "@/stores/tabs";

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
    const notices = useNotices();
    const dialogs = useDialogs();
    const connections = useConnectionsStore();
    const notes = useNotesStore();
    const tabs = useTabsStore();
    const wizardOf = useExportWizard();
    const importOf = useImportWizard();

    const target = computed<TreeSelection | undefined>(() => {
        if (connections.selected) return connections.selected;
        const tab = tabs.active;
        if (tab?.kind === "server") return { connectionId: tab.connectionId };
        return isQueryTab(tab) ? { connectionId: tab.connectionId, database: tab.database, collection: tab.collection } : undefined;
    });
    const hasConnection = computed(() => target.value !== undefined && connections.sessions[target.value.connectionId] !== undefined);
    const hasDatabase = computed(() => hasConnection.value && target.value?.database !== undefined);
    const hasCollection = computed(() => hasDatabase.value && target.value?.collection !== undefined);

    /**
     * Whether the row may be changed; a row marked read-only in the tree, or one below such a row,
     * may not, and a toast says so.
     */
    function writable(at: TreeSelection): boolean {
        if (!notes.isReadonly(at)) return true;
        const name = [at.database, at.collection].filter(part => part !== undefined).join(".");
        report(new ShellError("error.plan.readonlyTree", { name: name || (connections.profiles.find(profile => profile.id === at.connectionId)?.name ?? "") }));
        return false;
    }

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

    /** The aggregation builder on the collection. */
    function aggregation(at = target.value) {
        if (at?.database !== undefined && at.collection !== undefined) {
            tabs.openAggregate({ connectionId: at.connectionId, database: at.database, collection: at.collection });
        }
    }

    /** The SQL builder on the database, starting with a SELECT on the collection if one is chosen. */
    function openSql(at = target.value) {
        if (!at) return;
        const database = at.database ?? connections.sessions[at.connectionId]?.databases[0]?.name ?? "test";
        tabs.openSql({ connectionId: at.connectionId, database, collection: at.collection });
    }

    /** The export wizard with the rows of the selection: the server's, a database's, one collection or several. */
    async function exportWizard(at: TreeSelection | TreeSelection[] | undefined = target.value, filter?: string) {
        if (at) await wizardOf.openExport(at, filter);
    }

    /** The import wizard on the server of the selection; a collection chosen there takes every file. */
    function importWizard(at = target.value) {
        void importOf.openImport(at);
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
        if (at) tabs.openServer(at.connectionId, "status");
    }

    function serverLog(at = target.value) {
        if (at) tabs.openServer(at.connectionId, "log");
    }

    /** Users and roles belong to a database; without one chosen, to `admin`. */
    function manageUsers(at = target.value) {
        if (at) tabs.openServer(at.connectionId, "users", at.database ?? "admin");
    }

    function manageRoles(at = target.value) {
        if (at) tabs.openServer(at.connectionId, "roles", at.database ?? "admin");
    }

    /** The files of a GridFS bucket in a tab of their own. */
    function openGridFs(at: TreeSelection, bucket: string) {
        if (at.database !== undefined) tabs.openServer(at.connectionId, "gridfs", at.database, bucket);
    }

    /** A bucket is two collections with the indexes the drivers expect; files come by upload. */
    async function createBucket(at = target.value) {
        if (at?.database === undefined || !writable({ connectionId: at.connectionId, database: at.database })) return;
        const name = await dialogs.ask({ title: t("gridfs.create.title"), label: t("gridfs.create.label"), value: "fs", action: t("action.create") });
        if (!name) return;
        for (const { command: create } of bucketIndexes(name)) {
            if (!await command(at.connectionId, at.database, create)) return;
        }
        openGridFs(at, name);
    }

    function indexes(at = target.value) {
        if (at?.database !== undefined && at.collection !== undefined) inspect(at, at.database, `db.getCollection(${JSON.stringify(at.collection)}).getIndexes()`);
    }

    function createCollection(at = target.value) {
        if (at?.database !== undefined && writable({ connectionId: at.connectionId, database: at.database })) {
            dialogs.editCollection({ mode: "collection", connectionId: at.connectionId, database: at.database });
        }
    }

    function createView(at = target.value) {
        if (at?.database !== undefined && writable({ connectionId: at.connectionId, database: at.database })) {
            dialogs.editCollection({ mode: "view", connectionId: at.connectionId, database: at.database, collection: at.collection });
        }
    }

    function editValidator(at = target.value) {
        if (at?.database !== undefined && at.collection !== undefined && writable(at)) {
            dialogs.editCollection({ mode: "validator", connectionId: at.connectionId, database: at.database, collection: at.collection });
        }
    }

    /** A database comes into being with its first collection. */
    async function createDatabase(at = target.value) {
        if (!at || !writable({ connectionId: at.connectionId })) return;
        const database = await dialogs.ask({ title: t("database.create.title"), label: t("database.name"), action: t("action.next") });
        if (!database) return;
        const name = await dialogs.ask({ title: t("database.create.collection", { database }), label: t("collection.name"), action: t("action.create") });
        if (name) await command(at.connectionId, database, { create: name });
    }

    async function renameCollection(at = target.value) {
        if (at?.database === undefined || at.collection === undefined || !writable(at)) return;
        const name = await dialogs.ask({ title: t("collection.rename.title"), label: t("collection.name"), value: at.collection, action: t("action.rename") });
        if (!name || name === at.collection) return;
        const done = await command(at.connectionId, "admin", { renameCollection: `${at.database}.${at.collection}`, to: `${at.database}.${name}` });
        if (!done) return;
        connections.selected = { ...at, collection: name };
        // The color, comment and read-only mark go with the collection.
        await notes.rename(at.connectionId, `${at.database}/${at.collection}`, `${at.database}/${name}`).catch(report);
    }

    async function dropCollection(at = target.value) {
        if (at?.database === undefined || at.collection === undefined || !writable(at)) return;
        const confirmed = await dialogs.confirm({
            title: t("collection.drop.title"),
            text: t("collection.drop.text", { name: at.collection, database: at.database }),
            action: t("action.drop")
        });
        if (!confirmed || !await command(at.connectionId, at.database, { drop: at.collection })) return;
        connections.selected = { connectionId: at.connectionId, database: at.database };
        await notes.remove(at.connectionId, `${at.database}/${at.collection}`).catch(report);
    }

    async function dropDatabase(at = target.value) {
        if (at?.database === undefined || !writable({ connectionId: at.connectionId, database: at.database })) return;
        const confirmed = await dialogs.confirm({ title: t("database.drop.title"), text: t("database.drop.text", { name: at.database }), action: t("action.drop") });
        if (!confirmed || !await command(at.connectionId, at.database, { dropDatabase: 1 })) return;
        connections.selected = { connectionId: at.connectionId };
        await notes.remove(at.connectionId, at.database).catch(report);
    }

    function createIndex(at = target.value) {
        if (at?.database !== undefined && at.collection !== undefined && writable(at)) {
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
        if (index && at?.database !== undefined && at.collection !== undefined && writable(at)) {
            dialogs.editIndex({ connectionId: at.connectionId, database: at.database, collection: at.collection, index });
        }
    }

    /** The dialog filled with an index; saving drops it and creates it as the dialog says. */
    function recreateIndex(at = target.value) {
        const index = indexOf(at);
        if (index && at?.database !== undefined && at.collection !== undefined && at.index !== "_id_" && writable(at)) {
            dialogs.editIndex({ connectionId: at.connectionId, database: at.database, collection: at.collection, index, recreate: true });
        }
    }

    function indexInfo(at = target.value) {
        const index = indexOf(at);
        if (index && at?.index !== undefined) dialogs.showText({ title: t("index.info", { name: at.index }), text: toShell(index) });
    }

    /** A hidden index is kept up to date but not used by queries (MongoDB 4.4 and later). */
    async function toggleIndexHidden(at = target.value) {
        const index = indexOf(at);
        if (!index || at?.database === undefined || at.collection === undefined || at.index === undefined || !writable(at)) return;
        const hidden = index.hidden !== true;
        if (await command(at.connectionId, at.database, { collMod: at.collection, index: { name: at.index, hidden } })) {
            await connections.loadIndexes(at.connectionId, at.database, at.collection).catch(report);
            notices.answer(t(hidden ? "index.hidden" : "index.shown", { name: at.index }));
        }
    }

    async function dropIndex(at = target.value) {
        if (at?.database === undefined || at.collection === undefined || at.index === undefined || !writable(at)) return;
        const confirmed = await dialogs.confirm({
            title: t("index.drop.title"),
            text: t("index.drop.text", { name: at.index, collection: at.collection }),
            action: t("action.drop")
        });
        if (confirmed && await command(at.connectionId, at.database, { dropIndexes: at.collection, index: at.index })) {
            connections.selected = { connectionId: at.connectionId, database: at.database, collection: at.collection };
        }
    }

    /** The row the notes are about: indexes carry none, their collection does. */
    function notePlace(at: TreeSelection) {
        return { connectionId: at.connectionId, database: at.database, collection: at.collection };
    }

    async function setColor(at: TreeSelection, color: string | null) {
        await notes.change(notePlace(at), { color }).catch(report);
    }

    async function editComment(at = target.value) {
        if (!at) return;
        const current = notes.noteOf(notePlace(at))?.comment ?? "";
        const comment = await dialogs.ask({ title: t("note.comment.title"), label: t("note.comment.label"), value: current, action: t("action.save") });
        if (comment !== undefined) await notes.change(notePlace(at), { comment }).catch(report);
    }

    async function removeComment(at = target.value) {
        if (at) await notes.change(notePlace(at), { comment: null }).catch(report);
    }

    async function toggleReadonly(at = target.value) {
        if (!at) return;
        const readonly = notes.noteOf(notePlace(at))?.readonly !== true;
        await notes.change(notePlace(at), { readonly }).catch(report);
    }

    /**
     * A folder to group rows in the tree; the server knows nothing of it. On a connection it groups
     * databases, on a database (or a collection in it) the collections of that database.
     */
    async function addFolder(at = target.value, parent?: string) {
        if (!at) return;
        const name = await askFolderName({ title: t(parent === undefined ? "folder.add" : "folder.addInside"), label: t("folder.name"), action: t("action.create") });
        if (name) await notes.addFolder(at.connectionId, at.database ?? "", parent === undefined ? name : `${parent}/${name}`).catch(report);
    }

    /** A name for a folder; `/` separates folders in folders, so it is not part of a name. */
    async function askFolderName(request: Parameters<typeof dialogs.ask>[0]): Promise<string | undefined> {
        const name = (await dialogs.ask(request))?.trim();
        if (name?.includes("/")) {
            report(new ShellError("error.folder.slash"));
            return undefined;
        }
        return name || undefined;
    }

    /** `at.database` is the database of a folder of collections, absent for a folder of databases. */
    async function renameFolder(at: TreeSelection, folder: string) {
        const label = folderLabel(folder);
        const name = await askFolderName({ title: t("folder.rename"), label: t("folder.name"), value: label, action: t("action.rename") });
        const parent = parentFolder(folder);
        if (name && name !== label) await notes.renameFolder(at.connectionId, at.database ?? "", folder, parent === undefined ? name : `${parent}/${name}`).catch(report);
    }

    /** Puts a folder into another one (`undefined`: to the top), with all in it. */
    async function moveFolder(at: TreeSelection, folder: string, into: string | undefined) {
        try {
            if (!await notes.moveFolder(at.connectionId, at.database ?? "", folder, into)) report(new ShellError("error.folder.intoItself"));
        } catch (error) {
            report(error);
        }
    }

    /** The folder goes with those in it; what lay in them moves to the folder around it, or out of all. */
    async function deleteFolder(at: TreeSelection, folder: string) {
        const text = t(at.database === undefined ? "folder.delete.databases" : "folder.delete.text", { name: folder });
        const confirmed = await dialogs.confirm({ title: t("folder.delete.title"), text, action: t("action.delete") });
        if (confirmed) await notes.deleteFolder(at.connectionId, at.database ?? "", folder).catch(report);
    }

    async function moveToFolder(at: TreeSelection, folder: string | null) {
        await notes.change(notePlace(at), { folder }).catch(report);
    }

    /**
     * What a multiple selection in the tree does: each action takes rows of one kind, which the
     * tree only selects together when they are of one connection (indexes: of one collection).
     * Dropping asks once for all of them; a row that fails is reported and the others go on.
     */
    function namesOf(rows: TreeSelection[]): string {
        const names = rows.map(row => row.index ?? row.collection ?? row.database ?? connections.profiles.find(profile => profile.id === row.connectionId)?.name ?? "");
        const shown = names.slice(0, 8).join(", ");
        return names.length > 8 ? `${shown} ${t("tree.more", { count: names.length - 8 })}` : shown;
    }

    async function dropMany(rows: TreeSelection[]) {
        const first = rows[0];
        if (!first || !rows.every(writable)) return;
        const kind = first.index !== undefined ? "index" : first.collection !== undefined ? "collection" : "database";
        const confirmed = await dialogs.confirm({
            title: t(`${kind}.dropMany.title`, { count: rows.length }),
            text: t(`${kind}.dropMany.text`, { count: rows.length, names: namesOf(rows) }),
            action: t("action.drop")
        });
        if (!confirmed) return;
        let dropped = 0;
        for (const row of rows) {
            const document: Doc = kind === "index" ? { dropIndexes: row.collection!, index: row.index! } : kind === "collection" ? { drop: row.collection! } : { dropDatabase: 1 };
            try {
                const failure = replyError(await backend.runCommand(row.connectionId, row.database!, document));
                if (failure) throw new Error(`${row.index ?? row.collection ?? row.database}: ${say(failure)}`);
                dropped++;
                if (kind !== "index") await notes.remove(row.connectionId, kind === "collection" ? `${row.database}/${row.collection}` : row.database!).catch(report);
            } catch (error) {
                report(error);
            }
        }
        connections.selected = kind === "index" ? { connectionId: first.connectionId, database: first.database, collection: first.collection } : kind === "collection" ? { connectionId: first.connectionId, database: first.database } : { connectionId: first.connectionId };
        if (kind === "index") await connections.loadIndexes(first.connectionId, first.database!, first.collection!).catch(report);
        else await connections.loadDatabases(first.connectionId).catch(report);
        if (dropped > 0) notices.answer(t("tree.dropped", { count: dropped }, dropped));
    }

    /** Each collection in a tab of its own, as a double click on each would. */
    function browseMany(rows: TreeSelection[]) {
        for (const row of rows) browse(row);
    }

    async function setColorMany(rows: TreeSelection[], color: string | null) {
        for (const row of rows) await setColor(row, color);
    }

    /** Read-only for all when one of them is not yet, else off for all. */
    async function toggleReadonlyMany(rows: TreeSelection[]) {
        const readonly = !rows.every(row => notes.noteOf(notePlace(row))?.readonly === true);
        for (const row of rows) await notes.change(notePlace(row), { readonly }).catch(report);
    }

    async function moveManyToFolder(rows: TreeSelection[], folder: string | null) {
        for (const row of rows) await moveToFolder(row, folder);
    }

    async function toggleIndexesHidden(rows: TreeSelection[], hidden: boolean) {
        const first = rows[0];
        if (first?.database === undefined || first.collection === undefined || !rows.every(writable)) return;
        for (const row of rows) {
            if (row.index === "_id_") continue;
            const failure = replyError(await backend.runCommand(row.connectionId, row.database!, { collMod: row.collection!, index: { name: row.index!, hidden } }).catch((error: unknown) => {
                report(error);
                return {};
            }));
            if (failure) report(new Error(`${row.index}: ${say(failure)}`));
        }
        await connections.loadIndexes(first.connectionId, first.database, first.collection).catch(report);
    }

    async function refreshMany(rows: TreeSelection[]) {
        for (const connectionId of new Set(rows.map(row => row.connectionId))) await refresh({ connectionId });
    }

    async function disconnectMany(rows: TreeSelection[]) {
        for (const connectionId of new Set(rows.map(row => row.connectionId))) await disconnect({ connectionId });
    }

    async function refresh(at = target.value) {
        if (at) await connections.loadDatabases(at.connectionId).catch(report);
    }

    /** The row is in the tree and selected at once; the connection opens behind it. */
    async function connect(profile: Profile) {
        connections.selected = { connectionId: profile.id };
        const session = connections.sessions[profile.id];
        if (session) session.open = true;
        else if (!connections.connecting.has(profile.id)) await connections.connect(profile.id).catch(report);
    }

    async function reconnect(at = target.value) {
        if (!at) return;
        tabs.closeConnection(at.connectionId);
        await connections.reconnect(at.connectionId).catch(report);
    }

    /** Connects with a string that is typed in and not saved "Connect from URI". */
    async function connectFromUri() {
        const uri = await dialogs.ask({ title: t("connection.fromUri.title"), label: t("connection.fromUri.label"), value: "mongodb://", action: t("connection.connect"), code: true });
        if (!uri) return;
        await connections.connectUri(uri).catch(report);
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
        openShell, browse, aggregation, openSql, exportWizard, importWizard, collectionStats, databaseStats, collectionsStats, serverStatus, serverLog, manageUsers, manageRoles, openGridFs, createBucket, indexes,
        createCollection, createView, editValidator, createDatabase, renameCollection, dropCollection, dropDatabase, createIndex, duplicateIndex, recreateIndex, toggleIndexHidden, dropIndex, indexInfo, indexOf,
        setColor, editComment, removeComment, toggleReadonly, writable, addFolder, renameFolder, moveFolder, deleteFolder, moveToFolder,
        dropMany, browseMany, setColorMany, toggleReadonlyMany, moveManyToFolder, toggleIndexesHidden, refreshMany, disconnectMany,
        refresh, connect, reconnect, connectFromUri, disconnect, viewUri, connectionSettings, deleteConnection,
        newConnection: () => dialogs.editConnection()
    };
}
