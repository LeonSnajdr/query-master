<script setup lang="ts">
import { ButtonRoot, PopoverActivator, PopoverContent, PopoverRoot } from "@vuetify/v0";
import { computed, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Profile } from "@/api";
import ContextMenu from "@/components/ContextMenu.vue";
import DropMenu from "@/components/DropMenu.vue";
import IconButton from "@/components/IconButton.vue";
import NoteMarks from "@/components/NoteMarks.vue";
import { useActions } from "@/composables/actions";
import { useCopy } from "@/composables/copy";
import { useDialogs } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";
import type { MenuEntry } from "@/menu";
import { useConnectionsStore } from "@/stores/connections";
import type { DatabaseNode, TreeSelection } from "@/stores/connections";
import { bucketOf, treeCollections } from "@/shell/gridfs";
import { collectionRows, databaseRows, NOTE_COLORS, useNotesStore } from "@/stores/notes";
import type { CollectionRow, NotePlace } from "@/stores/notes";

/** The dock at the left: saved connections, the toolbar, and the tree of what is connected. */
const { t } = useI18n();
const { report } = useMessages();
const dialogs = useDialogs();
const actions = useActions();
const copying = useCopy();
const connections = useConnectionsStore();
const notes = useNotesStore();
const menu = useTemplateRef("menu");

/** Views, time series and the server's own collections each have an icon of their own. */
function collectionIcon(database: DatabaseNode, collection: string): string {
    if (bucketAt(database, collection) !== undefined) return "i-lucide-folder-archive";
    const type = database.types[collection];
    if (type === "view") return "i-lucide-eye";
    if (type === "timeseries") return "i-lucide-chart-line";
    return collection.startsWith("system.") ? "i-lucide-file-cog" : "i-lucide-file-text";
}

function isView(at: TreeSelection): boolean {
    const database = connections.sessions[at.connectionId]?.databases.find(item => item.name === at.database);
    return at.collection !== undefined && database?.types[at.collection] === "view";
}

/** The icon of a row takes the color noted for it. */
function tint(place: NotePlace): string {
    const color = notes.noteOf(place)?.color;
    return color ? `note-fg-${color}` : "text-on-surface";
}

/** Color, comment and read-only of a row, for its context menu. */
function noteEntries(at: TreeSelection): MenuEntry[] {
    const place = { connectionId: at.connectionId, database: at.database, collection: at.collection };
    const note = notes.noteOf(place);
    const entries: MenuEntry[] = [
        "separator",
        { label: t("note.color"), swatches: NOTE_COLORS, current: note?.color ?? null, choose: color => void actions.setColor(at, color) },
        { label: t(note?.comment ? "note.comment.edit" : "note.comment.add"), icon: "i-lucide-message-square-text", action: () => void actions.editComment(at) }
    ];
    if (note?.comment) entries.push({ label: t("note.comment.remove"), action: () => void actions.removeComment(at) });
    entries.push({ label: t("note.readonly"), icon: "i-lucide-lock", checked: note?.readonly === true, action: () => void actions.toggleReadonly(at) });
    return entries;
}

const listOpen = shallowRef(false);
const searching = shallowRef(false);
const search = shallowRef("");
const connected = computed(() => connections.profiles.filter(profile => connections.sessions[profile.id]));

function matches(name: string): boolean {
    return !search.value.trim() || name.toLowerCase().includes(search.value.trim().toLowerCase());
}

/** Databases that match the search, or have a collection that does. */
function shownDatabases(profile: Profile): DatabaseNode[] {
    return (connections.sessions[profile.id]?.databases ?? []).filter(database => matches(database.name) || (database.collections ?? []).some(matches));
}

/** Folders of the connection and its databases; while searching every folder shows its matches. */
function databaseRowsOf(profile: Profile): ({ kind: "folder"; name: string; count: number } | { kind: "database"; node: DatabaseNode; folder?: string })[] {
    const shown = shownDatabases(profile);
    const searchingNow = search.value.trim() !== "";
    return databaseRows(
        shown.map(database => database.name),
        notes.notes[profile.id],
        notes.foldersOf(profile.id, ""),
        folder => searchingNow || notes.isOpen(profile.id, "", folder)
    ).map(row => (row.kind === "folder" ? row : { kind: "database" as const, node: shown.find(database => database.name === row.name)!, folder: row.folder }));
}

/**
 * Left padding of a row below a connection; a database in a folder moves in, and everything
 * below it with it (`--shift` is set on the database's own block).
 */
function indent(rem: number): Record<string, string> {
    return { paddingLeft: `calc(${rem}rem + var(--shift, 0rem))` };
}

function shownCollections(database: DatabaseNode): string[] {
    // A GridFS bucket shows once, as its `.files`.
    const all = treeCollections(database.collections ?? []);
    return matches(database.name) ? all : all.filter(matches);
}

/** Folders and collections of an open database; while searching every folder shows its matches. */
function rowsOf(profile: Profile, database: DatabaseNode): CollectionRow[] {
    const searchingNow = search.value.trim() !== "";
    return collectionRows(
        shownCollections(database),
        database.name,
        notes.notes[profile.id],
        notes.foldersOf(profile.id, database.name),
        folder => searchingNow || notes.isOpen(profile.id, database.name, folder)
    );
}

