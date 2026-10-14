import { Channel, invoke } from "@tauri-apps/api/core";
import { mockBackend } from "./api.mock";
import type { Doc, Json } from "./shell/ejson";
import { ShellError } from "./shell/message";
import type { Message } from "./shell/message";

/** A saved connection. Its connection string stays in the keychain. */
export interface Profile {
    id: string;
    name: string;
    /** The connection string without credentials. */
    address: string;
}

export interface ProfileInput {
    /** Absent for a new connection. */
    id?: string;
    name: string;
    uri: string;
}

export interface Setting {
    /** `null`: not chosen, the language of the system is used. */
    language: string | null;
    theme: string | null;
}

/** What a script left behind: its last value and what it printed. */
export interface ScriptResult {
    items: Json[];
    /** The last value had more items than were handed over. */
    truncated: boolean;
    output: string;
}

/** What the app notes on a row of the tree. */
export interface TreeNote {
    /** Empty for the connection, `database`, or `database/collection`. */
    path: string;
    color: string | null;
    comment: string | null;
    readonly: boolean;
}

/** A collection on a connection. */
export interface Place {
    connectionId: string;
    database: string;
    collection: string;
}

export interface CopyProgress {
    copied: number;
    /** As the server estimated it when the copy started. */
    total: number;
}

export interface CopyResult {
    documents: number;
    indexes: number;
    /** The source was a view; it was created again, without documents. */
    view: boolean;
}

/** How documents are written to and read from files. */
export type TransferFormat = "json" | "jsonLines" | "csv";

export interface TransferResult {
    documents: number;
    /** CSV export: fields that appeared only after the columns were fixed, so are not in the file. */
    skippedFields: string[];
}

export interface ServerInfo {
    version: string;
}

export interface CursorPage {
    documents: Doc[];
    hasMore: boolean;
}

/** What the Rust side offers (`src-tauri/src`). Commands and replies are canonical extended JSON. */
export interface Backend {
    listConnections: () => Promise<Profile[]>;
    connectionUri: (id: string) => Promise<string>;
    saveConnection: (input: ProfileInput) => Promise<Profile>;
    deleteConnection: (id: string) => Promise<void>;
    testConnection: (uri: string) => Promise<ServerInfo>;
    connect: (id: string) => Promise<ServerInfo>;
    disconnect: (id: string) => Promise<void>;
    runCommand: (id: string, database: string, command: Doc) => Promise<Doc>;
    /** Reads at most `limit` documents from the cursor the command opens. */
    runCursorCommand: (id: string, database: string, command: Doc, limit: number) => Promise<CursorPage>;
    /** Files the user picked in a file dialog. */
    readTextFile: (path: string) => Promise<string>;
    writeTextFile: (path: string, text: string) => Promise<void>;
    /** Runs a script in the engine of the Rust side; `runId` names the run for `stopRun`. */
    runScript: (id: string, runId: string, database: string, source: string, readonly: boolean) => Promise<ScriptResult>;
    /** Asks a script or a copy to stop. */
    stopRun: (runId: string) => Promise<void>;
    /** Copies a collection with its options, documents and indexes; `replace` drops the target first. */
    copyCollection: (runId: string, source: Place, target: Place, replace: boolean, progress: (progress: CopyProgress) => void) => Promise<CopyResult>;
    getSetting: () => Promise<Setting>;
    saveSetting: (setting: Setting) => Promise<void>;
    /** The statements that ran on a connection, newest first. */
    listHistory: (connectionId: string) => Promise<string[]>;
    addHistory: (connectionId: string, database: string, statement: string) => Promise<void>;
    clearHistory: (connectionId: string) => Promise<void>;
    /** Streams what the cursor command gives into the file at `path`, on the Rust side. */
    exportDocuments: (runId: string, id: string, database: string, command: Doc, path: string, format: TransferFormat, progress: (done: number) => void) => Promise<TransferResult>;
    /** Inserts the documents of the file at `path` into the collection, in batches. */
    importDocuments: (runId: string, id: string, database: string, collection: string, path: string, format: TransferFormat, progress: (done: number) => void) => Promise<TransferResult>;
    /** Stores the file at `path` in the GridFS bucket; gives the new file's `_id`. */
    gridfsUpload: (runId: string, id: string, database: string, bucket: string, path: string, progress: (done: number, total: number) => void) => Promise<Json>;
    /** Writes the file with `fileId` from the bucket to `path`. */
    gridfsDownload: (runId: string, id: string, database: string, bucket: string, fileId: Json, length: number, path: string, progress: (done: number, total: number) => void) => Promise<void>;
    listTreeNotes: (connectionId: string) => Promise<TreeNote[]>;
    /** A note without color, comment and read-only is forgotten. */
    saveTreeNote: (connectionId: string, node: TreeNote) => Promise<void>;
    /** Notes of `from` and below move to `to`. */
    renameTreeNotes: (connectionId: string, from: string, to: string) => Promise<void>;
    removeTreeNotes: (connectionId: string, path: string) => Promise<void>;
}

