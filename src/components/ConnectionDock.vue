<script setup lang="ts">
import { ButtonRoot, PopoverActivator, PopoverContent, PopoverRoot } from "@vuetify/v0";
import { computed, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { errorMessage } from "@/api";
import type { Profile } from "@/api";
import ContextMenu from "@/components/ContextMenu.vue";
import DropMenu from "@/components/DropMenu.vue";
import IconButton from "@/components/IconButton.vue";
import NoteMarks from "@/components/NoteMarks.vue";
import { useActions } from "@/composables/actions";
import { useCopy } from "@/composables/copy";
import { useDialogs } from "@/composables/dialogs";
import { useExportWizard } from "@/composables/exportWizard";
import { useMessages } from "@/composables/messages";
import { useKeymap } from "@/keys/keymap";
import type { MenuEntry } from "@/menu";
import { useConnectionsStore } from "@/stores/connections";
import type { DatabaseNode, TreeSelection } from "@/stores/connections";
import { bucketOf, treeCollections } from "@/shell/gridfs";
import { collectionRows, databaseRows, NOTE_COLORS, useNotesStore } from "@/stores/notes";
import { folderWithin, parentFolder } from "@/tree/folders";
import type { CollectionRow, FolderRow, NotePlace } from "@/stores/notes";
import { all, click, keyOf, kindOf, rowOf, sameRow } from "@/tree/selection";
import { ENVIRONMENTS } from "@/shell/guard";
import { canDrop, dropTargetOf } from "@/tree/drag";
import type { DragSource, DropTarget } from "@/tree/drag";

/** The dock at the left: saved connections, the toolbar, and the tree of what is connected. */
const { t } = useI18n();
const { report, say } = useMessages();
const dialogs = useDialogs();
const actions = useActions();
const copying = useCopy();
const exportWizard = useExportWizard();
const keymap = useKeymap();

/** The line under "no connection", with the key of the connection list as set. */
const connectHint = computed(() => {
    const key = keymap.label("connection.list");
    return key === undefined ? t("connection.none.hint.noKey") : t("connection.none.hint", { key });
});
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

/** Comment, read-only and color of a row, for its context menu, in the order. */
function noteEntries(at: TreeSelection): MenuEntry[] {
    const place = { connectionId: at.connectionId, database: at.database, collection: at.collection };
    const note = notes.noteOf(place);
    const entries: MenuEntry[] = [
        "separator",
        { label: t(note?.comment ? "note.comment.edit" : "note.comment.add"), icon: "i-lucide-message-square-text", action: () => void actions.editComment(at) }
    ];
    if (note?.comment) entries.push({ label: t("note.comment.remove"), action: () => void actions.removeComment(at) });
    entries.push(
        { label: t("note.readonly"), icon: "i-lucide-lock", checked: note?.readonly === true, action: () => void actions.toggleReadonly(at) },
        { label: t("note.color"), swatches: NOTE_COLORS, current: note?.color ?? null, choose: color => void actions.setColor(at, color) }
    );
    // A saved connection is marked as development, test or production: how the app asks before writing.
    if (at.database === undefined && !connections.isTransient(at.connectionId)) {
        const current = connections.environmentOf(at.connectionId);
        entries.push({
            label: t("environment.menu"),
            icon: "i-lucide-shield",
            children: [null, ...ENVIRONMENTS].map(environment => ({
                label: t(`environment.${environment ?? "none"}`),
                hotkey: t(`environment.${environment ?? "none"}.hint`),
                checked: current === environment,
                action: () => void connections.setEnvironment(at.connectionId, environment).catch(report)
            }))
        });
    }
    return entries;
}

const listOpen = shallowRef(false);
const searching = shallowRef(false);
const search = shallowRef("");
/** Connections in the tree: open ones, and, those being opened or that failed. */
const connected = computed(() => connections.profiles.filter(profile => connections.inTree(profile.id)));

/** The color noted for a connection, shown as a bar along its rows. */
function connectionColor(profile: Profile): string | undefined {
    return notes.noteOf({ connectionId: profile.id })?.color ?? undefined;
}

/** Why a connection could not be opened, for the tooltip of its red mark. */
function failure(profile: Profile): string {
    return t("connection.failed", { reason: say(errorMessage(connections.failed.get(profile.id))) });
}

function matches(name: string): boolean {
    return !search.value.trim() || name.toLowerCase().includes(search.value.trim().toLowerCase());
}

/** Databases that match the search, or have a collection that does. */
function shownDatabases(profile: Profile): DatabaseNode[] {
    return (connections.sessions[profile.id]?.databases ?? []).filter(database => matches(database.name) || (database.collections ?? []).some(matches));
}

/** Folders of the connection and its databases; while searching every folder shows its matches. */
function databaseRowsOf(profile: Profile): (FolderRow | { kind: "database"; node: DatabaseNode; folder?: string; depth: number })[] {
    const shown = shownDatabases(profile);
    const searchingNow = search.value.trim() !== "";
    return databaseRows(
        shown.map(database => database.name),
        notes.notes[profile.id],
        notes.foldersOf(profile.id, ""),
        folder => searchingNow || notes.isOpen(profile.id, "", folder)
    ).map(row => (row.kind === "folder" ? row : { kind: "database" as const, node: shown.find(database => database.name === row.name)!, folder: row.folder, depth: row.depth }));
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
    const parent = parentFolder(folder);
    // Into any folder but itself, those inside it and the one it is in already.
    const targets: MenuEntry[] = notes.foldersOf(profile.id, database?.name ?? "")
        .filter(other => !folderWithin(other, folder) && other !== parent)
        .map(other => ({ label: t("folder.moveFolderTo", { name: other }), icon: "i-lucide-folder-input", action: () => void actions.moveFolder(at, folder, other) }));
    if (parent !== undefined) targets.push({ label: t("folder.moveFolderOut"), icon: "i-lucide-folder-output", action: () => void actions.moveFolder(at, folder, undefined) });
    void menu.value?.open(event, [
        { label: t("folder.add"), icon: "i-lucide-folder-plus", command: "folder.add", action: () => void actions.addFolder(at) },
        { label: t("folder.addInside"), icon: "i-lucide-folder-tree", action: () => void actions.addFolder(at, folder) },
        { label: t("folder.rename"), icon: "i-lucide-pencil", action: () => void actions.renameFolder(at, folder) },
        ...(targets.length > 0 ? [{ label: t("folder.moveFolder"), icon: "i-lucide-folder", children: targets }] : []),
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

/** "Export..." and, as a shortcut, "Export as" with the wizard on the chosen format. */
function exportEntries(at: TreeSelection | TreeSelection[]): MenuEntry[] {
    return [
        { label: t("export.menu"), icon: "i-lucide-upload", command: "export.wizard", action: () => void actions.exportWizard(at) },
        exportWizard.exportAsGroup(format => void actions.exportWizard(at, undefined, format))
    ];
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
    return connections.marked.length > 0 ? connections.marked.some(row => sameRow(row, at)) : sameRow(connections.selected, at);
}

function select(at: TreeSelection) {
    connections.selected = at;
}

/** One selected row is framed; rows selected together are filled, the focused one framed too. */
function rowClass(at: TreeSelection): string {
    if (connections.marked.length === 0) return sameRow(connections.selected, at) ? "tree-row-on" : "";
    if (!isSelected(at)) return "";
    return sameRow(connections.selected, at) ? "tree-row-marked border-primary/80!" : "tree-row-marked";
}

const treeElement = useTemplateRef("tree");
/** Where a Shift click measures from: the row clicked last without Shift. */
let anchor: TreeSelection | undefined;

/** The rows of the tree as shown, top to bottom; each selectable row carries its key. */
function shownRows(): TreeSelection[] {
    return [...treeElement.value?.querySelectorAll<HTMLElement>("[data-row]") ?? []].map(element => rowOf(element.dataset.row!));
}

function setMarked(rows: TreeSelection[], focus: TreeSelection) {
    // `marked` first: the watch on `selected` keeps it when the focus is one of its rows.
    connections.marked = rows.length > 1 ? rows : [];
    connections.selected = focus;
}

/** A click on a row: alone selects it, Ctrl adds or takes it away, Shift takes the rows up to it. */
function onRowClick(event: MouseEvent, at: TreeSelection) {
    const mode = event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "single";
    const current = connections.marked.length > 0 ? connections.marked : connections.selected ? [connections.selected] : [];
    const next = click({ rows: current, anchor: anchor ?? connections.selected }, at, mode, mode === "range" ? shownRows() : []);
    anchor = next.anchor;
    // Taken away with Ctrl: the focus moves to the last row that is still selected.
    const focus = next.rows.some(row => sameRow(row, at)) ? at : next.rows.at(-1)!;
    setMarked(next.rows, focus);
}

/** How far the pointer moves before a press on a row becomes a drag. */
const DRAG_DISTANCE = 5;
/** A drag in the tree is under way; the row it would land on is lit. */
const dragging = shallowRef(false);
let dropRow: HTMLElement | undefined;

/** Collections, databases or a folder dragged onto a folder, or onto their database or connection to leave it. */
function startDrag(event: PointerEvent, source: DragSource): void {
    if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.metaKey) return;
    const start = { x: event.clientX, y: event.clientY };
    let target: DropTarget | undefined;
    const light = (row: HTMLElement | undefined) => {
        if (dropRow === row) return;
        delete dropRow?.dataset.dropActive;
        dropRow = row;
        if (row) row.dataset.dropActive = "";
    };
    const move = (moved: PointerEvent) => {
        if (!dragging.value) {
            if (Math.hypot(moved.clientX - start.x, moved.clientY - start.y) < DRAG_DISTANCE) return;
            dragging.value = true;
        }
        const row = document.elementFromPoint(moved.clientX, moved.clientY)?.closest<HTMLElement>("[data-drop-connection]") ?? undefined;
        const over = row ? dropTargetOf(row) : undefined;
        target = over && canDrop(source, over) ? over : undefined;
        light(target ? row : undefined);
    };
    const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", cancel);
        light(undefined);
        if (!dragging.value) return;
        // The click that ends a drag selects nothing.
        window.addEventListener("click", stop => stop.stopPropagation(), { capture: true, once: true });
        setTimeout(() => (dragging.value = false));
        if (target) void drop(source, target);
    };
    const cancel = () => {
        target = undefined;
        end();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
}

async function drop(source: DragSource, target: DropTarget): Promise<void> {
    const database = source.scope === "" ? undefined : source.scope;
    if (source.folder !== undefined) {
        await actions.moveFolder({ connectionId: source.connectionId, database }, source.folder, target.folder);
        return;
    }
    const rows = (source.names ?? []).map(name => (database === undefined ? { connectionId: source.connectionId, database: name } : { connectionId: source.connectionId, database, collection: name }));
    await actions.moveManyToFolder(rows, target.folder ?? null);
}

/** A collection or database row: with the others selected with it, if it is one of them. */
function dragRows(at: TreeSelection): DragSource {
    const scope = at.collection === undefined ? "" : at.database ?? "";
    const together = isSelected(at) && connections.marked.length > 1
        ? connections.marked.filter(row => row.connectionId === at.connectionId && row.index === undefined && (at.collection === undefined ? row.collection === undefined : row.database === at.database && row.collection !== undefined))
        : [at];
    return { connectionId: at.connectionId, scope, names: together.map(row => row.collection ?? row.database ?? "") };
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

const listMenu = useTemplateRef("listMenu");
const listSearchInput = useTemplateRef("listSearchInput");

function uriOf(profile: Profile) {
    listOpen.value = false;
    void actions.viewUri({ connectionId: profile.id });
}

/**
 * The menu of the list: on a connection everything for it, on the folder
 * only what adds one. Groups of connections and moving between them are not built (one folder).
 */
function openListMenu(event: MouseEvent, profile?: Profile) {
    event.stopPropagation();
    const close = (action: () => void) => () => {
        listOpen.value = false;
        action();
    };
    const head: MenuEntry[] = [
        { label: t("connection.connect"), icon: "i-lucide-plug", hotkey: "Enter", action: () => profile && void choose(profile), disabled: !profile },
        "separator",
        { label: t("connection.add"), icon: "i-lucide-plus", command: "connection.add", action: close(() => actions.newConnection()) },
        { label: t("connection.addFromUri"), icon: "i-lucide-link", action: close(() => void actions.connectFromUri()) }
    ];
    const find: MenuEntry = { label: t("connection.find"), icon: "i-lucide-search", hotkey: "Ctrl + F", action: () => listSearchInput.value?.focus() };
    if (!profile) {
        void listMenu.value?.open(event, [...head, "separator", find]);
        return;
    }
    picked.value = profile.id;
    const at = { connectionId: profile.id };
    void listMenu.value?.open(event, [
        ...head,
        { label: t("connection.clone"), icon: "i-lucide-copy", action: close(() => dialogs.cloneConnection(profile)) },
        "separator",
        { label: t("connection.edit"), icon: "i-lucide-pencil", hotkey: "Ctrl + E", action: () => editPicked() },
        { label: t("action.delete"), icon: "i-lucide-x", hotkey: "Del", danger: true, action: () => deletePicked() },
        "separator",
        { label: t("connection.uri"), command: "connection.uri", action: () => uriOf(profile) },
        "separator",
        find,
        ...noteEntries(at)
    ]);
}

/** Up and down pick, Enter connects, Del deletes, Ctrl+E edits, Ctrl+F searches, the key of "View connection URI" shows it. */
function onListKey(event: KeyboardEvent) {
    const at = listed.value.findIndex(profile => profile.id === picked.value);
    const control = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (control && !event.altKey && key === "e") {
        editPicked();
    } else if (control && !event.altKey && key === "f") {
        listSearchInput.value?.focus();
    } else if (keymap.matches(event, "connection.uri")) {
        // For the picked entry of the list, not for the row of the tree the window's key acts on.
        event.stopPropagation();
        if (pickedProfile.value) uriOf(pickedProfile.value);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
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
    { label: t("database.create"), command: "database.create", action: () => void actions.createDatabase(), disabled: !actions.hasConnection.value },
    { label: t("collection.create"), icon: "i-lucide-file-plus-2", command: "collection.create", action: () => void actions.createCollection(), disabled: !actions.hasDatabase.value },
    { label: t("index.create"), icon: "i-lucide-key-round", command: "index.create", action: () => actions.createIndex(), disabled: !actions.hasCollection.value }
]);

const manageEntries = computed<MenuEntry[]>(() => [
    { label: t("index.list"), icon: "i-lucide-key-round", action: () => actions.indexes(), disabled: !actions.hasCollection.value },
    { label: t("collection.stats"), action: () => actions.collectionStats(), disabled: !actions.hasCollection.value },
    { label: t("database.stats"), action: () => actions.databaseStats(), disabled: !actions.hasDatabase.value },
    { label: t("database.collectionsStats"), action: () => actions.collectionsStats(), disabled: !actions.hasDatabase.value },
    { label: t("connection.status"), icon: "i-lucide-activity", action: () => actions.serverStatus(), disabled: !actions.hasConnection.value },
    { label: t("connection.log"), icon: "i-lucide-scroll-text", action: () => actions.serverLog(), disabled: !actions.hasConnection.value },
    "separator",
    { label: t("users.manage"), icon: "i-lucide-users", command: "users.manage", action: () => actions.manageUsers(), disabled: !actions.hasConnection.value },
    { label: t("roles.manage"), icon: "i-lucide-shield", command: "roles.manage", action: () => actions.manageRoles(), disabled: !actions.hasConnection.value }
]);

/** Arrow left on a row: an open row closes; a closed one leaves it to the tree, which goes up. */
function fold(event: KeyboardEvent, open: boolean, toggle: () => unknown): void {
    if (!open || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    void toggle();
}

/** Arrow right on a row: a closed row opens; an open one leaves it to the tree, which goes down. */
function unfold(event: KeyboardEvent, open: boolean, toggle: () => unknown): void {
    if (open || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    void toggle();
}

/** The rows of the tree a key moves between, top to bottom. */
function treeItems(): HTMLElement[] {
    return [...treeElement.value?.querySelectorAll<HTMLElement>("[role=treeitem]") ?? []];
}

/** Focuses a row; one that can be selected is selected alone (with Shift: the rows up to it). */
function focusItem(item: HTMLElement | undefined, extend: boolean): void {
    if (!item) return;
    item.focus();
    item.scrollIntoView({ block: "nearest" });
    const key = item.dataset.row;
    if (key === undefined) return;
    const at = rowOf(key);
    if (!extend) {
        anchor = at;
        setMarked([], at);
        return;
    }
    const current = connections.marked.length > 0 ? connections.marked : connections.selected ? [connections.selected] : [];
    const next = click({ rows: current, anchor: anchor ?? connections.selected }, at, "range", shownRows());
    setMarked(next.rows, at);
}

/**
 * Arrows as in a tree view (WAI-ARIA): up and down to the row above or below, Home and End to the
 * first and last; right into an open row, left out to the row it lies in.
 */
function onArrowKey(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
    const items = treeItems();
    const current = (event.target as HTMLElement).closest<HTMLElement>("[role=treeitem]");
    const at = current ? items.indexOf(current) : -1;
    if (!current || at === -1) return false;
    const level = (item: HTMLElement | undefined) => Number(item?.getAttribute("aria-level") ?? 0);
    let target: HTMLElement | undefined;
    if (event.key === "ArrowDown") target = items[at + 1];
    else if (event.key === "ArrowUp") target = items[at - 1];
    else if (event.key === "Home") target = items[0];
    else if (event.key === "End") target = items.at(-1);
    else if (event.key === "ArrowRight" && current.getAttribute("aria-expanded") === "true" && level(items[at + 1]) > level(current)) target = items[at + 1];
    else if (event.key === "ArrowLeft") target = items.slice(0, at).reverse().find(item => level(item) < level(current));
    else return false;
    event.preventDefault();
    focusItem(target, event.shiftKey && (event.key === "ArrowDown" || event.key === "ArrowUp"));
    return true;
}

/** Keys on a focused row act on the selected one: Del drops, Ctrl+C copies, Ctrl+V pastes. */
function onTreeKey(event: KeyboardEvent) {
    if (onArrowKey(event)) return;
    const at = connections.selected;
    if (!at) return;
    const many = connections.marked;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
        // Every row shown of the kind of the selected one, as far as they go together.
        setMarked(all(at, shownRows()), at);
    } else if (event.key === "Escape" && many.length > 0) {
        setMarked([], at);
    } else if (many.length > 0 && keymap.matches(event, "tree.drop")) {
        if (kindOf(at) === "connection") return;
        void actions.dropMany(many.filter(row => row.index !== "_id_"));
    } else if (many.length > 0 && keymap.matches(event, "tree.copy")) {
        if (kindOf(at) !== "collection") return;
        copying.copyMany(many.map(row => ({ connectionId: row.connectionId, database: row.database!, collection: row.collection! })));
    } else if (keymap.matches(event, "tree.drop")) {
        if (at.index !== undefined) {
            if (at.index !== "_id_") void actions.dropIndex(at);
        } else if (at.collection !== undefined) {
            void actions.dropCollection(at);
        } else if (at.database !== undefined) {
            void actions.dropDatabase(at);
        } else {
            return;
        }
    } else if (keymap.matches(event, "tree.copy") && at.database !== undefined && at.collection !== undefined && at.index === undefined) {
        copying.copy({ connectionId: at.connectionId, database: at.database, collection: at.collection });
    } else if (keymap.matches(event, "tree.paste") && at.database !== undefined) {
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

/**
 * The menu of several rows selected together: what other clients offer there (DataGrip, DBeaver,
 * Studio 3T) and the app can do for all of them at once. A line at the top says what is selected.
 */
function openManyMenu(event: MouseEvent, rows: TreeSelection[]) {
    const first = rows[0]!;
    const kind = kindOf(first);
    const head: MenuEntry = { label: t(`tree.selected.${kind}`, { count: rows.length }, rows.length), icon: "i-lucide-list-checks", action: () => undefined, disabled: true };
    const readonly = rows.every(row => notes.noteOf({ connectionId: row.connectionId, database: row.database, collection: row.collection })?.readonly === true);
    const marks: MenuEntry[] = [
        "separator",
        { label: t("note.readonly"), icon: "i-lucide-lock", checked: readonly, action: () => void actions.toggleReadonlyMany(rows) },
        { label: t("note.color"), swatches: NOTE_COLORS, current: null, choose: color => void actions.setColorMany(rows, color) }
    ];
    // Folders hold the databases of a connection or the collections of a database: all rows in one.
    const folderOf = kind === "database" ? "" : first.database;
    const folders = (kind === "database" || (kind === "collection" && rows.every(row => row.database === first.database)))
        ? notes.foldersOf(first.connectionId, folderOf ?? "")
        : [];
    const inFolder = rows.some(row => notes.noteOf(row)?.folder);
    const folderEntries: MenuEntry[] = folders.length > 0 || inFolder
        ? ["separator", {
                label: t("folder.menu"),
                icon: "i-lucide-folder",
                children: [
                    ...folders.map(folder => ({ label: t("folder.moveTo", { name: folder }), icon: "i-lucide-folder-input", action: () => void actions.moveManyToFolder(rows, folder) })),
                    ...(inFolder ? [{ label: t("folder.moveOutMany"), icon: "i-lucide-folder-output", action: () => void actions.moveManyToFolder(rows, null) }] : [])
                ]
            }]
        : [];
    const tail: MenuEntry[] = [
        "separator",
        { label: t("action.refresh"), icon: "i-lucide-refresh-cw", command: "tab.refresh", action: () => void actions.refreshMany(rows) }
    ];
    let entries: MenuEntry[];
    if (kind === "connection") {
        entries = [
            head,
            "separator",
            { label: t("tree.collapse"), icon: "i-lucide-chevrons-down-up", command: "tree.collapse", action: () => connections.collapseAll() },
            // A connection from a typed string keeps no notes.
            ...(rows.some(row => connections.isTransient(row.connectionId)) ? [] : marks),
            ...tail,
            { label: t("connection.disconnectMany", { count: rows.length }), command: "connection.disconnect", action: () => void actions.disconnectMany(rows) }
        ];
    } else if (kind === "database") {
        entries = [
            head,
            "separator",
            ...exportEntries(rows),
            "separator",
            { label: t("database.dropMany", { count: rows.length }), command: "tree.drop", danger: true, action: () => void actions.dropMany(rows) },
            ...folderEntries,
            ...marks,
            ...tail
        ];
    } else if (kind === "collection") {
        const places = rows.map(row => ({ connectionId: row.connectionId, database: row.database!, collection: row.collection! }));
        entries = [
            head,
            { label: t("tab.browseMany", { count: rows.length }), icon: "i-lucide-file-text", action: () => actions.browseMany(rows) },
            "separator",
            { label: t("collection.copyMany", { count: rows.length }), icon: "i-lucide-copy", command: "tree.copy", action: () => copying.copyMany(places) },
            ...exportEntries(rows),
            "separator",
            { label: t("collection.dropMany", { count: rows.length }), icon: "i-lucide-file-x-2", command: "tree.drop", danger: true, action: () => void actions.dropMany(rows) },
            ...folderEntries,
            ...marks,
            ...tail
        ];
    } else {
        // The index on _id belongs to the collection: it stays.
        const droppable = rows.filter(row => row.index !== "_id_");
        entries = [
            head,
            "separator",
            { label: t("index.hideMany"), action: () => void actions.toggleIndexesHidden(droppable, true), disabled: droppable.length === 0 },
            { label: t("index.unhideMany"), action: () => void actions.toggleIndexesHidden(droppable, false), disabled: droppable.length === 0 },
            { label: t("index.dropMany", { count: droppable.length }), command: "tree.drop", danger: true, action: () => void actions.dropMany(droppable), disabled: droppable.length === 0 },
            ...tail
        ];
    }
    void menu.value?.open(event, entries);
}

function openMenu(event: MouseEvent, at: TreeSelection) {
    if (connections.marked.length > 1 && connections.marked.some(row => sameRow(row, at))) {
        connections.selected = at;
        openManyMenu(event, connections.marked);
        return;
    }
    anchor = at;
    select(at);
    // Pasting goes into the database of the row; the copy may come from another connection.
    const paste = (database: string): MenuEntry => ({
        label: pasteLabel(),
        icon: "i-lucide-clipboard-paste",
        command: "tree.paste",
        action: () => void copying.paste(at.connectionId, database),
        disabled: !copying.copied.value?.length || copying.running.runId !== undefined
    });
    const tail: MenuEntry[] = [
        "separator",
        { label: t("action.refresh"), icon: "i-lucide-refresh-cw", command: "tab.refresh", action: () => void actions.refresh(at) },
        { label: t("connection.disconnect"), command: "connection.disconnect", action: () => void actions.disconnect(at) }
    ];
    let entries: MenuEntry[];
    if (!connections.sessions[at.connectionId]) {
        // Failed or still being opened:, only its settings and the way out.
        entries = [
            ...(connections.isTransient(at.connectionId)
                ? []
                : [
                    { label: t("connection.settings"), action: () => actions.connectionSettings(at) },
                    { label: t("connection.uri"), command: "connection.uri", action: () => void actions.viewUri(at) },
                    "separator"
                ] satisfies MenuEntry[]),
            { label: t("connection.reconnect"), icon: "i-lucide-refresh-cw", action: () => void actions.reconnect(at) },
            { label: t("connection.disconnect"), command: "connection.disconnect", action: () => void actions.disconnect(at) }
        ];
    } else if (at.index !== undefined) {
        entries = [
            { label: t("tab.shell"), icon: "i-lucide-square-terminal", command: "tab.shell", action: () => actions.openShell(at) },
            "separator",
            { label: t("index.create"), icon: "i-lucide-key-round", command: "index.create", action: () => actions.createIndex(at) },
            { label: t("index.recreate"), command: "index.recreate", action: () => actions.recreateIndex(at), disabled: at.index === "_id_" },
            { label: t("index.duplicate"), icon: "i-lucide-copy", command: "index.duplicate", action: () => actions.duplicateIndex(at), disabled: at.index === "_id_" },
            // The index on _id belongs to the collection: it can be neither dropped nor hidden.
            { label: t(actions.indexOf(at)?.hidden === true ? "index.unhide" : "index.hide"), action: () => void actions.toggleIndexHidden(at), disabled: at.index === "_id_" },
            { label: t("index.drop"), command: "tree.drop", danger: true, action: () => void actions.dropIndex(at), disabled: at.index === "_id_" },
            "separator",
            { label: t("index.info.show"), action: () => actions.indexInfo(at) },
            ...tail
        ];
    } else if (at.collection !== undefined) {
        const node = connections.sessions[at.connectionId]?.databases.find(item => item.name === at.database);
        const bucket = node ? bucketAt(node, at.collection) : undefined;
        entries = [
            ...(bucket === undefined ? [] : [{ label: t("gridfs.open"), icon: "i-lucide-folder-archive", action: () => actions.openGridFs(at, bucket) }]),
            { label: t("tab.browse"), icon: "i-lucide-file-text", command: "tab.browse", action: () => actions.browse(at) },
            "separator",
            { label: t("tab.shell"), icon: "i-lucide-square-terminal", command: "tab.shell", action: () => actions.openShell(at) },
            { label: t("tab.aggregation"), icon: "i-lucide-network", command: "tab.aggregation", action: () => actions.aggregation(at) },
            { label: t("tab.sql"), icon: "i-lucide-file-code-2", command: "tab.sql", action: () => actions.openSql(at) },
            "separator",
            { label: t("collection.create"), icon: "i-lucide-file-plus-2", command: "collection.create", action: () => void actions.createCollection(at) },
            { label: t("view.create"), icon: "i-lucide-file-search", command: "view.create", action: () => actions.createView(at) },
            { label: t("gridfs.create"), icon: "i-lucide-folder-archive", action: () => void actions.createBucket(at) },
            "separator",
            { label: t("collection.copy"), icon: "i-lucide-copy", command: "tree.copy", action: () => copying.copy({ connectionId: at.connectionId, database: at.database!, collection: at.collection! }) },
            paste(at.database!),
            ...exportEntries(at),
            { label: t("import.menu"), icon: "i-lucide-download", command: "import.wizard", action: () => actions.importWizard(at), disabled: isView(at) },
            "separator",
            { label: t("collection.rename"), action: () => void actions.renameCollection(at) },
            { label: t("collection.drop"), icon: "i-lucide-file-x-2", command: "tree.drop", danger: true, action: () => void actions.dropCollection(at) },
            "separator",
            // A view has neither indexes nor a validator of its own.
            { label: t("index.create"), icon: "i-lucide-key-round", command: "index.create", action: () => actions.createIndex(at), disabled: isView(at) },
            { label: t("index.list"), action: () => actions.indexes(at), disabled: isView(at) },
            { label: t("validator.edit"), command: "validator.edit", action: () => actions.editValidator(at), disabled: isView(at) },
            "separator",
            { label: t("collection.stats"), action: () => actions.collectionStats(at) },
            ...folderEntries(at),
            ...noteEntries(at),
            ...tail
        ];
    } else if (at.database !== undefined) {
        entries = [
            { label: t("tab.shell"), icon: "i-lucide-square-terminal", command: "tab.shell", action: () => actions.openShell(at) },
            "separator",
            { label: t("database.create"), command: "database.create", action: () => void actions.createDatabase(at) },
            { label: t("collection.create"), icon: "i-lucide-file-plus-2", command: "collection.create", action: () => void actions.createCollection(at) },
            { label: t("view.create"), icon: "i-lucide-file-search", command: "view.create", action: () => actions.createView(at) },
            { label: t("gridfs.create"), icon: "i-lucide-folder-archive", action: () => void actions.createBucket(at) },
            { label: t("folder.add"), icon: "i-lucide-folder-plus", command: "folder.add", action: () => void actions.addFolder(at) },
            "separator",
            { label: t("collection.copyAll"), icon: "i-lucide-copy", action: () => void copying.copyAll(at.connectionId, at.database!) },
            paste(at.database),
            "separator",
            { label: t("database.drop"), command: "tree.drop", danger: true, action: () => void actions.dropDatabase(at) },
            "separator",
            { label: t("database.stats"), action: () => actions.databaseStats(at) },
            { label: t("database.collectionsStats"), action: () => actions.collectionsStats(at) },
            ...exportEntries(at),
            { label: t("import.menu"), icon: "i-lucide-download", command: "import.wizard", action: () => actions.importWizard(at) },
            "separator",
            { label: t("users.manage"), icon: "i-lucide-users", command: "users.manage", action: () => actions.manageUsers(at) },
            { label: t("roles.manage"), icon: "i-lucide-shield", command: "roles.manage", action: () => actions.manageRoles(at) },
            ...folderEntries(at),
            ...noteEntries(at),
            ...tail
        ];
    } else {
        entries = [
            { label: t("tab.shell"), icon: "i-lucide-square-terminal", command: "tab.shell", action: () => actions.openShell(at) },
            "separator",
            { label: t("database.create"), command: "database.create", action: () => void actions.createDatabase(at) },
            { label: t("folder.add"), icon: "i-lucide-folder-plus", command: "folder.add", action: () => void actions.addFolder(at) },
            "separator",
            { label: t("connection.status"), icon: "i-lucide-activity", action: () => actions.serverStatus(at) },
            { label: t("connection.log"), icon: "i-lucide-scroll-text", action: () => actions.serverLog(at) },
            { label: t("users.manage"), icon: "i-lucide-users", command: "users.manage", action: () => actions.manageUsers(at) },
            { label: t("roles.manage"), icon: "i-lucide-shield", command: "roles.manage", action: () => actions.manageRoles(at) },
            "separator",
            ...exportEntries(at),
            { label: t("import.menu"), icon: "i-lucide-download", command: "import.wizard", action: () => actions.importWizard(at) },
            "separator",
            { label: t("action.refresh"), icon: "i-lucide-refresh-cw", command: "tab.refresh", action: () => void actions.refresh(at) },
            { label: t("tree.collapse"), icon: "i-lucide-chevrons-down-up", command: "tree.collapse", action: () => connections.collapseAll() },
            "separator",
            // A connection from a typed string has no settings, stored string or notes to show.
            ...(connections.isTransient(at.connectionId)
                ? []
                : [
                    { label: t("connection.settings"), action: () => actions.connectionSettings(at) },
                    { label: t("connection.uri"), command: "connection.uri", action: () => void actions.viewUri(at) },
                    ...noteEntries(at)
                ] satisfies MenuEntry[]),
            "separator",
            { label: t("connection.disconnect"), command: "connection.disconnect", action: () => void actions.disconnect(at) }
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
    <!-- Takes what its column leaves below the menu bar (min-h-0, not h-full), so the tree scrolls
         inside it instead of running over the status bar. -->
    <aside class="min-h-0 min-w-0 flex flex-col bg-dock select-none">
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
                            :label="keymap.titled($t('connection.add'), 'connection.add')"
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
                            ref="listSearchInput"
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
                            @contextmenu="openListMenu($event)"
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
                                @contextmenu="openListMenu($event, profile)"
                                @dblclick="choose(profile)"
                                :class="picked === profile.id ? 'tree-row-on' : ''"
                                :title="profile.address"
                                class="tree-row relative h-[21px] pl-11"
                                data-testid="connection-item"
                                role="treeitem"
                                tabindex="0"
                            >
                                <!-- The color of the connection, as in the tree: a bar at the left edge, over the frame of the row. -->
                                <span
                                    v-if="connectionColor(profile)"
                                    :class="`note-${connectionColor(profile)}`"
                                    class="absolute z-1 -left-px -inset-y-px w-[5px] rounded-r-sm pointer-events-none"
                                />
                                <span class="relative size-4 shrink-0">
                                    <span class="i-lucide-server size-4 block text-on-surface" />
                                    <!-- Read-only: a lock over the lower left of the icon. -->
                                    <span
                                        v-if="notes.noteOf({ connectionId: profile.id })?.readonly"
                                        :title="$t('note.readonly')"
                                        class="i-lucide-lock absolute -left-0.5 -bottom-0.5 size-2.5 text-warning"
                                    />
                                </span>
                                <span class="shrink-0 text-on-surface-strong">{{ profile.name }}</span>
                                <span class="truncate italic text-on-surface-variant">{{ profile.address.replace(/^mongodb(\+srv)?:\/\//, "") }}</span>
                            </div>
                        </template>
                    </div>
                    <!-- Inside the panel, so that opening it leaves the panel open. -->
                    <ContextMenu ref="listMenu" />
                </PopoverContent>
            </PopoverRoot>
            <IconButton
                @click="actions.newConnection()"
                :label="keymap.titled($t('connection.add'), 'connection.add')"
                data-testid="connection-add"
                icon="i-lucide-plus"
                tint="text-success"
            />
        </header>

        <div class="h-8 shrink-0 min-w-0 overflow-hidden flex items-center gap-0.5 px-4">
            <IconButton
                @click="actions.openShell()"
                :disabled="!actions.hasConnection.value"
                :label="keymap.titled($t('tab.shell'), 'tab.shell')"
                data-testid="dock-shell"
                icon="i-lucide-square-terminal"
            >
                {{ $t("tab.shell.short") }}
            </IconButton>
            <span class="toolbar-rule" />
            <IconButton
                @click="actions.browse()"
                :disabled="!actions.hasCollection.value"
                :label="keymap.titled($t('tab.browse'), 'tab.browse')"
                data-testid="dock-browse"
                icon="i-lucide-file-text"
            />
            <IconButton
                @click="actions.aggregation()"
                :disabled="!actions.hasCollection.value"
                :label="keymap.titled($t('tab.aggregation'), 'tab.aggregation')"
                icon="i-lucide-network"
            />
            <IconButton
                @click="actions.openSql()"
                :disabled="!actions.hasConnection.value"
                :label="keymap.titled($t('tab.sql'), 'tab.sql')"
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
            ref="tree"
            @keydown="onTreeKey"
            aria-multiselectable="true"
            class="grow min-h-0 overflow-y-auto pt-2 pb-2 text-[13px]"
            role="tree"
        >
            <div
                v-if="connected.length === 0"
                class="pt-14 flex flex-col items-center gap-1 text-center"
            >
                <span class="text-lg text-on-surface-variant">{{ $t("connection.none") }}</span>
                <span class="text-on-surface-variant/70">{{ connectHint }}</span>
            </div>

            <div
                v-for="profile in connected"
                :key="profile.id"
                class="relative"
                data-testid="connection"
            >
                <!-- The color of the connection: a bar along all of its rows. -->
                <span
                    v-if="connectionColor(profile)"
                    :class="`note-${connectionColor(profile)}`"
                    class="absolute z-1 left-0 inset-y-0 w-[5px] rounded-r-sm pointer-events-none"
                    data-testid="connection-color"
                />
                <div
                    @click="onRowClick($event, { connectionId: profile.id })"
                    @contextmenu="openMenu($event, { connectionId: profile.id })"
                    @dblclick="toggleConnection(profile)"
                    @keydown.enter.self="toggleConnection(profile)"
                    @keydown.left.self="fold($event, connections.sessions[profile.id]?.open === true, () => toggleConnection(profile))"
                    @keydown.right.self="unfold($event, connections.sessions[profile.id]?.open !== false, () => toggleConnection(profile))"
                    :aria-expanded="connections.sessions[profile.id] ? connections.sessions[profile.id]!.open : undefined"
                    :aria-selected="isSelected({ connectionId: profile.id })"
                    :class="rowClass({ connectionId: profile.id })"
                    :data-drop-connection="profile.id"
                    :data-row="keyOf({ connectionId: profile.id })"
                    aria-level="1"
                    class="tree-row pl-3.5"
                    data-drop-scope=""
                    data-testid="connection-row"
                    role="treeitem"
                    tabindex="0"
                >
                    <span
                        v-if="connections.connecting.has(profile.id)"
                        :title="$t('connection.connecting')"
                        class="i-lucide-loader-circle animate-spin size-3.5 shrink-0 text-on-surface-variant"
                        data-testid="connection-connecting"
                    />
                    <!-- Could not be opened: a red mark instead of the arrow; the row stays. -->
                    <span
                        v-else-if="connections.failed.has(profile.id)"
                        :title="failure(profile)"
                        class="size-3.5 shrink-0 inline-flex items-center justify-center"
                        data-testid="connection-failed"
                    >
                        <span class="size-2 rounded-full bg-[#f75326]" />
                    </span>
                    <span
                        v-else
                        @click.stop="toggleConnection(profile)"
                        :class="connections.sessions[profile.id]?.open ? 'rotate-90' : ''"
                        class="i-lucide-chevron-right size-3.5 shrink-0 text-on-surface-variant"
                    />
                    <span class="i-lucide-server size-4 shrink-0 text-on-surface" />
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
                            @keydown.left.self="fold($event, notes.isOpen(profile.id, '', databaseRow.name), () => notes.toggleFolder(profile.id, '', databaseRow.name))"
                            @keydown.right.self="unfold($event, notes.isOpen(profile.id, '', databaseRow.name), () => notes.toggleFolder(profile.id, '', databaseRow.name))"
                            @pointerdown="startDrag($event, { connectionId: profile.id, scope: '', folder: databaseRow.name })"
                            :aria-expanded="notes.isOpen(profile.id, '', databaseRow.name)"
                            :aria-level="2 + databaseRow.depth"
                            :data-drop-connection="profile.id"
                            :data-drop-folder="databaseRow.name"
                            :style="indent(1.875 + databaseRow.depth)"
                            class="tree-row"
                            data-drop-scope=""
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
                            <span class="truncate text-on-surface-strong">{{ databaseRow.label }}</span>
                            <span class="grow" />
                            <span class="shrink-0 text-[11px] text-on-surface-variant">{{ databaseRow.count }}</span>
                        </div>
                        <!-- A database, moved in with all below it while it lies in a folder. -->
                        <div
                            v-else
                            :style="databaseRow.depth > 0 ? { '--shift': `${databaseRow.depth}rem` } : undefined"
                        >
                            <template
                                v-for="database in [databaseRow.node]"
                                :key="database.name"
                            >
                                <div
                                    @click="onRowClick($event, { connectionId: profile.id, database: database.name })"
                                    @contextmenu="openMenu($event, { connectionId: profile.id, database: database.name })"
                                    @dblclick="toggleDatabase(profile, database)"
                                    @keydown.enter.self="toggleDatabase(profile, database)"
                                    @keydown.left.self="fold($event, database.open, () => toggleDatabase(profile, database))"
                                    @keydown.right.self="unfold($event, database.open, () => toggleDatabase(profile, database))"
                                    @pointerdown="startDrag($event, dragRows({ connectionId: profile.id, database: database.name }))"
                                    :aria-expanded="database.open"
                                    :aria-level="2 + databaseRow.depth"
                                    :aria-selected="isSelected({ connectionId: profile.id, database: database.name })"
                                    :class="rowClass({ connectionId: profile.id, database: database.name })"
                                    :data-drop-connection="profile.id"
                                    :data-drop-scope="database.name"
                                    :data-row="keyOf({ connectionId: profile.id, database: database.name })"
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
                                            @keydown.left.self="fold($event, notes.isOpen(profile.id, database.name, row.name), () => notes.toggleFolder(profile.id, database.name, row.name))"
                                            @keydown.right.self="unfold($event, notes.isOpen(profile.id, database.name, row.name), () => notes.toggleFolder(profile.id, database.name, row.name))"
                                            @pointerdown="startDrag($event, { connectionId: profile.id, scope: database.name, folder: row.name })"
                                            :aria-expanded="notes.isOpen(profile.id, database.name, row.name)"
                                            :aria-level="3 + databaseRow.depth + row.depth"
                                            :data-drop-connection="profile.id"
                                            :data-drop-folder="row.name"
                                            :data-drop-scope="database.name"
                                            :style="indent(2.875 + row.depth)"
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
                                            <span class="truncate text-on-surface-strong">{{ row.label }}</span>
                                            <span class="grow" />
                                            <span class="shrink-0 text-[11px] text-on-surface-variant">{{ row.count }}</span>
                                        </div>
                                        <template v-else>
                                            <template
                                                v-for="collection in [row.name]"
                                                :key="collection"
                                            >
                                                <div
                                                    @click="onRowClick($event, { connectionId: profile.id, database: database.name, collection })"
                                                    @contextmenu="openMenu($event, { connectionId: profile.id, database: database.name, collection })"
                                                    @dblclick="openRow(profile, database, collection)"
                                                    @keydown.enter="openRow(profile, database, collection)"
                                                    @keydown.left.self="fold($event, database.details[collection]?.open === true, () => toggleCollection(profile, database, collection))"
                                                    @keydown.right.self="unfold($event, database.types[collection] === 'view' || database.details[collection]?.open === true, () => toggleCollection(profile, database, collection))"
                                                    @pointerdown="startDrag($event, dragRows({ connectionId: profile.id, database: database.name, collection }))"
                                                    :aria-expanded="database.types[collection] === 'view' ? undefined : database.details[collection]?.open === true"
                                                    :aria-level="3 + databaseRow.depth + row.depth"
                                                    :aria-selected="isSelected({ connectionId: profile.id, database: database.name, collection })"
                                                    :class="rowClass({ connectionId: profile.id, database: database.name, collection })"
                                                    :data-row="keyOf({ connectionId: profile.id, database: database.name, collection })"
                                                    :style="indent(2.875 + row.depth)"
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
                                                        @click="onRowClick($event, { connectionId: profile.id, database: database.name, collection, index: String(index.name) })"
                                                        @contextmenu="openMenu($event, { connectionId: profile.id, database: database.name, collection, index: String(index.name) })"
                                                        @dblclick="actions.indexInfo({ connectionId: profile.id, database: database.name, collection, index: String(index.name) })"
                                                        :aria-level="4 + databaseRow.depth + row.depth"
                                                        :aria-selected="isSelected({ connectionId: profile.id, database: database.name, collection, index: String(index.name) })"
                                                        :class="rowClass({ connectionId: profile.id, database: database.name, collection, index: String(index.name) })"
                                                        :data-row="keyOf({ connectionId: profile.id, database: database.name, collection, index: String(index.name) })"
                                                        :style="indent(5 + row.depth)"
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