/** A folder of a database (of collections), or of the connection (of databases) without `database`. */
function openFolderMenu(event: MouseEvent, profile: Profile, database: DatabaseNode | undefined, folder: string) {
    const at = { connectionId: profile.id, database: database?.name };
    void menu.value?.open(event, [
        { label: t("folder.add"), icon: "i-lucide-folder-plus", hotkey: "Ctrl + G", action: () => void actions.addFolder(at) },
        { label: t("folder.rename"), icon: "i-lucide-pencil", action: () => void actions.renameFolder(at, folder) },
        { label: t("folder.delete"), icon: "i-lucide-folder-x", danger: true, action: () => void actions.deleteFolder(at, folder) }
    ]);
}

/**
 * "Move to folder" for a collection (the folders of its database) or a database (those of the
 * connection): each other folder, and out of its own.
 */
function folderEntries(at: TreeSelection): MenuEntry[] {
    if (at.database === undefined) return [];
    const current = notes.noteOf(at)?.folder ?? null;
    const entries: MenuEntry[] = notes.foldersOf(at.connectionId, at.collection === undefined ? "" : at.database)
        .filter(folder => folder !== current)
        .map(folder => ({ label: t("folder.moveTo", { name: folder }), icon: "i-lucide-folder-input", action: () => void actions.moveToFolder(at, folder) }));
    if (current) entries.push({ label: t("folder.moveOut", { name: current }), icon: "i-lucide-folder-output", action: () => void actions.moveToFolder(at, null) });
    // Many folders would make a long menu: they get one of their own.
    if (entries.length > 1) return ["separator", { label: t("folder.menu"), icon: "i-lucide-folder", children: entries }];
    return entries.length > 0 ? ["separator", ...entries] : [];
}

/** The bucket a row stands for, when it is the `.files` of one. */
function bucketAt(database: DatabaseNode, collection: string): string | undefined {
    return bucketOf(collection, database.collections ?? []);
}

/** Double click: the documents of a collection, the files of a bucket. */
function openRow(profile: Profile, database: DatabaseNode, collection: string) {
    const at = { connectionId: profile.id, database: database.name, collection };
    const bucket = bucketAt(database, collection);
    if (bucket === undefined) actions.browse(at);
    else actions.openGridFs(at, bucket);
}

function isSelected(at: TreeSelection): boolean {
    const selected = connections.selected;
    return selected?.connectionId === at.connectionId && selected.database === at.database && selected.collection === at.collection && selected.index === at.index;
}

function select(at: TreeSelection) {
    connections.selected = at;
}

function toggleConnection(profile: Profile) {
    const session = connections.sessions[profile.id];
    if (session) session.open = !session.open;
}

async function toggleDatabase(profile: Profile, database: DatabaseNode) {
    database.open = !database.open;
    if (database.open && !database.collections) await connections.loadCollections(profile.id, database.name).catch(report);
}

async function toggleCollection(profile: Profile, database: DatabaseNode, collection: string) {
    const detail = database.details[collection] ??= { open: false, loading: false };
    detail.open = !detail.open;
    if (detail.open && !detail.indexes) await connections.loadIndexes(profile.id, database.name, collection).catch(report);
}

async function choose(profile: Profile) {
    listOpen.value = false;
    await actions.connect(profile);
}

/** The list of saved connections: a toolbar, a search and one folder of them. */
const listSearch = shallowRef("");
const listFolderOpen = shallowRef(true);
const picked = shallowRef<string>();
const listed = computed(() => {
    const term = listSearch.value.trim().toLowerCase();
    return connections.saved.filter(profile => !term || profile.name.toLowerCase().includes(term) || profile.address.toLowerCase().includes(term));
});
const pickedProfile = computed(() => connections.saved.find(profile => profile.id === picked.value));

// Color and read-only of a connection show in the list before it is connected.
watch(listOpen, (open) => {
    if (!open) return;
    listSearch.value = "";
    for (const profile of connections.saved) {
        if (!notes.notes[profile.id]) void notes.load(profile.id).catch(report);
    }
});

function editPicked() {
    const profile = pickedProfile.value;
    if (!profile) return;
    listOpen.value = false;
    dialogs.editConnection(profile);
}

function deletePicked() {
    const profile = pickedProfile.value;
    if (!profile) return;
    listOpen.value = false;
    void actions.deleteConnection(profile);
}

/** Up and down pick, Enter connects, Del deletes. */
function onListKey(event: KeyboardEvent) {
    const at = listed.value.findIndex(profile => profile.id === picked.value);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const next = listed.value[Math.min(listed.value.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))];
        if (next) picked.value = next.id;
    } else if (event.key === "Enter" && pickedProfile.value) {
        void choose(pickedProfile.value);
    } else if (event.key === "Delete") {
        deletePicked();
    } else {
        return;
    }
    event.preventDefault();
}