const tauriBackend: Backend = {
    listConnections: () => invoke("connection_list"),
    connectionUri: id => invoke("connection_uri", { id }),
    saveConnection: input => invoke("connection_save", { input }),
    deleteConnection: id => invoke("connection_delete", { id }),
    testConnection: uri => invoke("test_connection", { uri }),
    connect: id => invoke("connect", { id }),
    disconnect: id => invoke("disconnect", { id }),
    runCommand: (id, database, command) => invoke("run_command", { id, database, command }),
    runCursorCommand: (id, database, command, limit) => invoke("run_cursor_command", { id, database, command, limit }),
    readTextFile: path => invoke("read_text_file", { path }),
    writeTextFile: (path, text) => invoke("write_text_file", { path, text }),
    runScript: (id, runId, database, source, readonly) => invoke("script_run", { id, runId, database, source, readonly }),
    stopRun: runId => invoke("run_stop", { runId }),
    copyCollection: (runId, source, target, replace, progress) => {
        const onProgress = new Channel<CopyProgress>();
        onProgress.onmessage = progress;
        return invoke("copy_collection", { runId, source, target, replace, onProgress });
    },
    getSetting: () => invoke("setting_get"),
    saveSetting: setting => invoke("setting_save", { setting }),
    listHistory: connectionId => invoke("history_list", { connectionId }),
    addHistory: (connectionId, database, statement) => invoke("history_add", { connectionId, database, statement }),
    clearHistory: connectionId => invoke("history_clear", { connectionId }),
    exportDocuments: (runId, id, database, command, path, format, progress) => {
        const onProgress = new Channel<{ done: number }>();
        onProgress.onmessage = update => progress(update.done);
        return invoke("export_documents", { runId, id, database, command, path, format, onProgress });
    },
    importDocuments: (runId, id, database, collection, path, format, progress) => {
        const onProgress = new Channel<{ done: number }>();
        onProgress.onmessage = update => progress(update.done);
        return invoke("import_documents", { runId, id, database, collection, path, format, onProgress });
    },
    gridfsUpload: (runId, id, database, bucket, path, progress) => {
        const onProgress = new Channel<{ done: number; total: number }>();
        onProgress.onmessage = update => progress(update.done, update.total);
        return invoke("gridfs_upload", { runId, id, database, bucket, path, onProgress });
    },
    gridfsDownload: (runId, id, database, bucket, fileId, length, path, progress) => {
        const onProgress = new Channel<{ done: number; total: number }>();
        onProgress.onmessage = update => progress(update.done, update.total);
        return invoke("gridfs_download", { runId, id, database, bucket, fileId, length, path, onProgress });
    },
    listTreeNotes: connectionId => invoke("tree_node_list", { connectionId }),
    saveTreeNote: (connectionId, node) => invoke("tree_node_save", { connectionId, node }),
    renameTreeNotes: (connectionId, from, to) => invoke("tree_node_rename", { connectionId, from, to }),
    removeTreeNotes: (connectionId, path) => invoke("tree_node_remove", { connectionId, path })
};

/** The app runs in its window (and not, for work on the interface, in a browser). */
export const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// In a browser there is no Rust side: the dev server then shows made-up data.
export const backend: Backend = !inApp && import.meta.env.DEV ? mockBackend : tauriBackend;

/**
 * What went wrong, to show: a message of the app by its key, or the text the driver or the
 * system gave. The Rust side sends `{ key, detail }` (`src-tauri/src/error.rs`).
 */
export function errorMessage(error: unknown): string | Message {
    if (error instanceof ShellError) return { key: error.key, params: error.params };
    if (error instanceof Error) return error.message;
    if (typeof error === "object" && error !== null) {
        const { key, detail } = error as { key?: string | null; detail?: string | null };
        if (key) return { key, params: { detail: detail ?? "" } };
        if (detail) return detail;
    }
    return String(error);
}
