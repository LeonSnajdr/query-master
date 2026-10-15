import { shallowRef } from "vue";
import { backend, inApp } from "@/api";

/** Script files opened or saved lately, newest first; read from SQLite on first use. */
const files = shallowRef<string[]>([]);
let loaded: Promise<void> | undefined;

/** The last part of a path: `C:\scripts\orders.js` → `orders.js`. */
export function fileName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

export function useRecentFiles() {
    async function refresh(): Promise<void> {
        files.value = await backend.recentFiles();
    }

    function load(): Promise<void> {
        if (!inApp) return Promise.resolve();
        loaded ??= refresh().catch(() => undefined);
        return loaded;
    }

    async function add(path: string): Promise<void> {
        await backend.addRecentFile(path);
        await refresh();
    }

    async function remove(path: string): Promise<void> {
        await backend.removeRecentFile(path);
        await refresh();
    }

    return { files, load, add, remove };
}
