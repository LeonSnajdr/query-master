import { useNotifications } from "@vuetify/v0";
import { reactive, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import type { ImportOutcome } from "@/api";
import type { RowProgress } from "@/composables/exportWizard";
import { useMessages } from "@/composables/messages";
import { useConnectionsStore } from "@/stores/connections";
import type { TreeSelection } from "@/stores/connections";
import { useNotesStore } from "@/stores/notes";
import { DEFAULT_CSV_READ, formatOf, importJob, rowFor } from "@/transfer/import";
import type { ImportFormat, ImportState } from "@/transfer/import";

/** The pages of the wizard: files and target, CSV settings, CSV columns, progress. */
export type ImportStep = "rows" | "settings" | "schema" | "progress";

const wizard = reactive({
    open: false,
    step: "rows" as ImportStep,
    state: {
        connectionId: "",
        format: "json",
        rows: [],
        csv: { ...DEFAULT_CSV_READ },
        columns: {}
    } as ImportState,
    /** Where a file goes when its name does not say: the database chosen when the wizard opened. */
    database: "",
    /** A collection chosen when the wizard opened: every file goes there. */
    collection: undefined as string | undefined,
    progress: [] as RowProgress[],
    runId: undefined as string | undefined,
    outcome: undefined as ImportOutcome | undefined
});

/** The import wizard: shared by the menus, the tree and the results. */
export function useImportWizard() {
    const { t } = useI18n();
    const { say, report } = useMessages();
    const notifications = useNotifications();
    const connections = useConnectionsStore();
    const notes = useNotesStore();
    const busy = shallowRef(false);

    function databasesOf(connectionId: string): string[] {
        return connections.sessions[connectionId]?.databases.map(database => database.name) ?? [];
    }

    /** Opens the wizard on the server of the selection; a database or collection there is where files go. */
    function openImport(at?: TreeSelection) {
        if (wizard.runId) return;
        Object.assign(wizard, {
            open: true,
            step: "rows",
            database: at?.database ?? "",
            collection: at?.collection,
            progress: [],
            outcome: undefined
        });
        Object.assign(wizard.state, { connectionId: at?.connectionId ?? "", format: "json", rows: [], columns: {} });
    }

    function setFormat(format: ImportFormat) {
        wizard.state.format = format;
        wizard.step = "rows";
    }

    /** Files chosen or dropped; each once. The first files decide the format, by their extension. */
    function addFiles(paths: string[]) {
        const known = new Set(wizard.state.rows.map(row => row.path));
        const fresh = paths.filter(path => !known.has(path));
        if (fresh.length === 0) return;
        if (wizard.state.rows.length === 0) {
            const format = formatOf(fresh[0]!);
            if (format) wizard.state.format = format;
        }
        const databases = databasesOf(wizard.state.connectionId);
        const rows = fresh.map((path) => {
            const row = rowFor(path, databases, wizard.database);
            return wizard.collection === undefined ? row : { ...row, database: wizard.database, collection: wizard.collection };
        });
        wizard.state.rows = [...wizard.state.rows, ...rows];
    }

    /** The target server is opened when it is chosen, so its databases can be offered. */
    async function chooseConnection(connectionId: string) {
        wizard.state.connectionId = connectionId;
        if (connectionId && !connections.sessions[connectionId]) await connections.connect(connectionId).catch(report);
    }

    async function start() {
        const state = wizard.state;
        const locked = state.rows.find(row => notes.isReadonly({ connectionId: state.connectionId, database: row.database.trim(), collection: row.collection.trim() }));
        if (locked) {
            report(new Error(t("error.plan.readonlyTree", { name: `${locked.database}.${locked.collection}` })));
            return;
        }
        const job = importJob(state);
        wizard.progress = state.rows.map(() => ({ state: "waiting", done: 0 }));
        wizard.step = "progress";
        wizard.outcome = undefined;
        wizard.runId = `import-${Date.now()}`;
        busy.value = true;
        try {
            const outcome = await backend.importRun(wizard.runId, job, (update) => {
                const row = wizard.progress[update.item];
                if (!row) return;
                row.state = update.state;
                row.done = update.done;
                row.error = update.error ? say(errorMessage(update.error)) : undefined;
            });
            wizard.outcome = outcome;
            notifications.send({
                subject: t(outcome.failed > 0 ? "import.doneWithFailures" : "import.done", { documents: outcome.documents.toLocaleString(), failed: outcome.failed }, outcome.documents),
                severity: outcome.failed > 0 ? "error" : undefined,
                timeout: 5000
            });
        } catch (error) {
            const message = say(errorMessage(error));
            for (const row of wizard.progress) {
                if (row.state === "waiting" || row.state === "running") Object.assign(row, { state: "failed", error: message });
            }
            report(error);
        } finally {
            wizard.runId = undefined;
            busy.value = false;
            // New collections show in the tree.
            for (const database of new Set(state.rows.map(row => row.database.trim()))) {
                await connections.loadCollections(state.connectionId, database).catch(() => undefined);
            }
            await connections.loadDatabases(state.connectionId).catch(() => undefined);
        }
    }

    function stop() {
        if (wizard.runId) void backend.stopRun(wizard.runId);
    }

    function close() {
        if (wizard.runId) stop();
        wizard.open = false;
    }

    return { wizard, busy, openImport, setFormat, addFiles, chooseConnection, start, stop, close };
}
