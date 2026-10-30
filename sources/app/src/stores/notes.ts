import { defineStore } from "pinia";
import { reactive } from "vue";
import { backend } from "@/api";
import type { TreeFolder, TreeNote } from "@/api";
import { folderLabel, folderWithin, parentFolder } from "@/tree/folders";

/** The colors a row of the tree can carry: eight dots. */
/** In the order of the swatches. */
export const NOTE_COLORS = ["red", "purple", "blue", "teal", "green", "yellow", "orange", "gray"] as const;
export type NoteColor = typeof NOTE_COLORS[number];

/** A row of the tree, as far as notes go: indexes carry none of their own. */
export interface NotePlace {
    connectionId: string;
    database?: string;
    collection?: string;
}

/** Where the note of a row is kept: empty for the connection, `database`, `database/collection`. */
export function notePath(place: NotePlace): string {
    if (place.database === undefined) return "";
    return place.collection === undefined ? place.database : `${place.database}/${place.collection}`;
}

/** The paths a row inherits read-only from, itself last: connection, database, collection. */
export function pathsAbove(place: NotePlace): string[] {
    const paths = [""];
    if (place.database !== undefined) paths.push(place.database);
    if (place.database !== undefined && place.collection !== undefined) paths.push(`${place.database}/${place.collection}`);
    return paths;
}

/** A path as the user reads it, `shop.orders`; undefined for the connection, which has no path. */
export function notePathLabel(path: string): string | undefined {
    return path === "" ? undefined : path.replace("/", ".");
}

/**
 * Whether a row is read-only, and the path of the row that says so: the nearest one, itself first,
 * that is marked read-only or writable. `from` is undefined when none is: then it is writable.
 */
export function readonlyFrom(notes: Record<string, TreeNote> | undefined, place: NotePlace): { readonly: boolean; from?: string } {
    for (const path of pathsAbove(place).reverse()) {
        const readonly = notes?.[path]?.readonly;
        if (readonly === true || readonly === false) return { readonly, from: path };
    }
    return { readonly: false };
}

/** The row is read-only: marked so itself, or taken from the nearest row above that says. */
export function readonlyIn(notes: Record<string, TreeNote> | undefined, place: NotePlace): boolean {
    return readonlyFrom(notes, place).readonly;
}

/**
 * A folder row of the tree. Folders lie in folders: `name` is the whole path (`reports/2024`),
 * `label` its last part; `count` is what lies in it and below; `depth` how many folders it is in.
 */
export interface FolderRow {
    kind: "folder";
    name: string;
    label: string;
    count: number;
    depth: number;
}

/** A row of the collections of a database: a folder, or a collection (in a folder or not). */
export type CollectionRow = FolderRow | { kind: "collection"; name: string; folder?: string; depth: number };

/**
 * The collections of a database as the tree shows them: each folder (also an empty one) with the
 * folders and collections in it below it while open, then the collections in no folder.
 */
export function collectionRows(
    collections: string[],
    database: string,
    notes: Record<string, TreeNote> | undefined,
    folders: string[],
    open: (folder: string) => boolean
): CollectionRow[] {
    return grouped(collections, collection => `${database}/${collection}`, notes, folders, open, "collection");
}

/** A row of the databases of a connection: a folder, or a database (in a folder or not). */
export type DatabaseRow = FolderRow | { kind: "database"; name: string; folder?: string; depth: number };

/** The databases of a connection as the tree shows them, grouped in the folders of the connection. */
export function databaseRows(
    databases: string[],
    notes: Record<string, TreeNote> | undefined,
    folders: string[],
    open: (folder: string) => boolean
): DatabaseRow[] {
    return grouped(databases, database => database, notes, folders, open, "database");
}

/** Each folder (also an empty one) with what lies in it while open, then what lies in none. */
function grouped<Kind extends "collection" | "database">(
    names: string[],
    pathOf: (name: string) => string,
    notes: Record<string, TreeNote> | undefined,
    folders: string[],
    open: (folder: string) => boolean,
    kind: Kind
): (FolderRow | { kind: Kind; name: string; folder?: string; depth: number })[] {
    // A folder inside one that is not kept (any more) still shows inside it.
    const all = new Set<string>();
    for (const folder of folders) {
        for (let path: string | undefined = folder; path !== undefined; path = parentFolder(path)) all.add(path);
    }
    const folderOf = (name: string) => {
        const folder = notes?.[pathOf(name)]?.folder ?? undefined;
        return folder && all.has(folder) ? folder : undefined;
    };
    const placed = names.map(name => ({ name, folder: folderOf(name) }));
    const rows: (FolderRow | { kind: Kind; name: string; folder?: string; depth: number })[] = [];
    const fill = (parent: string | undefined, depth: number) => {
        const inside = [...all].filter(folder => parentFolder(folder) === parent).sort((a, b) => folderLabel(a).localeCompare(folderLabel(b)));
        for (const folder of inside) {
            const count = placed.filter(item => item.folder !== undefined && folderWithin(item.folder, folder)).length;
            rows.push({ kind: "folder", name: folder, label: folderLabel(folder), count, depth });
            if (open(folder)) fill(folder, depth + 1);
        }
        for (const item of placed.filter(entry => entry.folder === parent)) {
            rows.push(item.folder === undefined ? { kind, name: item.name, depth } : { kind, name: item.name, folder: item.folder, depth });
        }
    };
    fill(undefined, 0);
    return rows;
}

