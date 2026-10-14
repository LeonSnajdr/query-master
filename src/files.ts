import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { backend, inApp } from "./api";

export interface FileKind {
    /** Shown in the file dialog. */
    name: string;
    extensions: string[];
}

export const JSON_FILES: FileKind = { name: "JSON", extensions: ["json"] };
export const JSON_LINES_FILES: FileKind = { name: "JSON Lines", extensions: ["jsonl", "ndjson"] };
export const CSV_FILES: FileKind = { name: "CSV", extensions: ["csv"] };
export const SQL_FILES: FileKind = { name: "SQL", extensions: ["sql"] };
export const SCRIPT_FILES: FileKind = { name: "JavaScript", extensions: ["js", "mongodb"] };

/** Lets the user pick a file and returns its text; `undefined` when they cancel. */
export async function openTextFile(kind: FileKind): Promise<string | undefined> {
    if (inApp) {
        const path = await open({ multiple: false, filters: [kind] });
        return typeof path === "string" ? backend.readTextFile(path) : undefined;
    }
    // In a browser (work on the interface): the browser's own file picker.
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = kind.extensions.map(extension => `.${extension}`).join(",");
        input.onchange = () => resolve(input.files?.[0]?.text());
        input.oncancel = () => resolve(undefined);
        input.click();
    });
}

/** Lets the user pick a file and returns its path; `undefined` when they cancel or outside the app. */
export async function pickFilePath(): Promise<string | undefined> {
    if (!inApp) return undefined;
    const path = await open({ multiple: false });
    return typeof path === "string" ? path : undefined;
}

/** Lets the user pick a folder; its path, `undefined` when they cancel. */
export async function pickFolder(): Promise<string | undefined> {
    const path = await open({ directory: true, multiple: false });
    return typeof path === "string" ? path : undefined;
}

/** Lets the user pick a file of one of the kinds; its path, `undefined` when they cancel. */
export async function pickOpenPath(kinds: FileKind[]): Promise<string | undefined> {
    const path = await open({ multiple: false, filters: kinds });
    return typeof path === "string" ? path : undefined;
}

/** Lets the user pick where to save a file (of the kind, if one is given); its path, `undefined` when they cancel. */
export async function pickSavePath(suggestedName: string, kind?: FileKind): Promise<string | undefined> {
    return (await save({ defaultPath: suggestedName, filters: kind ? [kind] : undefined })) ?? undefined;
}

/** Lets the user pick where to save and writes the text there; `false` when they cancel. */
export async function saveTextFile(suggestedName: string, kind: FileKind, text: string): Promise<boolean> {
    if (inApp) {
        const path = await save({ defaultPath: suggestedName, filters: [kind] });
        if (!path) return false;
        await backend.writeTextFile(path, text);
        return true;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    link.download = suggestedName;
    link.click();
    URL.revokeObjectURL(link.href);
    return true;
}

/** The buttons of the window frame, which the app draws itself. */
export const appWindow = {
    minimize: () => (inApp ? getCurrentWindow().minimize() : Promise.resolve()),
    toggleMaximize: () => (inApp ? getCurrentWindow().toggleMaximize() : Promise.resolve()),
    close: () => (inApp ? getCurrentWindow().close() : Promise.resolve())
};
