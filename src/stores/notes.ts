import { defineStore } from "pinia";
import { reactive } from "vue";
import { backend } from "@/api";
import type { TreeNote } from "@/api";

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

/**
 * Colors, comments and read-only marks of the tree, per connection, kept in the app's database.
 * Read-only on a row holds for everything below it: tabs, shells and the tree's own actions.
 */
export const useNotesStore = defineStore("notes", () => {
    const notes = reactive<Record<string, Record<string, TreeNote>>>({});

    async function load(connectionId: string): Promise<void> {
        const list = await backend.listTreeNotes(connectionId);
        notes[connectionId] = Object.fromEntries(list.map(note => [note.path, note]));
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
        const note: TreeNote = { path, color: null, comment: null, readonly: false, ...noteOf(place), ...update };
        await backend.saveTreeNote(place.connectionId, note);
        const own = notes[place.connectionId] ??= {};
        if (note.color || note.comment || note.readonly) own[path] = note;
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

    return { notes, load, noteOf, isReadonly, change, rename, remove };
});
