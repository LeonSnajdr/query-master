import { useNotifications } from "@vuetify/v0";
import { useI18n } from "vue-i18n";
import { backend, inApp } from "@/api";
import type { TransferFormat } from "@/api";
import { useMessages } from "@/composables/messages";
import { useTask } from "@/composables/task";
import { CSV_FILES, JSON_FILES, JSON_LINES_FILES, pickFolder, pickOpenPath, pickSavePath } from "@/files";
import type { FileKind } from "@/files";
import type { Doc } from "@/shell/ejson";
import { ShellError } from "@/shell/message";
import { useNotesStore } from "@/stores/notes";

/** The formats of files, with the kind the file dialog filters for. */
export const TRANSFER_FORMATS: { format: TransferFormat; kind: FileKind; extension: string }[] = [
    { format: "json", kind: JSON_FILES, extension: "json" },
    { format: "jsonLines", kind: JSON_LINES_FILES, extension: "jsonl" },
    { format: "csv", kind: CSV_FILES, extension: "csv" }
];

/** A collection name as a file name: characters Windows forbids become `_`. */
export function fileName(collection: string): string {
    return collection.replace(/[<>:"/\\|?*]/g, "_");
}

/** Where documents go to or come from. */
export interface TransferPlace {
    connectionId: string;
    database: string;
}

/**
 * Documents to and from files on the Rust side, with progress and a way to stop; used by the
 * results and by the tree. Both need the app: a browser has no Rust side.
 */
export function useTransfer() {
    const { t } = useI18n();
    const { report } = useMessages();
    const notifications = useNotifications();
    const notes = useNotesStore();
    const task = useTask();
    const { running } = task;

    /** Writes everything `command` reads into a file the user picks. `false` when cancelled. */
    async function exportCommand(place: TransferPlace, command: Doc, name: string, format: TransferFormat): Promise<boolean> {
        if (!inApp) throw new ShellError("error.transfer.browser");
        const { kind, extension } = TRANSFER_FORMATS.find(item => item.format === format)!;
        const path = await pickSavePath(`${name}.${extension}`, kind);
        if (!path) return false;
        const outcome = await task.track(t("result.export.running"), path, (runId, progress) =>
            backend.exportDocuments(runId, place.connectionId, place.database, command, path, format, progress));
        notifications.send({ subject: t("result.exported", { count: outcome.documents }, outcome.documents), timeout: 3000 });
        if (outcome.skippedFields.length > 0) {
            notifications.send({ subject: t("result.export.skipped", { fields: outcome.skippedFields.join(", ") }), timeout: 8000 });
        }
        return true;
    }

    /** Inserts the documents of a file the user picks into the collection. `false` when cancelled. */
    async function importInto(place: TransferPlace, collection: string): Promise<boolean> {
        if (!inApp) throw new ShellError("error.transfer.browser");
        if (notes.isReadonly({ ...place, collection })) throw new ShellError("error.plan.readonlyTree", { name: `${place.database}.${collection}` });
        const path = await pickOpenPath(TRANSFER_FORMATS.map(item => item.kind));
        if (!path) return false;
        const format: TransferFormat = path.toLowerCase().endsWith(".csv") ? "csv" : "json";
        const outcome = await task.track(t("result.import.running"), path, (runId, progress) =>
            backend.importDocuments(runId, place.connectionId, place.database, collection, path, format, progress));
        notifications.send({ subject: t("result.imported", { count: outcome.documents }, outcome.documents), timeout: 3000 });
        return true;
    }

    /**
     * Every collection of the database into a folder the user picks, one file each, named after
     * the collection. Views and the server's own `system.*` collections are left out.
     */
    async function exportDatabase(place: TransferPlace, format: TransferFormat): Promise<void> {
        try {
            if (!inApp) throw new ShellError("error.transfer.browser");
            const folder = await pickFolder();
            if (!folder) return;
            const page = await backend.runCursorCommand(place.connectionId, place.database, { listCollections: 1, filter: { type: "collection" }, nameOnly: true }, 10_000);
            const names = page.documents.map(item => String(item.name)).filter(name => !name.startsWith("system.")).sort((a, b) => a.localeCompare(b));
            const { extension } = TRANSFER_FORMATS.find(item => item.format === format)!;
            const separator = folder.includes("\\") ? "\\" : "/";
            let documents = 0;
            await task.track(t("database.export.running", { database: place.database }), folder, async (runId, progress) => {
                for (const [position, name] of names.entries()) {
                    const path = `${folder}${separator}${fileName(name)}.${extension}`;
                    const outcome = await backend.exportDocuments(runId, place.connectionId, place.database, { find: name }, path, format, done => progress(documents + done));
                    documents += outcome.documents;
                    progress(documents, 0);
                    running.text = t("database.export.progress", { done: position + 1, total: names.length, folder });
                }
            });
            notifications.send({ subject: t("database.exported", { count: names.length, documents: documents.toLocaleString() }, names.length), timeout: 4000 });
        } catch (error) {
            report(error);
        }
    }

    /** The whole collection into a file. */
    function exportCollection(place: TransferPlace, collection: string, format: TransferFormat): Promise<void> {
        return exportCommand(place, { find: collection }, collection, format).then(() => undefined, report);
    }

    function importCollection(place: TransferPlace, collection: string): Promise<void> {
        return importInto(place, collection).then(() => undefined, report);
    }

    return { exportCommand, importInto, exportCollection, importCollection, exportDatabase };
}