/**
 * Colors, comments and read-only marks of the tree, per connection, kept in the app's database.
 * Read-only on a row holds for everything below it (tabs, shells and the tree's own actions) up
 * to a row below marked writable again.
 */
export const useNotesStore = defineStore("notes", () => {
    const notes = reactive<Record<string, Record<string, TreeNote>>>({});
    /** Folders per connection: of a database for its collections, of the connection (database "") for databases. */
    const folders = reactive<Record<string, TreeFolder[]>>({});
    /** Folders unfolded in the tree, as `connection/database/folder`; open when made. */
    const openFolders = reactive(new Set<string>());

    async function load(connectionId: string): Promise<void> {
        const [list, folderList] = await Promise.all([backend.listTreeNotes(connectionId), backend.listTreeFolders(connectionId)]);
        notes[connectionId] = Object.fromEntries(list.map(note => [note.path, note]));
        folders[connectionId] = folderList;
    }

    function foldersOf(connectionId: string, database: string): string[] {
        return (folders[connectionId] ?? []).filter(folder => folder.database === database).map(folder => folder.name);
    }

    function folderKey(connectionId: string, database: string, name: string): string {
        return `${connectionId}/${database}/${name}`;
    }

    function isOpen(connectionId: string, database: string, name: string): boolean {
        return openFolders.has(folderKey(connectionId, database, name));
    }

    /** Folds every folder of every database and connection ("Collapse tree"). */
    function closeFolders(): void {
        openFolders.clear();
    }

    function toggleFolder(connectionId: string, database: string, name: string): void {
        const key = folderKey(connectionId, database, name);
        if (openFolders.has(key)) openFolders.delete(key);
        else openFolders.add(key);
    }

    async function addFolder(connectionId: string, database: string, name: string): Promise<void> {
        await backend.addTreeFolder(connectionId, { database, name });
        openFolders.add(folderKey(connectionId, database, name));
        await load(connectionId);
    }

    /** `to` is the whole new path: renaming and moving into another folder are the same. */
    async function renameFolder(connectionId: string, database: string, name: string, to: string): Promise<void> {
        await backend.renameTreeFolder(connectionId, { database, name }, to);
        // The folders inside it move along, and stay open as they were.
        const prefix = folderKey(connectionId, database, "");
        for (const key of [...openFolders]) {
            if (!key.startsWith(prefix)) continue;
            const folder = key.slice(prefix.length);
            if (!folderWithin(folder, name)) continue;
            openFolders.delete(key);
            openFolders.add(folderKey(connectionId, database, to + folder.slice(name.length)));
        }
        await load(connectionId);
    }

    /**
     * Puts a folder with all in it into another folder (`undefined`: to the top). Not into itself
     * or a folder inside it; `false` when that was asked.
     */
    async function moveFolder(connectionId: string, database: string, name: string, into: string | undefined): Promise<boolean> {
        if (into !== undefined && folderWithin(into, name)) return false;
        const to = into === undefined ? folderLabel(name) : `${into}/${folderLabel(name)}`;
        if (to === name) return true;
        await renameFolder(connectionId, database, name, to);
        if (into !== undefined) openFolders.add(folderKey(connectionId, database, into));
        return true;
    }

    async function deleteFolder(connectionId: string, database: string, name: string): Promise<void> {
        await backend.deleteTreeFolder(connectionId, { database, name });
        await load(connectionId);
    }

    function noteOf(place: NotePlace): TreeNote | undefined {
        return notes[place.connectionId]?.[notePath(place)];
    }

    function isReadonly(place: NotePlace): boolean {
        return readonlyIn(notes[place.connectionId], place);
    }

    function readonlySource(place: NotePlace): { readonly: boolean; from?: string } {
        return readonlyFrom(notes[place.connectionId], place);
    }

    /** Changes part of the note of a row and keeps it; a note left empty is forgotten. */
    async function change(place: NotePlace, update: Partial<Omit<TreeNote, "path">>): Promise<void> {
        const path = notePath(place);
        const note: TreeNote = { path, color: null, comment: null, readonly: null, folder: null, ...noteOf(place), ...update };
        await backend.saveTreeNote(place.connectionId, note);
        const own = notes[place.connectionId] ??= {};
        if (note.color || note.comment || note.readonly !== null || note.folder) own[path] = note;
        else delete own[path];
    }

    /** A database or collection was renamed: the notes of it and below follow. */
    async function rename(connectionId: string, from: string, to: string): Promise<void> {
        await backend.renameTreeNotes(connectionId, from, to);
        await load(connectionId);
    }

    /** A database or collection was dropped: the notes of it and below go. */
    async function remove(connectionId: string, path: string): Promise<void> {
        await backend.removeTreeNotes(connectionId, path);
        await load(connectionId);
    }

    return { notes, folders, load, noteOf, isReadonly, readonlySource, change, rename, remove, foldersOf, isOpen, closeFolders, toggleFolder, addFolder, renameFolder, moveFolder, deleteFolder };
});
