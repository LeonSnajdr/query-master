import { defineStore } from "pinia";
import { reactive } from "vue";
import { backend } from "@/api";
import type { TreeFolder, TreeNote } from "@/api";

/** The colors a row of the tree can carry: eight dots. */
export const NOTE_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "gray"] as const;
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

/** The row, or one above it, is read-only. */
export function readonlyIn(notes: Record<string, TreeNote> | undefined, place: NotePlace): boolean {
    return pathsAbove(place).some(path => notes?.[path]?.readonly === true);
}

/** A row of the collections of a database: a folder, or a collection (in a folder or not). */
export type CollectionRow
    = | { kind: "folder"; name: string; count: number }
        | { kind: "collection"; name: string; folder?: string };

/**
 * The collections of a database as the tree shows them: each folder (also an empty one) with its
 * collections below it, then the collections in no folder. Folders are left out of `open`.
 */
export function collectionRows(
    collections: string[],
    database: string,
    notes: Record<string, TreeNote> | undefined,
    folders: string[],
    open: (folder: string) => boolean
): CollectionRow[] {
    const folderOf = (collection: string) => {
        const folder = notes?.[`${database}/${collection}`]?.folder ?? undefined;
        return folder && folders.includes(folder) ? folder : undefined;
    };
    const rows: CollectionRow[] = [];
    for (const folder of [...folders].sort((a, b) => a.localeCompare(b))) {
        const inside = collections.filter(collection => folderOf(collection) === folder);
        rows.push({ kind: "folder", name: folder, count: inside.length });
        if (open(folder)) rows.push(...inside.map(name => ({ kind: "collection" as const, name, folder })));
    }
    rows.push(...collections.filter(collection => folderOf(collection) === undefined).map(name => ({ kind: "collection" as const, name })));
    return rows;
}

/**
 * Colors, comments and read-only marks of the tree, per connection, kept in the app's database.
 * Read-only on a row holds for everything below it: tabs, shells and the tree's own actions.
 */
export const useNotesStore = defineStore("notes", () => {
    const notes = reactive<Record<string, Record<string, TreeNote>>>({});
    /** Folders per connection. */
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

    async function renameFolder(connectionId: string, database: string, name: string, to: string): Promise<void> {
        await backend.renameTreeFolder(connectionId, { database, name }, to);
        if (openFolders.delete(folderKey(connectionId, database, name))) openFolders.add(folderKey(connectionId, database, to));
        await load(connectionId);
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

    /** Changes part of the note of a row and keeps it; a note left empty is forgotten. */
    async function change(place: NotePlace, update: Partial<Omit<TreeNote, "path">>): Promise<void> {
        const path = notePath(place);
        const note: TreeNote = { path, color: null, comment: null, readonly: false, folder: null, ...noteOf(place), ...update };
        await backend.saveTreeNote(place.connectionId, note);
        const own = notes[place.connectionId] ??= {};
        if (note.color || note.comment || note.readonly || note.folder) own[path] = note;
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

    return { notes, folders, load, noteOf, isReadonly, change, rename, remove, foldersOf, isOpen, toggleFolder, addFolder, renameFolder, deleteFolder };
});