const createEntries = computed<MenuEntry[]>(() => [
    { label: t("database.create"), hotkey: "Ctrl + Shift + D", action: () => void actions.createDatabase(), disabled: !actions.hasConnection.value },
    { label: t("collection.create"), icon: "i-lucide-file-plus-2", hotkey: "Ctrl + H", action: () => void actions.createCollection(), disabled: !actions.hasDatabase.value },
    { label: t("index.create"), icon: "i-lucide-key-round", hotkey: "Ctrl + I", action: () => actions.createIndex(), disabled: !actions.hasCollection.value }
]);

const manageEntries = computed<MenuEntry[]>(() => [
    { label: t("index.list"), icon: "i-lucide-key-round", action: () => actions.indexes(), disabled: !actions.hasCollection.value },
    { label: t("collection.stats"), action: () => actions.collectionStats(), disabled: !actions.hasCollection.value },
    { label: t("database.stats"), action: () => actions.databaseStats(), disabled: !actions.hasDatabase.value },
    { label: t("database.collectionsStats"), action: () => actions.collectionsStats(), disabled: !actions.hasDatabase.value },
    { label: t("connection.status"), icon: "i-lucide-activity", action: () => actions.serverStatus(), disabled: !actions.hasConnection.value },
    { label: t("connection.log"), icon: "i-lucide-scroll-text", action: () => actions.serverLog(), disabled: !actions.hasConnection.value },
    "separator",
    { label: t("users.manage"), icon: "i-lucide-users", hotkey: "Ctrl + Alt + U", action: () => actions.manageUsers(), disabled: !actions.hasConnection.value },
    { label: t("roles.manage"), icon: "i-lucide-shield", hotkey: "Ctrl + Alt + R", action: () => actions.manageRoles(), disabled: !actions.hasConnection.value }
]);

/** Keys on a focused row act on the selected one: Del drops, Ctrl+C copies, Ctrl+V pastes. */
function onTreeKey(event: KeyboardEvent) {
    const at = connections.selected;
    if (!at || event.altKey || event.shiftKey) return;
    const control = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (!control && key === "delete") {
        if (at.index !== undefined) {
            if (at.index !== "_id_") void actions.dropIndex(at);
        } else if (at.collection !== undefined) {
            void actions.dropCollection(at);
        } else if (at.database !== undefined) {
            void actions.dropDatabase(at);
        } else {
            return;
        }
    } else if (control && key === "c" && at.database !== undefined && at.collection !== undefined && at.index === undefined) {
        copying.copy({ connectionId: at.connectionId, database: at.database, collection: at.collection });
    } else if (control && key === "v" && at.database !== undefined) {
        void copying.paste(at.connectionId, at.database);
    } else {
        return;
    }
    event.preventDefault();
}

/** "Paste collection orders", or how many collections "Copy collections" picked. */
function pasteLabel(): string {
    const picked = copying.copied.value ?? [];
    if (picked.length > 1) return t("collection.pasteMany", { count: picked.length });
    return picked[0] ? t("collection.pasteNamed", { name: picked[0].collection }) : t("collection.paste");
}

