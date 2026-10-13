import { invoke } from "@tauri-apps/api/core";
import { mockBackend } from "./api.mock";
import type { Doc } from "./shell/ejson";
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
}

const tauriBackend: Backend = {
    listConnections: () => invoke("list_connections"),
    connectionUri: id => invoke("connection_uri", { id }),
    saveConnection: input => invoke("save_connection", { input }),
    deleteConnection: id => invoke("delete_connection", { id }),
    testConnection: uri => invoke("test_connection", { uri }),
    connect: id => invoke("connect", { id }),
    disconnect: id => invoke("disconnect", { id }),
    runCommand: (id, database, command) => invoke("run_command", { id, database, command }),
    runCursorCommand: (id, database, command, limit) => invoke("run_cursor_command", { id, database, command, limit }),
    readTextFile: path => invoke("read_text_file", { path }),
    writeTextFile: (path, text) => invoke("write_text_file", { path, text })
};

/** The app runs in its window (and not, for work on the interface, in a browser). */
export const inApp = "__TAURI_INTERNALS__" in window;

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
