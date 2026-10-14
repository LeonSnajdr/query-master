import { Channel, invoke } from "@tauri-apps/api/core";
import { mockBackend } from "./api.mock";
import type { Doc, Json } from "./shell/ejson";
import { ShellError } from "./shell/message";
import type { Message } from "./shell/message";
import type { CsvColumn } from "./transfer/import";

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

export interface KeybindingChange {
    commandId: string;
    keys: string[] | null;
}

export interface Setting {
    /** `null`: not chosen, the language of the system is used. */
    language: string | null;
    theme: string | null;
    /** Documents per page in new tabs. */
    pageSize: number | null;
    /** `tree`, `table` or `json`: the view new tabs start with. */
    resultView: string | null;
    /** Pixels of the code font. */
    editorFontSize: number | null;
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
    /** The folder of the database a collection is shown in. */
    folder: string | null;
}

/** A folder of a database in the tree. */
export interface TreeFolder {
    database: string;
    name: string;
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

/** How far a row of the export got. */
export interface ExportProgress {
    item: number;
    done: number;
    state: "running" | "done" | "failed" | "stopped";
    /** `{ key, detail }`, for `errorMessage`. */
    error: unknown;
}

export interface ExportOutcome {
    documents: number;
    failed: number;
    stopped: boolean;
    /** The text for the clipboard, when that was the destination. */
    clipboard: string | null;
}

export interface ImportOutcome {
    documents: number;
    failed: number;
    stopped: boolean;
}

/** The head of a CSV file for the import's schema page. */
export interface CsvPreview {
    columns: CsvColumn[];
    rows: string[][];
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
    /** Connects with a string that is not saved; the session lives under `id` until `disconnect`. */
    connectUri: (id: string, uri: string) => Promise<ServerInfo & { address: string }>;
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
    /** The keyboard shortcuts the user changed: keys per command id (`[]`: no shortcut). */
    getKeybindings: () => Promise<Record<string, string[]>>;
    /** In one go; `keys: null` returns the command to its default. */
    saveKeybindings: (changes: KeybindingChange[]) => Promise<void>;
    /** Every command back to its default. */
    clearKeybindings: () => Promise<void>;
    /** The statements that ran on a connection, newest first. */
    listHistory: (connectionId: string) => Promise<string[]>;
    addHistory: (connectionId: string, database: string, statement: string) => Promise<void>;
    clearHistory: (connectionId: string) => Promise<void>;
    /** The export of the wizard (`exportJob` in `src/transfer/export.ts`); progress per row. */
    exportRun: (runId: string, job: Doc, progress: (update: ExportProgress) => void) => Promise<ExportOutcome>;
    /** The import of the wizard: many files, each into its collection; progress per row as for the export. */
    importRun: (runId: string, job: Doc, progress: (update: ExportProgress) => void) => Promise<ImportOutcome>;
    /** The columns of a CSV file with guessed types, and its first rows. */
    importPreview: (path: string, options: Doc) => Promise<CsvPreview>;
    /** What the export or import wizard was set to last, as stored; `null` before the first run. */
    getPreset: (wizard: "export" | "import") => Promise<unknown>;
    savePreset: (wizard: "export" | "import", value: object) => Promise<void>;
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
    listTreeFolders: (connectionId: string) => Promise<TreeFolder[]>;
    addTreeFolder: (connectionId: string, folder: TreeFolder) => Promise<void>;
    /** The collections in it stay in it. */
    renameTreeFolder: (connectionId: string, folder: TreeFolder, name: string) => Promise<void>;
    /** Its collections show in the database again. */
    deleteTreeFolder: (connectionId: string, folder: TreeFolder) => Promise<void>;
}

const tauriBackend: Backend = {
    listConnections: () => invoke("connection_list"),
    connectionUri: id => invoke("connection_uri", { id }),
    saveConnection: input => invoke("connection_save", { input }),
    deleteConnection: id => invoke("connection_delete", { id }),
    testConnection: uri => invoke("test_connection", { uri }),
    connect: id => invoke("connect", { id }),
    connectUri: (id, uri) => invoke("connect_uri", { id, uri }),
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
    getKeybindings: () => invoke("keybinding_list"),
    saveKeybindings: changes => invoke("keybinding_save", { changes }),
    clearKeybindings: () => invoke("keybinding_clear"),
    listHistory: connectionId => invoke("history_list", { connectionId }),
    addHistory: (connectionId, database, statement) => invoke("history_add", { connectionId, database, statement }),
    clearHistory: connectionId => invoke("history_clear", { connectionId }),
    exportRun: (runId, job, progress) => {
        const onProgress = new Channel<ExportProgress>();
        onProgress.onmessage = progress;
        return invoke("export_run", { runId, job, onProgress });
    },
    importRun: (runId, job, progress) => {
        const onProgress = new Channel<ExportProgress>();
        onProgress.onmessage = progress;
        return invoke("import_run", { runId, job, onProgress });
    },
    importPreview: (path, options) => invoke("import_preview", { path, options }),
    getPreset: wizard => invoke("preset_get", { wizard }),
    savePreset: (wizard, value) => invoke("preset_save", { wizard, value }),
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
    removeTreeNotes: (connectionId, path) => invoke("tree_node_remove", { connectionId, path }),
    listTreeFolders: connectionId => invoke("tree_folder_list", { connectionId }),
    addTreeFolder: (connectionId, folder) => invoke("tree_folder_add", { connectionId, folder }),
    renameTreeFolder: (connectionId, folder, name) => invoke("tree_folder_rename", { connectionId, folder, name }),
    deleteTreeFolder: (connectionId, folder) => invoke("tree_folder_delete", { connectionId, folder })
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