function openMenu(event: MouseEvent, at: TreeSelection) {
    select(at);
    // Pasting goes into the database of the row; the copy may come from another connection.
    const paste = (database: string): MenuEntry => ({
        label: pasteLabel(),
        icon: "i-lucide-clipboard-paste",
        hotkey: "Ctrl + V",
        action: () => void copying.paste(at.connectionId, database),
        disabled: !copying.copied.value?.length || copying.running.runId !== undefined
    });
    const tail: MenuEntry[] = [
        "separator",
        { label: t("action.refresh"), icon: "i-lucide-refresh-cw", hotkey: "Ctrl + R", action: () => void actions.refresh(at) },
        { label: t("connection.disconnect"), hotkey: "Ctrl + Alt + D", action: () => void actions.disconnect(at) }
    ];
    let entries: MenuEntry[];
    if (at.index !== undefined) {
        entries = [
            { label: t("tab.shell"), icon: "i-lucide-square-terminal", hotkey: "Ctrl + T", action: () => actions.openShell(at) },
            "separator",
            { label: t("index.create"), icon: "i-lucide-key-round", hotkey: "Ctrl + I", action: () => actions.createIndex(at) },
            { label: t("index.recreate"), hotkey: "Ctrl + Alt + I", action: () => actions.recreateIndex(at), disabled: at.index === "_id_" },
            { label: t("index.duplicate"), icon: "i-lucide-copy", hotkey: "Ctrl + Shift + I", action: () => actions.duplicateIndex(at), disabled: at.index === "_id_" },
            // The index on _id belongs to the collection: it can be neither dropped nor hidden.
            { label: t(actions.indexOf(at)?.hidden === true ? "index.unhide" : "index.hide"), action: () => void actions.toggleIndexHidden(at), disabled: at.index === "_id_" },
            { label: t("index.drop"), hotkey: "Del", danger: true, action: () => void actions.dropIndex(at), disabled: at.index === "_id_" },
            "separator",
            { label: t("index.info.show"), action: () => actions.indexInfo(at) },
            ...tail
        ];
    } else if (at.collection !== undefined) {
        const node = connections.sessions[at.connectionId]?.databases.find(item => item.name === at.database);
        const bucket = node ? bucketAt(node, at.collection) : undefined;
        entries = [
            ...(bucket === undefined ? [] : [{ label: t("gridfs.open"), icon: "i-lucide-folder-archive", action: () => actions.openGridFs(at, bucket) }]),
            { label: t("tab.browse"), icon: "i-lucide-file-text", hotkey: "Ctrl + Q", action: () => actions.browse(at) },
            "separator",
            { label: t("tab.shell"), icon: "i-lucide-square-terminal", hotkey: "Ctrl + T", action: () => actions.openShell(at) },
            { label: t("tab.aggregation"), icon: "i-lucide-network", hotkey: "Ctrl + Shift + Q", action: () => actions.aggregation(at) },
            { label: t("tab.sql"), icon: "i-lucide-file-code-2", hotkey: "Ctrl + Alt + Q", action: () => actions.openSql(at) },
            "separator",
            { label: t("collection.create"), icon: "i-lucide-file-plus-2", hotkey: "Ctrl + H", action: () => void actions.createCollection(at) },
            { label: t("view.create"), icon: "i-lucide-file-search", hotkey: "Ctrl + Shift + H", action: () => actions.createView(at) },
            { label: t("gridfs.create"), icon: "i-lucide-folder-archive", action: () => void actions.createBucket(at) },
            "separator",
            { label: t("collection.copy"), icon: "i-lucide-copy", hotkey: "Ctrl + C", action: () => copying.copy({ connectionId: at.connectionId, database: at.database!, collection: at.collection! }) },
            paste(at.database!),
            { label: t("export.menu"), icon: "i-lucide-upload", hotkey: "Ctrl + Shift + S", action: () => void actions.exportWizard(at) },
            { label: t("import.menu"), icon: "i-lucide-download", hotkey: "Ctrl + Shift + O", action: () => actions.importWizard(at), disabled: isView(at) },
            "separator",
            { label: t("collection.rename"), action: () => void actions.renameCollection(at) },
            { label: t("collection.drop"), icon: "i-lucide-file-x-2", hotkey: "Del", danger: true, action: () => void actions.dropCollection(at) },
            "separator",
            // A view has neither indexes nor a validator of its own.
            { label: t("index.create"), icon: "i-lucide-key-round", hotkey: "Ctrl + I", action: () => actions.createIndex(at), disabled: isView(at) },
            { label: t("index.list"), action: () => actions.indexes(at), disabled: isView(at) },
            { label: t("validator.edit"), hotkey: "Ctrl + Alt + V", action: () => actions.editValidator(at), disabled: isView(at) },
            "separator",
            { label: t("collection.stats"), action: () => actions.collectionStats(at) },
            ...folderEntries(at),
            ...noteEntries(at),
            ...tail
        ];
    } else if (at.database !== undefined) {
        entries = [
            { label: t("tab.shell"), icon: "i-lucide-square-terminal", hotkey: "Ctrl + T", action: () => actions.openShell(at) },
            "separator",
            { label: t("database.create"), hotkey: "Ctrl + Shift + D", action: () => void actions.createDatabase(at) },
            { label: t("collection.create"), icon: "i-lucide-file-plus-2", hotkey: "Ctrl + H", action: () => void actions.createCollection(at) },
            { label: t("view.create"), icon: "i-lucide-file-search", hotkey: "Ctrl + Shift + H", action: () => actions.createView(at) },
            { label: t("gridfs.create"), icon: "i-lucide-folder-archive", action: () => void actions.createBucket(at) },
            { label: t("folder.add"), icon: "i-lucide-folder-plus", hotkey: "Ctrl + G", action: () => void actions.addFolder(at) },
            "separator",
            { label: t("collection.copyAll"), icon: "i-lucide-copy", action: () => void copying.copyAll(at.connectionId, at.database!) },
            paste(at.database),
            "separator",
            { label: t("database.drop"), hotkey: "Del", danger: true, action: () => void actions.dropDatabase(at) },
            "separator",
            { label: t("database.stats"), action: () => actions.databaseStats(at) },
            { label: t("database.collectionsStats"), action: () => actions.collectionsStats(at) },
            { label: t("export.menu"), icon: "i-lucide-upload", hotkey: "Ctrl + Shift + S", action: () => void actions.exportWizard(at) },
            { label: t("import.menu"), icon: "i-lucide-download", hotkey: "Ctrl + Shift + O", action: () => actions.importWizard(at) },
            "separator",
            { label: t("users.manage"), icon: "i-lucide-users", hotkey: "Ctrl + Alt + U", action: () => actions.manageUsers(at) },
            { label: t("roles.manage"), icon: "i-lucide-shield", hotkey: "Ctrl + Alt + R", action: () => actions.manageRoles(at) },
            ...folderEntries(at),
            ...noteEntries(at),
            ...tail
        ];
    } else {
        entries = [
            { label: t("tab.shell"), icon: "i-lucide-square-terminal", hotkey: "Ctrl + T", action: () => actions.openShell(at) },
            "separator",
            { label: t("database.create"), hotkey: "Ctrl + Shift + D", action: () => void actions.createDatabase(at) },
            { label: t("folder.add"), icon: "i-lucide-folder-plus", hotkey: "Ctrl + G", action: () => void actions.addFolder(at) },
            "separator",
            { label: t("connection.status"), icon: "i-lucide-activity", action: () => actions.serverStatus(at) },
            { label: t("connection.log"), icon: "i-lucide-scroll-text", action: () => actions.serverLog(at) },
            { label: t("users.manage"), icon: "i-lucide-users", hotkey: "Ctrl + Alt + U", action: () => actions.manageUsers(at) },
            { label: t("roles.manage"), icon: "i-lucide-shield", hotkey: "Ctrl + Alt + R", action: () => actions.manageRoles(at) },
            "separator",
            { label: t("export.menu"), icon: "i-lucide-upload", hotkey: "Ctrl + Shift + S", action: () => void actions.exportWizard(at) },
            { label: t("import.menu"), icon: "i-lucide-download", hotkey: "Ctrl + Shift + O", action: () => actions.importWizard(at) },
            "separator",
            { label: t("action.refresh"), icon: "i-lucide-refresh-cw", hotkey: "Ctrl + R", action: () => void actions.refresh(at) },
            { label: t("tree.collapse"), icon: "i-lucide-chevrons-down-up", hotkey: "Ctrl + Shift + U", action: () => connections.collapseAll() },
            "separator",
            // A connection from a typed string has no settings, stored string or notes to show.
            ...(connections.isTransient(at.connectionId)
                ? []
                : [
                    { label: t("connection.settings"), action: () => actions.connectionSettings(at) },
                    { label: t("connection.uri"), hotkey: "Ctrl + Alt + F2", action: () => void actions.viewUri(at) },
                    ...noteEntries(at)
                ] satisfies MenuEntry[]),
            "separator",
            { label: t("connection.disconnect"), hotkey: "Ctrl + Alt + D", action: () => void actions.disconnect(at) }
        ];
    }
    void menu.value?.open(event, entries);
}

