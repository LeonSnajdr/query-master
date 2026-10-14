import { useNotifications } from "@vuetify/v0";
import { reactive, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import type { ExportOutcome } from "@/api";
import { useMessages } from "@/composables/messages";
import { useConnectionsStore } from "@/stores/connections";
import type { TreeSelection } from "@/stores/connections";
import { useNotesStore } from "@/stores/notes";
import { exportJob, rowsFor, switchFormat } from "@/transfer/export";
import type { ExportFormat, ExportRow, ExportState } from "@/transfer/export";

/** A row's progress while the export runs. */
export interface RowProgress {
    state: "waiting" | "running" | "done" | "failed" | "stopped";
    done: number;
    /** The message of a failure, ready to show. */
    error?: string;
}

/** The pages of the wizard: rows and destination, settings of the format, progress. */
export type WizardStep = "rows" | "settings" | "progress";

/** The folder chosen last; the wizard starts with it (for this session). */
let lastFolder = "";

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
    const notifications = useNotifications();
    const connections = useConnectionsStore();
    const notes = useNotesStore();
    const busy = shallowRef(false);

    /** The collections a selection stands for: of the connection, the database, or the one. */
    async function collectionsOf(at: TreeSelection): Promise<{ database: string; collection: string }[]> {
        const session = connections.sessions[at.connectionId];
        if (!session) return [];
        const databases = at.database === undefined ? session.databases.map(database => database.name) : [at.database];
        const found: { database: string; collection: string }[] = [];
        for (const database of databases) {
            if (at.collection !== undefined) {
                found.push({ database, collection: at.collection });
                continue;
            }
            await connections.loadCollections(at.connectionId, database).catch(() => undefined);
            for (const collection of connections.collectionsOf(at.connectionId, database)) found.push({ database, collection });
        }
        return found;
    }

    /** Opens the wizard with the rows of the selection; `filter` for the rows of a query. */
    async function openExport(at: TreeSelection, filter?: string) {
        if (busy.value || wizard.runId) return;
        busy.value = true;
        try {
            const collections = await collectionsOf(at);
            Object.assign(wizard, { open: true, step: "rows", progress: [], outcome: undefined });
            Object.assign(wizard.state, {
                connectionId: at.connectionId,
                format: "json",
                target: at.collection === undefined ? "directory" : "file",
                path: lastFolder,
                rows: rowsFor("json", collections.map(item => ({ ...item, filter })))
            });
            wizard.state.database = { connectionId: at.connectionId, database: "", insertMode: "overwrite", copyIndexes: true };
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
        let job;
        try {
            job = exportJob(state);
        } catch (error) {
            report(error);
            return;
        }
        if (state.target === "directory" && state.format !== "database") lastFolder = state.path;
        wizard.progress = state.rows.map(() => ({ state: "waiting", done: 0 }));
        wizard.step = "progress";
        wizard.outcome = undefined;
        wizard.runId = `export-${Date.now()}`;
        try {
            const outcome = await backend.exportRun(wizard.runId, job, (update) => {
                const row = wizard.progress[update.item];
                if (!row) return;
                row.state = update.state;
                row.done = update.done;
                row.error = update.error ? say(errorMessage(update.error)) : undefined;
            });
            wizard.outcome = outcome;
            if (outcome.clipboard !== null) await navigator.clipboard.writeText(outcome.clipboard);
            notifications.send({
                subject: t(outcome.failed > 0 ? "export.doneWithFailures" : "export.done", { documents: outcome.documents.toLocaleString(), failed: outcome.failed }),
                severity: outcome.failed > 0 ? "error" : undefined,
                timeout: 5000
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

    return { wizard, busy, openExport, setFormat, addRows, chooseTargetConnection, start, stop, close };
}
