import { useNotifications } from "@vuetify/v0";
import { useI18n } from "vue-i18n";
import { backend, inApp } from "@/api";
import type { TransferFormat } from "@/api";
import { useMessages } from "@/composables/messages";
import { useTask } from "@/composables/task";
import { CSV_FILES, JSON_FILES, JSON_LINES_FILES, pickOpenPath, pickSavePath } from "@/files";
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

    /** The whole collection into a file. */
    function exportCollection(place: TransferPlace, collection: string, format: TransferFormat): Promise<void> {
        return exportCommand(place, { find: collection }, collection, format).then(() => undefined, report);
    }

    function importCollection(place: TransferPlace, collection: string): Promise<void> {
        return importInto(place, collection).then(() => undefined, report);
    }

    return { exportCommand, importInto, exportCollection, importCollection };
}