defineExpose({
    /** Opens the list of saved connections (F2). */
    openList: () => (listOpen.value = true)
});
</script>

<template>
    <aside class="h-full min-w-0 flex flex-col bg-dock select-none">
        <header class="h-13 shrink-0 flex items-end justify-between pl-5.5 pr-4 pb-2.5">
            <PopoverRoot v-model="listOpen">
                <PopoverActivator
                    :title="$t('connection.list.hint')"
                    class="inline-flex items-center gap-1 text-[13px] font-bold tracking-wide uppercase text-primary hover:brightness-125"
                    data-testid="connection-list"
                >
                    {{ $t("connection.connect") }}
                    <span class="i-lucide-chevron-down size-3.5" />
                </PopoverActivator>
                <!-- Resizable at its corner, like the window. -->
                <PopoverContent
                    class="menu-panel w-[340px] h-[530px] min-w-64 min-h-48 max-w-[90vw] max-h-[85vh] resize overflow-hidden flex-col [&:popover-open]:flex"
                    data-testid="connection-panel"
                    positionArea="bottom span-right"
                >
                    <div class="h-10 shrink-0 flex items-center gap-0.5 px-4">
                        <IconButton
                            @click="listOpen = false; actions.newConnection()"
                            :label="`${$t('connection.add')} (Ctrl + F2)`"
                            icon="i-lucide-plus"
                            tint="text-success"
                        >
                            {{ $t("connection.add") }}
                        </IconButton>
                        <span class="toolbar-rule" />
                        <IconButton
                            @click="listOpen = false; actions.connectFromUri()"
                            :label="$t('connection.connectFromUri')"
                            icon="i-lucide-link"
                        />
                        <span class="toolbar-rule" />
                        <IconButton
                            @click="deletePicked()"
                            :disabled="!pickedProfile"
                            :label="`${$t('action.delete')} (Del)`"
                            data-testid="connection-delete"
                            icon="i-lucide-x"
                            tint="text-error"
                        />
                        <IconButton
                            @click="editPicked()"
                            :disabled="!pickedProfile"
                            :label="$t('connection.edit')"
                            data-testid="connection-edit"
                            icon="i-lucide-pencil"
                        />
                    </div>
                    <label class="mx-4 mb-2 h-7 shrink-0 flex items-center gap-1.5 px-2 rounded-sm bg-surface-variant border border-divider focus-within:border-primary">
                        <span class="i-lucide-search size-3.5 shrink-0 text-on-surface-variant" />
                        <input
                            v-model="listSearch"
                            :aria-label="$t('tree.search')"
                            :placeholder="`${$t('tree.search')} …`"
                            class="grow min-w-0 bg-transparent outline-none text-[13px] text-on-surface-strong placeholder:italic placeholder:text-on-surface-variant"
                            data-testid="connection-search"
                        />
                        <ButtonRoot
                            v-if="listSearch"
                            @click="listSearch = ''"
                            :ariaLabel="$t('choice.clear')"
                            class="i-lucide-x size-3.5 shrink-0 text-on-surface-variant hover:text-on-surface-strong"
                        />
                    </label>
                    <div
                        @keydown="onListKey"
                        class="grow min-h-0 overflow-auto pb-2 text-[13px]"
                        role="tree"
                    >
                        <div
                            @click="listFolderOpen = !listFolderOpen"
                            @keydown.enter.self.stop="listFolderOpen = !listFolderOpen"
                            class="tree-row pl-5"
                            role="treeitem"
                            tabindex="0"
                        >
                            <span
                                :class="listFolderOpen ? 'rotate-90' : ''"
                                class="i-lucide-chevron-right size-3.5 shrink-0 text-on-surface-variant"
                            />
                            <span
                                :class="listFolderOpen ? 'i-lucide-folder-open' : 'i-lucide-folder'"
                                class="size-4 shrink-0 text-on-surface"
                            />
                            <span class="truncate font-bold text-on-surface-strong">{{ $t("connection.mine") }}</span>
                        </div>
                        <template v-if="listFolderOpen">
                            <p
                                v-if="connections.saved.length === 0"
                                class="m-0 pl-14 py-1 text-on-surface-variant"
                            >
                                {{ $t("connection.empty") }}
                            </p>
                            <div
                                v-for="profile in listed"
                                :key="profile.id"
                                @click="picked = profile.id"
                                @dblclick="choose(profile)"
                                :class="picked === profile.id ? 'tree-row-on' : ''"
                                :title="profile.address"
                                class="tree-row relative h-[21px] pl-11"
                                data-testid="connection-item"
                                role="treeitem"
                                tabindex="0"
                            >
                                <!-- The color of the connection, as a bar at the left edge. -->
                                <span
                                    v-if="notes.noteOf({ connectionId: profile.id })?.color"
                                    :class="`note-${notes.noteOf({ connectionId: profile.id })?.color}`"
                                    class="absolute left-4 inset-y-0 w-1"
                                />
                                <span class="relative size-4 shrink-0">
                                    <span
                                        :class="[
                                            connections.connecting.has(profile.id) ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-server',
                                            connections.sessions[profile.id] ? 'text-success' : 'text-on-surface'
                                        ]"
                                        class="size-4 block"
                                    />
                                    <span
                                        v-if="notes.noteOf({ connectionId: profile.id })?.readonly"
                                        :title="$t('note.readonly')"
                                        class="i-lucide-lock absolute -right-0.5 -bottom-0.5 size-2.5 text-warning"
                                    />
                                </span>
                                <span class="shrink-0 text-on-surface-strong">{{ profile.name }}</span>
                                <span class="truncate italic text-on-surface-variant">{{ profile.address.replace(/^mongodb(\+srv)?:\/\//, "") }}</span>
                            </div>
                        </template>
                    </div>
                </PopoverContent>
            </PopoverRoot>
            <IconButton
                @click="actions.newConnection()"
                :label="`${$t('connection.add')} (Ctrl + F2)`"
                data-testid="connection-add"
                icon="i-lucide-plus"
                tint="text-success"
            />
        </header>

        <div class="h-8 shrink-0 min-w-0 overflow-hidden flex items-center gap-0.5 px-4">
            <IconButton
                @click="actions.openShell()"
                :disabled="!actions.hasConnection.value"
                :label="`${$t('tab.shell')} (Ctrl + T)`"
                data-testid="dock-shell"
                icon="i-lucide-square-terminal"
            >
                {{ $t("tab.shell.short") }}
            </IconButton>
            <span class="toolbar-rule" />
            <IconButton
                @click="actions.browse()"
                :disabled="!actions.hasCollection.value"
                :label="`${$t('tab.browse')} (Ctrl + Q)`"
                data-testid="dock-browse"
                icon="i-lucide-file-text"
            />
            <IconButton
                @click="actions.aggregation()"
                :disabled="!actions.hasCollection.value"
                :label="`${$t('tab.aggregation')} (Ctrl + Shift + Q)`"
                icon="i-lucide-network"
            />
            <IconButton
                @click="actions.openSql()"
                :disabled="!actions.hasConnection.value"
                :label="`${$t('tab.sql')} (Ctrl + Alt + Q)`"
                data-testid="dock-sql"
                icon="i-lucide-file-code-2"
            />
            <span class="toolbar-rule" />
            <DropMenu
                :entries="createEntries"
                :label="$t('action.create')"
            >
                <span class="h-6.5 px-1 inline-flex items-center gap-0.5 rounded-sm text-on-surface hover:bg-on-surface/10">
                    <span class="i-lucide-file-plus-2 size-4" />
                    <span class="i-lucide-chevron-down size-3" />
                </span>
            </DropMenu>
            <DropMenu
                :entries="manageEntries"
                :label="$t('action.manage')"
            >
                <span class="h-6.5 px-1 inline-flex items-center gap-0.5 rounded-sm text-on-surface hover:bg-on-surface/10">
                    <span class="i-lucide-chart-column size-4" />
                    <span class="i-lucide-chevron-down size-3" />
                </span>
            </DropMenu>
            <span class="toolbar-rule" />
            <IconButton
                @click="searching = !searching; search = ''"
                :active="searching"
                :disabled="connected.length === 0"
                :label="$t('tree.search')"
                icon="i-lucide-search"
            />
        </div>

        <input
            v-if="searching"
            v-model="search"
            :aria-label="$t('tree.search')"
            :placeholder="$t('tree.search')"
            class="mx-4 mt-1 h-7 px-2 rounded-sm bg-surface-variant border border-divider outline-none focus:border-primary text-[13px] text-on-surface-strong"
            data-testid="tree-search"
            type="search"
        />

        <div
            @keydown="onTreeKey"
            class="grow min-h-0 overflow-y-auto pt-2 pb-2 text-[13px]"
            role="tree"
        >
            <div
                v-if="connected.length === 0"
                class="pt-14 flex flex-col items-center gap-1 text-center"
            >
                <span class="text-lg text-on-surface-variant">{{ $t("connection.none") }}</span>
                <span class="text-on-surface-variant/70">{{ $t("connection.none.hint") }}</span>
            </div>

            <div
                v-for="profile in connected"
                :key="profile.id"
                data-testid="connection"
            >
                <div
                    @click="select({ connectionId: profile.id })"
                    @contextmenu="openMenu($event, { connectionId: profile.id })"
                    @dblclick="toggleConnection(profile)"
                    @keydown.enter.self="toggleConnection(profile)"
                    :class="isSelected({ connectionId: profile.id }) ? 'tree-row-on' : ''"
                    class="tree-row pl-3.5"
                    data-testid="connection-row"
                    role="treeitem"
                    tabindex="0"
                >
                    <span
                        @click.stop="toggleConnection(profile)"
                        :class="connections.sessions[profile.id]?.open ? 'rotate-90' : ''"
                        class="i-lucide-chevron-right size-3.5 shrink-0 text-on-surface-variant"
                    />
                    <span
                        :class="tint({ connectionId: profile.id })"
                        class="i-lucide-server size-4 shrink-0"
                    />
                    <span class="truncate text-on-surface-strong">{{ profile.name }}</span>
                    <NoteMarks :place="{ connectionId: profile.id }" />
                    <span class="truncate italic text-on-surface-variant">{{ profile.address.replace(/^mongodb(\+srv)?:\/\//, "") }}</span>
                    <span class="grow" />
                    <span
                        class="shrink-0 text-[11px] text-on-surface-variant"
                        data-testid="connection-version"
                    >{{ connections.sessions[profile.id]?.version }}</span>
                </div>

                <template v-if="connections.sessions[profile.id]?.open">
                    <template
                        v-for="databaseRow in databaseRowsOf(profile)"
                        :key="databaseRow.kind === 'folder' ? `folder:${databaseRow.name}` : `database:${databaseRow.node.name}`"
                    >
                        <!-- A folder of the connection, with its databases below while open. -->
                        <div
                            v-if="databaseRow.kind === 'folder'"
                            @click="notes.toggleFolder(profile.id, '', databaseRow.name)"
                            @contextmenu.prevent="openFolderMenu($event, profile, undefined, databaseRow.name)"
                            @keydown.enter.self="notes.toggleFolder(profile.id, '', databaseRow.name)"
                            class="tree-row pl-7.5"
                            data-testid="database-folder-row"
                            role="treeitem"
                            tabindex="0"
                        >
                            <span
                                :class="notes.isOpen(profile.id, '', databaseRow.name) ? 'rotate-90' : ''"
                                class="i-lucide-chevron-right size-3.5 shrink-0 text-on-surface-variant"
                            />
                            <span
                                :class="notes.isOpen(profile.id, '', databaseRow.name) ? 'i-lucide-folder-open' : 'i-lucide-folder'"
                                class="size-4 shrink-0 text-warning"
                            />
                            <span class="truncate text-on-surface-strong">{{ databaseRow.name }}</span>
                            <span class="grow" />
                            <span class="shrink-0 text-[11px] text-on-surface-variant">{{ databaseRow.count }}</span>
                        </div>
                        <!-- A database, moved in with all below it while it lies in a folder. -->
                        <div
                            v-else
                            :style="databaseRow.folder ? { '--shift': '1rem' } : undefined"
                        >
                            <template
                                v-for="database in [databaseRow.node]"
                                :key="database.name"
                            >
                                <div
                                    @click="select({ connectionId: profile.id, database: database.name })"
                                    @contextmenu="openMenu($event, { connectionId: profile.id, database: database.name })"
                                    @dblclick="toggleDatabase(profile, database)"
                                    @keydown.enter.self="toggleDatabase(profile, database)"
                                    :class="isSelected({ connectionId: profile.id, database: database.name }) ? 'tree-row-on' : ''"
                                    :style="indent(1.875)"
                                    class="tree-row"
                                    data-testid="database-row"
                                    role="treeitem"
                                    tabindex="0"
                                >
                                    <span
                                        @click.stop="toggleDatabase(profile, database)"
                                        :class="[database.loading ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-chevron-right', database.open ? 'rotate-90' : '']"
                                        class="size-3.5 shrink-0 text-on-surface-variant"
                                        data-testid="database-toggle"
                                    />
                                    <span
                                        :class="tint({ connectionId: profile.id, database: database.name })"
                                        class="i-lucide-database size-4 shrink-0"
                                    />
                                    <span class="truncate text-on-surface-strong">{{ database.name }}</span>
                                    <NoteMarks :place="{ connectionId: profile.id, database: database.name }" />
                                    <span class="grow" />
                                    <span
                                        v-if="database.collections"
                                        class="shrink-0 text-[11px] text-on-surface-variant"
                                    >{{ database.collections.length }}</span>
                                </div>

                                <template v-if="database.open">
                                    <template
                                        v-for="row in rowsOf(profile, database)"
                                        :key="`${row.kind}:${row.name}`"
                                    >
                                        <!-- A folder of the database, with its collections below while open. -->
                                        <div
                                            v-if="row.kind === 'folder'"
                                            @click="notes.toggleFolder(profile.id, database.name, row.name)"
                                            @contextmenu.prevent="openFolderMenu($event, profile, database, row.name)"
                                            @keydown.enter.self="notes.toggleFolder(profile.id, database.name, row.name)"
                                            :style="indent(2.875)"
                                            class="tree-row"
                                            data-testid="folder-row"
                                            role="treeitem"
                                            tabindex="0"
                                        >
                                            <span
                                                :class="notes.isOpen(profile.id, database.name, row.name) ? 'rotate-90' : ''"
                                                class="i-lucide-chevron-right size-3.5 shrink-0 text-on-surface-variant"
                                            />
                                            <span
                                                :class="notes.isOpen(profile.id, database.name, row.name) ? 'i-lucide-folder-open' : 'i-lucide-folder'"
                                                class="size-4 shrink-0 text-warning"
                                            />
                                            <span class="truncate text-on-surface-strong">{{ row.name }}</span>
                                            <span class="grow" />
                                            <span class="shrink-0 text-[11px] text-on-surface-variant">{{ row.count }}</span>
                                        </div>
                                        <template v-else>
                                            <template
                                                v-for="collection in [row.name]"
                                                :key="collection"
                                            >
                                                <div
                                                    @click="select({ connectionId: profile.id, database: database.name, collection })"
                                                    @contextmenu="openMenu($event, { connectionId: profile.id, database: database.name, collection })"
                                                    @dblclick="openRow(profile, database, collection)"
                                                    @keydown.enter="openRow(profile, database, collection)"
                                                    :class="isSelected({ connectionId: profile.id, database: database.name, collection }) ? 'tree-row-on' : ''"
                                                    :style="indent(row.kind === 'collection' && row.folder ? 3.875 : 2.875)"
                                                    class="tree-row"
                                                    data-testid="collection-row"
                                                    role="treeitem"
                                                    tabindex="0"
                                                >
                                                    <span
                                                        @click.stop="toggleCollection(profile, database, collection)"
                                                        @dblclick.stop
                                                        :class="[
                                                            database.details[collection]?.loading ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-chevron-right',
                                                            database.details[collection]?.open ? 'rotate-90' : '',
                                                            // A view has no indexes to unfold.
                                                            database.types[collection] === 'view' ? 'invisible' : ''
                                                        ]"
                                                        class="size-3.5 shrink-0 text-on-surface-variant"
                                                        data-testid="collection-toggle"
                                                    />
                                                    <span
                                                        :class="[collectionIcon(database, collection), tint({ connectionId: profile.id, database: database.name, collection })]"
                                                        :title="database.types[collection] === 'collection' ? undefined : $t(`collection.type.${database.types[collection] ?? 'collection'}`)"
                                                        class="size-4 shrink-0"
                                                    />
                                                    <span class="truncate text-on-surface-strong">{{ bucketAt(database, collection) ?? collection }}</span>
                                                    <span
                                                        v-if="bucketAt(database, collection) !== undefined"
                                                        class="shrink-0 text-[11px] text-on-surface-variant"
                                                    >GridFS</span>
                                                    <NoteMarks :place="{ connectionId: profile.id, database: database.name, collection }" />
                                                </div>

                                                <!-- Unfolded, a collection shows its indexes. -->
                                                <template v-if="database.details[collection]?.open">
                                                    <div
                                                        v-for="index in database.details[collection]?.indexes"
                                                        :key="String(index.name)"
                                                        @click="select({ connectionId: profile.id, database: database.name, collection, index: String(index.name) })"
                                                        @contextmenu="openMenu($event, { connectionId: profile.id, database: database.name, collection, index: String(index.name) })"
                                                        @dblclick="actions.indexInfo({ connectionId: profile.id, database: database.name, collection, index: String(index.name) })"
                                                        :class="isSelected({ connectionId: profile.id, database: database.name, collection, index: String(index.name) }) ? 'tree-row-on' : ''"
                                                        :style="indent(row.kind === 'collection' && row.folder ? 6 : 5)"
                                                        class="tree-row"
                                                        data-testid="index-row"
                                                        role="treeitem"
                                                        tabindex="0"
                                                    >
                                                        <span class="i-lucide-key-round size-3.5 shrink-0 text-on-surface" />
                                                        <span
                                                            :class="index.hidden === true ? 'opacity-55' : ''"
                                                            class="truncate text-on-surface-strong"
                                                        >{{ index.name }}</span>
                                                        <span
                                                            v-if="index.hidden === true"
                                                            class="shrink-0 text-[11px] italic text-on-surface-variant"
                                                        >{{ $t("index.hiddenMark") }}</span>
                                                    </div>
                                                </template>
                                            </template>
                                        </template>
                                    </template>
                                </template>
                            </template>
                        </div>
                    </template>
                </template>
            </div>
        </div>

        <ContextMenu ref="menu" />
    </aside>
</template>
