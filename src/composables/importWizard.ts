import { reactive, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import type { ImportOutcome } from "@/api";
import { useMessages } from "@/composables/messages";
import { useNotices } from "@/composables/notices";
import { useConnectionsStore } from "@/stores/connections";
import type { TreeSelection } from "@/stores/connections";
import { useNotesStore } from "@/stores/notes";
import { isSystemCollection, splitPath } from "@/transfer/export";
import { DEFAULT_CSV_READ, formatOf, importJob, readImportPreset, rowFor } from "@/transfer/import";
import type { ImportFormat, ImportPreset, ImportState } from "@/transfer/import";
import { applyProgress, waitingRows } from "@/transfer/progress";
import type { RowProgress } from "@/transfer/progress";

/** What the wizard was set to after the last CSV run; read from SQLite when it first opens. */
let preset: ImportPreset | undefined;

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
    const notices = useNotices();
    const connections = useConnectionsStore();
    const notes = useNotesStore();
    const busy = shallowRef(false);

    /** Opens the wizard on the server of the selection; a database or collection there is where files go. */
    async function openImport(at?: TreeSelection) {
        if (wizard.runId) return;
        preset ??= readImportPreset(await backend.getPreset("import").catch(() => null));
        wizard.state.csv = { ...preset.csv };
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

    /**
     * Files chosen or dropped; each once. The first files decide the format, by their extension.
     * Files of the server's own collections (`db.system.profile.json` of an export of everything)
     * are left out with a word: the server does not take documents into them.
     */
    function addFiles(paths: string[]) {
        const known = new Set(wizard.state.rows.map(row => row.path));
        const fresh = paths.filter(path => !known.has(path));
        if (fresh.length === 0) return;
        if (wizard.state.rows.length === 0) {
            const format = formatOf(fresh[0]!);
            if (format) wizard.state.format = format;
        }
        const rows = fresh.map((path) => {
            const row = rowFor(path, wizard.database);
            return wizard.collection === undefined ? row : { ...row, database: wizard.database, collection: wizard.collection };
        });
        const system = rows.filter(row => isSystemCollection(row.collection));
        if (system.length > 0) notices.notify({ kind: "info", title: t("import.skippedSystem", system.length), detail: system.map(row => splitPath(row.path).name).join(", ") });
        wizard.state.rows = [...wizard.state.rows, ...rows.filter(row => !isSystemCollection(row.collection))];
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
        if (state.format === "csv") {
            preset = { csv: { ...state.csv } };
            backend.savePreset("import", preset).catch(report);
        }
        wizard.progress = waitingRows(state.rows.length);
        wizard.step = "progress";
        wizard.outcome = undefined;
        wizard.runId = `import-${Date.now()}`;
        busy.value = true;
        try {
            const outcome = await backend.importRun(wizard.runId, job, update => applyProgress(wizard.progress, update, error => say(errorMessage(error))));
            wizard.outcome = outcome;
            // Files that failed leave a warning that stays; the rows show why in the wizard.
            notices.notify({
                kind: outcome.failed > 0 ? "warning" : "success",
                title: t(outcome.failed > 0 ? "import.doneWithFailures" : "import.done", { documents: outcome.documents.toLocaleString(), failed: outcome.failed }, outcome.documents)
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
