import { reactive, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import type { ExportOutcome } from "@/api";
import { useMessages } from "@/composables/messages";
import { useNotices } from "@/composables/notices";
import { useWriteGuard } from "@/composables/writeGuard";
import { useConnectionsStore } from "@/stores/connections";
import type { TreeSelection } from "@/stores/connections";
import { useNotesStore } from "@/stores/notes";
import type { MenuEntry } from "@/menu";
import { DEFAULT_CSV, DEFAULT_SQL, EXPORT_FORMATS, exportJob, exportPreset, isSystemCollection, readExportPreset, rowsFor, switchFormat } from "@/transfer/export";
import type { ExportFormat, ExportPreset, ExportRow, ExportState } from "@/transfer/export";
import { applyProgress, waitingRows } from "@/transfer/progress";
import type { RowProgress } from "@/transfer/progress";

/** The pages of the wizard: rows and destination, settings of the format, columns (CSV, SQL), progress. */
export type WizardStep = "rows" | "settings" | "schema" | "progress";

/** What the wizard was set to after the last run; read from SQLite when it first opens. */
let preset: ExportPreset | undefined;

const wizard = reactive({
    open: false,
    step: "rows" as WizardStep,
    state: {
        connectionId: "",
        format: "json",
        target: "directory",
        path: "",
        rows: [],
        json: { notation: "shell", layout: "lines" },
        csv: { ...DEFAULT_CSV },
        sql: { ...DEFAULT_SQL },
        columns: {},
        database: { connectionId: "", database: "", insertMode: "overwrite", copyIndexes: true }
    } as ExportState,
    progress: [] as RowProgress[],
    runId: undefined as string | undefined,
    outcome: undefined as ExportOutcome | undefined
});

/** The export wizard: shared by the menus, the tree and the results. */
export function useExportWizard() {
    const { t } = useI18n();
    const { say, report } = useMessages();
    const notices = useNotices();
    const connections = useConnectionsStore();
    const notes = useNotesStore();
    const writeGuard = useWriteGuard();
    const busy = shallowRef(false);

    /**
     * The collections a selection stands for: of the connection, the database, or the one. Of a
     * connection or database, the server's own `system.*` collections are left out (the profiler's
     * entries, the definitions of views): they are written by the server and cannot be imported.
     */
    async function collectionsOf(at: TreeSelection): Promise<{ found: { database: string; collection: string }[]; skipped: string[] }> {
        const session = connections.sessions[at.connectionId];
        if (!session) return { found: [], skipped: [] };
        const databases = at.database === undefined ? session.databases.map(database => database.name) : [at.database];
        const found: { database: string; collection: string }[] = [];
        const skipped: string[] = [];
        for (const database of databases) {
            if (at.collection !== undefined) {
                found.push({ database, collection: at.collection });
                continue;
            }
            await connections.loadCollections(at.connectionId, database).catch(() => undefined);
            for (const collection of connections.collectionsOf(at.connectionId, database)) {
                if (isSystemCollection(collection)) skipped.push(`${database}.${collection}`);
                else found.push({ database, collection });
            }
        }
        return { found, skipped };
    }

    /**
     * Opens the wizard with the rows of the selection, or of several rows of one connection
     * selected together; `filter` for the rows of a query. `format` is the tile chosen already
     * ("Export as" in the menus); else JSON.
     */
    async function openExport(selection: TreeSelection | TreeSelection[], filter?: string, format?: ExportFormat) {
        const all = Array.isArray(selection) ? selection : [selection];
        const at = all[0];
        if (!at || busy.value || wizard.runId) return;
        busy.value = true;
        try {
            const collections: { database: string; collection: string }[] = [];
            const skipped: string[] = [];
            for (const item of all) {
                const of = await collectionsOf(item);
                collections.push(...of.found);
                skipped.push(...of.skipped);
            }
            if (skipped.length > 0) notices.notify({ kind: "info", title: t("export.skippedSystem", skipped.length), detail: skipped.join(", ") });
            preset ??= readExportPreset(await backend.getPreset("export").catch(() => null));
            Object.assign(wizard, { open: true, step: "rows", progress: [], outcome: undefined });
            // Always JSON into a folder first; the options are those of the last run.
            Object.assign(wizard.state, {
                connectionId: at.connectionId,
                format: "json",
                target: "directory",
                path: preset.folder,
                rows: rowsFor("json", collections.map(item => ({ ...item, filter }))),
                json: { ...preset.json },
                csv: { ...preset.csv },
                sql: { ...preset.sql },
                columns: {}
            });
            wizard.state.database = { connectionId: at.connectionId, database: "", insertMode: preset.insertMode, copyIndexes: preset.copyIndexes };
            if (format !== undefined && format !== "json") setFormat(format);
        } catch (error) {
            report(error);
        } finally {
            busy.value = false;
        }
    }

    function setFormat(format: ExportFormat) {
        wizard.state.rows = switchFormat(wizard.state.rows, wizard.state.format, format);
        wizard.state.format = format;
        wizard.step = "rows";
    }

    function addRows(rows: ExportRow[]) {
        wizard.state.rows = [...wizard.state.rows, ...rows];
    }

    /** The target connection is opened when it is chosen, so its databases can be offered. */
    async function chooseTargetConnection(connectionId: string) {
        wizard.state.database.connectionId = connectionId;
        if (connectionId && !connections.sessions[connectionId]) await connections.connect(connectionId).catch(report);
    }

    async function start() {
        const state = wizard.state;
        if (state.format === "database" && notes.isReadonly({ connectionId: state.database.connectionId, database: state.database.database })) {
            report(new Error(t("error.plan.readonlyTree", { name: state.database.database })));
            return;
        }
        if (state.format === "database" && !await writeGuard.confirmJob(state.database.connectionId, state.database.database, t("export.menu"))) return;
        let job;
        try {
            job = exportJob(state);
        } catch (error) {
            report(error);
            return;
        }
        preset = exportPreset(state, preset ?? readExportPreset(null));
        backend.savePreset("export", preset).catch(report);
        wizard.progress = waitingRows(state.rows.length);
        wizard.step = "progress";
        wizard.outcome = undefined;
        wizard.runId = `export-${Date.now()}`;
        try {
            const outcome = await backend.exportRun(wizard.runId, job, update => applyProgress(wizard.progress, update, error => say(errorMessage(error))));
            wizard.outcome = outcome;
            if (outcome.clipboard !== null) await navigator.clipboard.writeText(outcome.clipboard);
            // Rows that failed leave a warning that stays; the rows show why in the wizard.
            notices.notify({
                kind: outcome.failed > 0 ? "warning" : "success",
                title: t(outcome.failed > 0 ? "export.doneWithFailures" : "export.done", { documents: outcome.documents.toLocaleString(), failed: outcome.failed }, outcome.documents)
            });
            if (state.format === "database") await connections.loadDatabases(state.database.connectionId).catch(() => undefined);
        } catch (error) {
            // The run did not start or broke off as a whole: what had not finished failed with it.
            const message = say(errorMessage(error));
            for (const row of wizard.progress) {
                if (row.state === "waiting" || row.state === "running") Object.assign(row, { state: "failed", error: message });
            }
            report(error);
        } finally {
            wizard.runId = undefined;
        }
    }

    function stop() {
        if (wizard.runId) void backend.stopRun(wizard.runId);
    }

    function close() {
        if (wizard.runId) stop();
        wizard.open = false;
    }

    /** "Export as": a menu of the formats, each opening the wizard on its tile. */
    function exportAsGroup(open: (format: ExportFormat) => void): MenuEntry {
        return {
            label: t("export.as"),
            icon: "i-lucide-file-output",
            children: EXPORT_FORMATS.map(format => ({ label: `${t(`export.format.${format}`)} …`, action: () => open(format) }))
        };
    }

    return { wizard, busy, openExport, exportAsGroup, setFormat, addRows, chooseTargetConnection, start, stop, close };
}
