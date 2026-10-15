import { defineStore } from "pinia";
import { computed, markRaw, reactive, ref } from "vue";
import type { Ref } from "vue";
import { backend, errorMessage } from "@/api";
import { preferences } from "@/composables/appearance";
import { useWriteGuard } from "@/composables/writeGuard";
import { isDoc, preview, toNumber, toShell } from "@/shell/ejson";
import type { Doc, Json } from "@/shell/ejson";
import { ShellError, scriptErrorPosition } from "@/shell/message";
import type { Message } from "@/shell/message";
import { convertQueryText, parseStatements, statementAt } from "@/shell/parse";
import type { Statement } from "@/shell/parse";
import { hintsOf, isExplain, readExplain } from "@/shell/explain";
import { analyze, DEFAULT_SAMPLE, sampleCommand } from "@/shell/schema";
import type { ChartPick, SchemaResult } from "@/shell/schema";
import type { ExplainResult } from "@/shell/explain";
import { isWrite, pageCommand, planStatement, replyError } from "@/shell/plan";
import type { Plan } from "@/shell/plan";
import { aggregateStatement, keepsDocuments, newStage, previewStages } from "@/shell/pipeline";
import { addToFilter, filterPath, valueCondition } from "@/shell/values";
import type { PipelineStage } from "@/shell/pipeline";
import { sqlToShell } from "@/sql/sql";
import { useConnectionsStore } from "./connections";
import { useNotesStore } from "./notes";

/** Sizes offered for a page of results. */
export const PAGE_SIZES = [10, 20, 50, 100, 200, 500];
/** Read at most from a cursor whose result is not paged (index lists, counts …). */
const UNPAGED_LIMIT = 10_000;
/** Commands after which the tree of databases and collections may have changed. */
const STRUCTURE_COMMANDS = ["create", "drop", "dropDatabase", "renameCollection"];

export type ResultView = "tree" | "table" | "json" | "plan";

/** The plan of the query a tab shows, as the view "Plan" draws it (stage 19). */
export interface TabExplain {
    /** The statement explained; a new result of another one makes the plan stale. */
    statement: string;
    /** The index forced with `hint`, by name; absent: the server chose. */
    hint?: string;
    plan: ExplainResult;
    /** The response of the server, for the details and the export. */
    reply: Json;
    /** The time before the hint changed, to compare. */
    previousMs?: number;
}
/** The start page, a collection with its query fields, a shell, a pipeline, or a page about the server. */
export type TabKind = "start" | "browse" | "shell" | "aggregate" | "sql" | "server" | "schema";

/** What the schema analysis of a tab found (stage 23). */
export interface TabSchema {
    result: SchemaResult;
    /** The sample size asked for; 0 for all documents. */
    size: number;
    /** Documents in the collection, when it could be told. */
    total?: number;
    milliseconds: number;
    /** Reading all took too long: a sample was read instead. */
    sampledInstead: boolean;
}
/** What a server tab shows. */
/** What a server tab shows; `gridfs` the files of the bucket named in `collection`. */
export type ServerPage = "status" | "log" | "users" | "roles" | "gridfs";
export type StageName = "filter" | "projection" | "sort" | "skip" | "limit";
/** The stages a browse tab can show, in the order they apply. */
export const STAGE_NAMES: StageName[] = ["filter", "projection", "sort", "skip", "limit"];

/** One line of the query of a browse tab. */
export interface Stage {
    name: StageName;
    text: string;
    enabled: boolean;
    /** The text is strict extended JSON instead of shell notation; both run alike. */
    json?: boolean;
}

export interface QueryResult {
    /** Documents of a cursor, the elements of an array, or one value. */
    items: Json[];
    /** Index of the first item in the whole result. */
    offset: number;
    hasMore: boolean;
    /** The statement that was run. */
    statement: string;
    milliseconds: number;
}

/** Shell tabs: the result of one of several statements that ran together, for its own result tab. */
export interface StatementResult {
    /** `orders.find`, `runCommand` … */
    label: string;
    /** Where the statement starts in the text of the tab. */
    start: number;
    result: QueryResult;
    plan: Plan;
}

export interface WorkTab {
    id: string;
    kind: TabKind;
    connectionId: string;
    database: string;
    /** Browse tabs: the collection shown. */
    collection?: string;
    /** Shell tabs: the script. */
    text: string;
    /** Shell tabs: the file the script was opened from or saved to; the tab carries its name. */
    file?: string;
    /** Browse tabs: the query. */
    stages: Stage[];
    view: ResultView;
    pageSize: number;
    /** Writes are refused. */
    readonly: boolean;
    /** Shown rows are narrowed to those that hold this text. */
    search: string;
    running: boolean;
    /** A message of the app, or the text of the server. */
    error?: string | Message;
    /** Where in `text` the error lies. */
    errorPosition?: number;
    result?: QueryResult;
    /** The plan behind `result`, to fetch its other pages. */
    plan?: Plan;
    /** What the last script printed. */
    output?: string;
    /** Shell tabs: the results of several statements run with "Run", one per statement. */
    results?: StatementResult[];
    /** Which of `results` shows as `result`. */
    resultIndex?: number;
    /** The script that is running, to stop it. */
    runId?: string;
    /** Server tabs: what they show. */
    page?: ServerPage;
    /** Aggregate tabs: the stages of the pipeline. */
    pipeline?: PipelineStage[];
    /** Aggregate tabs: shell text of the options (`allowDiskUse`, `maxTimeMS` …). */
    aggregateOptions?: string;
    /** Schema tabs: what the analysis found, and the bars chosen as a filter. */
    schema?: TabSchema;
    picks?: ChartPick[];
    /** The plan of the result (view "Plan"), read when that view shows. */
    explain?: TabExplain;
    /** Dotted path of the field chosen in the result; the status bar shows it. */
    fieldPath?: string;
}

/** Tabs with a query or a script, results and a result view. */
export function isQueryTab(tab: WorkTab | undefined): tab is WorkTab {
    return tab?.kind === "browse" || tab?.kind === "shell" || tab?.kind === "aggregate" || tab?.kind === "sql";
}

/** A failed write the server reports in a reply that is otherwise fine. */
class ReplyError extends Error {
    constructor(readonly reason: string | Message) {
        super(typeof reason === "string" ? reason : reason.key);
    }
}

function isEmptyStage(text: string): boolean {
    return text.replace(/\s/g, "") === "" || text.replace(/\s/g, "") === "{}";
}

/** The shell statement a browse tab stands for. */
export function browseStatement(tab: WorkTab): string {
    const stage = (name: StageName) => {
        const found = tab.stages.find(item => item.name === name && item.enabled);
        return found && !isEmptyStage(found.text) ? found.text.trim() : undefined;
    };
    const projection = stage("projection");
    let statement = `db.getCollection(${JSON.stringify(tab.collection ?? "")}).find(${stage("filter") ?? "{}"}${projection ? `, ${projection}` : ""})`;
    for (const name of ["sort", "skip", "limit"] as const) {
        const text = stage(name);
        if (text) statement += `.${name}(${text})`;
    }
    return statement;
}

export const useTabsStore = defineStore("tabs", () => {
    const connections = useConnectionsStore();
    const notes = useNotesStore();
    const writeGuard = useWriteGuard();
    // Results hold arbitrarily deep JSON: the list is typed by hand instead of unwrapped by Vue.
    const tabs = ref([]) as Ref<WorkTab[]>;
    const activeId = ref<string>();
    const active = computed(() => tabs.value.find(tab => tab.id === activeId.value));
    /** Statements that ran, newest first, per connection; read from the app's database on first use. */
    const history = reactive(new Map<string, string[]>());
    const historyRequests = new Set<string>();
    let counter = 0;

    function create(kind: TabKind, options: Partial<WorkTab>): WorkTab {
        const id = `tab-${++counter}`;
        tabs.value.push({
            id,
            kind,
            connectionId: "",
            database: "",
            text: "",
            stages: [
                { name: "filter", text: "{ }", enabled: true },
                { name: "projection", text: "{ }", enabled: true },
                { name: "sort", text: "{ }", enabled: true }
            ],
            // As chosen in the settings.
            view: preferences.resultView,
            pageSize: preferences.pageSize,
            readonly: false,
            search: "",
            running: false,
            ...options
        });
        activeId.value = id;
        // The object in the list is the reactive one.
        return tabs.value.at(-1)!;
    }

    /**
     * A tab of the last session, as it was but without its result (stage 20). Nothing runs: the
     * connection opens when the tab runs.
     */
    function restoreTab(kind: TabKind, connectionId: string, content: Doc): WorkTab {
        const text = (key: string) => (typeof content[key] === "string" ? content[key] : undefined);
        const options: Partial<WorkTab> = { connectionId, database: text("database") ?? "" };
        if (text("collection") !== undefined) options.collection = text("collection");
        if (text("text") !== undefined) options.text = text("text");
        if (text("file") !== undefined) options.file = text("file");
        if (Array.isArray(content.stages)) options.stages = (content.stages as unknown as Stage[]).map(stage => ({ ...stage }));
        if (Array.isArray(content.pipeline)) {
            options.pipeline = (content.pipeline as unknown as { operator: string; text: string; enabled: boolean }[]).map(stage => newStage(stage.operator, stage.text, stage.enabled));
            options.aggregateOptions = text("options") || undefined;
        }
        if (text("page") !== undefined) options.page = text("page") as ServerPage;
        if (text("view") !== undefined) options.view = text("view") as ResultView;
        const pageSize = toNumber(content.pageSize);
        if (pageSize !== undefined && pageSize > 0) options.pageSize = pageSize;
        return create(kind, options);
    }

    /** The schema analysis of a collection in a tab of its own (stage 23); it reads at once. */
    function openSchema(target: { connectionId: string; database: string; collection: string }): WorkTab {
        const open = tabs.value.find(item => item.kind === "schema" && item.connectionId === target.connectionId && item.database === target.database && item.collection === target.collection);
        if (open) {
            activeId.value = open.id;
            return open;
        }
        const tab = create("schema", { ...target, picks: [] });
        void analyzeSchema(tab, DEFAULT_SAMPLE);
        return tab;
    }

    /**
     * Reads a sample of the collection (all of it with `size` 0, within a time limit; when that
     * runs out, a sample of 5000) and analyses it. The fields and values also go to the editor.
     */
    function analyzeSchema(tab: WorkTab, size = tab.schema?.size ?? DEFAULT_SAMPLE): Promise<boolean> {
        return guarded(tab, async () => {
            const collection = tab.collection ?? "";
            const started = performance.now();
            let sampledInstead = false;
            let documents: Json[];
            const read = async (count: number) => (await backend.runCursorCommand(tab.connectionId, tab.database, sampleCommand(collection, count), count > 0 ? count : 1_000_000)).documents;
            try {
                documents = await read(size);
            } catch (error) {
                if (size !== 0) throw error;
                sampledInstead = true;
                documents = await read(5000);
            }
            let total: number | undefined;
            try {
                total = toNumber((await backend.runCommand(tab.connectionId, tab.database, { count: collection })).n);
            } catch {
                total = undefined;
            }
            connections.rememberSample(tab.connectionId, tab.database, collection, documents);
            tab.schema = markRaw({ result: analyze(documents), size, total, milliseconds: Math.round(performance.now() - started), sampledInstead });
        });
    }

    /** The documents the chosen bars stand for, in the document browser of the collection. */
    function browseFiltered(target: { connectionId: string; database: string; collection: string }, filter: Doc): WorkTab {
        const tab = create("browse", target);
        tab.stages[0]!.text = preview(filter, Number.POSITIVE_INFINITY);
        void runBrowse(tab);
        return tab;
    }

    function openStart(): void {
        const existing = tabs.value.find(tab => tab.kind === "start");
        if (existing) activeId.value = existing.id;
        else create("start", {});
    }

    /**
     * The documents of a collection. A tab already open on it comes to the front instead of a second
     * one (a wish from the Compass feedback); `newTab` opens one anyway.
     */
    function openBrowse(target: { connectionId: string; database: string; collection: string }, newTab = false): WorkTab {
        const open = newTab ? undefined : tabs.value.find(item => item.kind === "browse" && item.connectionId === target.connectionId && item.database === target.database && item.collection === target.collection);
        if (open) {
            activeId.value = open.id;
            return open;
        }
        const tab = create("browse", target);
        void runBrowse(tab);
        return tab;
    }

    function openShell(target: { connectionId: string; database: string; collection?: string; text?: string }): WorkTab {
        const text = target.text ?? (target.collection ? `db.getCollection(${JSON.stringify(target.collection)}).find({})` : "db.");
        return create("shell", { connectionId: target.connectionId, database: target.database, text });
    }

    /** The SQL builder on a database, with a first SELECT on the collection if one is given. */
    function openSql(target: { connectionId: string; database: string; collection?: string }): WorkTab {
        const text = `SELECT *\nFROM ${target.collection ?? "collection"}\nLIMIT 100`;
        return create("sql", { connectionId: target.connectionId, database: target.database, text });
    }

    /** The aggregation builder on a collection, with the stages given or one empty $match. */
    function openAggregate(target: { connectionId: string; database: string; collection: string; pipeline?: PipelineStage[]; aggregateOptions?: string }): WorkTab {
        return create("aggregate", { ...target, pipeline: target.pipeline ?? [newStage("$match", "{ }")] });
    }

    /**
     * The status or the log of a server, or the users or roles of a database; a tab that shows it
     * already comes to the front.
     */
    function openServer(connectionId: string, page: ServerPage, database = "admin", collection?: string): WorkTab {
        const existing = tabs.value.find(tab => tab.kind === "server" && tab.connectionId === connectionId && tab.page === page && tab.database === database && tab.collection === collection);
        if (existing) {
            activeId.value = existing.id;
            return existing;
        }
        return create("server", { connectionId, database, collection, page });
    }

    function duplicate(tab: WorkTab): void {
        if (!isQueryTab(tab)) return;
        const copy = create(tab.kind, {
            connectionId: tab.connectionId,
            database: tab.database,
            collection: tab.collection,
            text: tab.text,
            stages: tab.stages.map(stage => ({ ...stage })),
            pipeline: tab.pipeline?.map(stage => newStage(stage.operator, stage.text, stage.enabled)),
            aggregateOptions: tab.aggregateOptions,
            view: tab.view,
            pageSize: tab.pageSize,
            readonly: tab.readonly
        });
        if (copy.kind === "browse") void runBrowse(copy);
        if (copy.kind === "aggregate") void runAggregate(copy);
    }

    function close(id: string): void {
        const index = tabs.value.findIndex(tab => tab.id === id);
        if (index === -1) return;
        tabs.value.splice(index, 1);
        if (activeId.value === id) activeId.value = (tabs.value[index] ?? tabs.value[index - 1])?.id;
    }

    function closeOthers(id: string): void {
        tabs.value = tabs.value.filter(tab => tab.id === id);
        activeId.value = id;
    }

    function closeAll(): void {
        tabs.value = [];
        activeId.value = undefined;
    }

    function closeConnection(connectionId: string): void {
        for (const tab of tabs.value.filter(item => item.connectionId === connectionId)) close(tab.id);
    }

    /** Puts a tab at another place in the row. */
    function move(id: string, index: number): void {
        const from = tabs.value.findIndex(tab => tab.id === id);
        const to = Math.max(0, Math.min(index, tabs.value.length - 1));
        if (from === -1 || from === to) return;
        const [tab] = tabs.value.splice(from, 1);
        tabs.value.splice(to, 0, tab!);
    }

    /** Makes the tab after (1) or before (-1) the active one the active one. */
    function step(direction: -1 | 1): void {
        const index = tabs.value.findIndex(tab => tab.id === activeId.value);
        const count = tabs.value.length;
        if (count > 0) activeId.value = tabs.value[(index + direction + count) % count]!.id;
    }

    /** The history of a connection as far as loaded; the first call fetches it. */
    function historyOf(connectionId: string): string[] {
        if (!history.has(connectionId) && !historyRequests.has(connectionId)) {
            historyRequests.add(connectionId);
            backend.listHistory(connectionId)
                .then(statements => history.set(connectionId, statements))
                .catch(() => history.set(connectionId, []))
                .finally(() => historyRequests.delete(connectionId));
        }
        return history.get(connectionId) ?? [];
    }

    function remember(tab: WorkTab, statement: string): void {
        history.set(tab.connectionId, [statement, ...historyOf(tab.connectionId).filter(item => item !== statement)]);
        // The result is there either way; a history that could not be written is not worth an error on top.
        void backend.addHistory(tab.connectionId, tab.database, statement).catch(error => console.warn("History was not saved", error));
    }

    async function clearHistory(connectionId: string): Promise<void> {
        await backend.clearHistory(connectionId);
        history.set(connectionId, []);
    }

    /** The row of the tree the tab is on, or one above it, is marked read-only. */
    function lockedByTree(tab: WorkTab, database = tab.database, collection = tab.collection): boolean {
        return notes.isReadonly({ connectionId: tab.connectionId, database, collection });
    }

    /** Writes are refused: by the tab's own lock or by a mark in the tree. */
    function locked(tab: WorkTab): boolean {
        return tab.readonly || lockedByTree(tab);
    }

    /** Refuses a write the tab's lock or the tree forbids; `collection` is the one written to. */
    function guardWrite(tab: WorkTab, write: boolean, database = tab.database, collection = tab.collection): void {
        if (!write) return;
        if (tab.readonly) throw new ShellError("error.plan.readonly");
        if (lockedByTree(tab, database, collection)) throw new ShellError("error.plan.readonlyTree", { name: collection === undefined ? database : `${database}.${collection}` });
    }

    /** The collection a command names first (`insert: "orders"`), if it names one. */
    function commandCollection(plan: Plan): string | undefined {
        const first = Object.values(plan.command)[0];
        return typeof first === "string" ? first : undefined;
    }

    async function fetch(tab: WorkTab, plan: Plan, offset: number, statement: string): Promise<void> {
        guardWrite(tab, isWrite(plan), plan.database, commandCollection(plan));
        // On a connection marked test or production the user is asked first (stage 21).
        if (isWrite(plan) && !await writeGuard.confirmWrite(tab.connectionId, plan.database, plan.command, { statement })) throw new ShellError("error.write.cancelled");
        const started = performance.now();
        let items: Json[];
        let hasMore = false;
        if (plan.cursor) {
            const command = pageCommand(plan, offset, tab.pageSize);
            const paged = plan.paging !== undefined && !plan.shape;
            const page = command
                ? await backend.runCursorCommand(tab.connectionId, plan.database, command, paged ? tab.pageSize : UNPAGED_LIMIT)
                : { documents: [], hasMore: false };
            const shaped = plan.shape ? plan.shape(page.documents) : page.documents;
            items = Array.isArray(shaped) ? shaped : [shaped];
            hasMore = paged && page.hasMore;
        } else {
            const reply = await backend.runCommand(tab.connectionId, plan.database, plan.command);
            const failure = replyError(reply);
            if (failure) throw new ReplyError(failure);
            const shaped = plan.shape ? plan.shape(reply) : reply;
            items = Array.isArray(shaped) ? shaped : [shaped];
            const name = Object.keys(plan.command)[0] ?? "";
            if (STRUCTURE_COMMANDS.includes(name)) void connections.loadDatabases(tab.connectionId).catch(() => undefined);
        }
        tab.plan = markRaw(plan);
        tab.result = markRaw({ items, offset, hasMore, statement, milliseconds: Math.round(performance.now() - started) });
        if (tab.explain?.statement !== statement) tab.explain = undefined;
    }

    async function guarded(tab: WorkTab, work: () => Promise<void>): Promise<boolean> {
        if (tab.running) return false;
        tab.running = true;
        tab.error = undefined;
        tab.errorPosition = undefined;
        try {
            // A tab of the last session runs before its saved connection is open: it opens now.
            if (!connections.sessions[tab.connectionId] && connections.profiles.some(profile => profile.id === tab.connectionId) && !connections.isTransient(tab.connectionId)) {
                await connections.connect(tab.connectionId);
            }
            await work();
            return true;
        } catch (error) {
            tab.error = error instanceof ReplyError ? error.reason : errorMessage(error);
            tab.errorPosition = (error as { position?: number } | undefined)?.position;
            return false;
        } finally {
            tab.running = false;
        }
    }

    /**
     * Runs the text as a script in the engine of the Rust side: variables, loops, `print`. What it
     * prints shows while it runs; `start` is where `source` begins in the text of the tab.
     */
    async function runScript(tab: WorkTab, source: string, start = 0): Promise<void> {
        if (!await writeGuard.confirmScript(tab.connectionId, tab.database, source)) throw new ShellError("error.write.cancelled");
        const started = performance.now();
        tab.runId = `${tab.id}-${Date.now()}`;
        tab.output = undefined;
        try {
            // A script may write anywhere on the connection: any read-only mark on it makes the run read-only.
            const marked = Object.values(notes.notes[tab.connectionId] ?? {}).some(note => note.readonly);
            const outcome = await backend.runScript(tab.connectionId, tab.runId, tab.database, source, tab.readonly || marked, (text) => {
                tab.output = (tab.output ?? "") + text;
            });
            tab.output = outcome.output || undefined;
            if (outcome.cursor) {
                // A cursor the script did not read runs here, so it can be paged and edited like a statement.
                const { database, ...call } = outcome.cursor;
                await fetch(tab, planStatement({ ...call, start: 0, end: 0 }, database), 0, source);
                return;
            }
            tab.plan = undefined;
            tab.result = markRaw({
                items: outcome.items,
                offset: 0,
                hasMore: outcome.truncated,
                statement: source,
                milliseconds: Math.round(performance.now() - started)
            });
        } catch (error) {
            // The engine names the place of the mistake; the cursor of the editor goes there.
            const detail = (error as { detail?: unknown } | undefined)?.detail;
            const position = typeof detail === "string" ? scriptErrorPosition(detail, source) : undefined;
            if (position !== undefined && error !== null && typeof error === "object") Object.assign(error, { position: start + position });
            throw error;
        } finally {
            tab.runId = undefined;
        }
    }

    /** Asks a running script to stop; it ends with an error saying so. */
    function stop(tab: WorkTab): void {
        if (tab.runId) void backend.stopRun(tab.runId);
    }

    /**
     * Shell tabs: runs the statement at `position`; of a selection, the first statement in it.
     * Text that is more than `db.…` statements with fixed values runs as a script, as a whole,
     * and so do several statements when `whole` is set (the Run button).
     */
    function run(tab: WorkTab, position: number, selection?: string, whole = false): Promise<boolean> {
        return guarded(tab, async () => {
            const selected = selection?.trim() ? selection : undefined;
            const source = selected ?? tab.text;
            tab.results = undefined;
            tab.resultIndex = undefined;
            // The editor gives the end of a selection that was made forwards, the start of one made backwards.
            const start = selected === undefined ? 0 : tab.text.startsWith(selected, position) ? position : Math.max(0, position - selected.length);
            let statements;
            try {
                statements = parseStatements(source);
            } catch (error) {
                if (!(error instanceof ShellError)) throw error;
                // Not a plain statement (or not valid at all): the engine runs it, or says what is wrong.
                await runScript(tab, source, start);
                remember(tab, source);
                return;
            }
            // Only the engine can do `bulkWrite`.
            if (statements.some(item => item.method === "bulkWrite")) {
                await runScript(tab, source, start);
                remember(tab, source);
                return;
            }
            // "Run" on several statements runs them all, in order, as the shell would: each result in a
            // tab of its own, which can be paged and edited like that of one statement.
            if (whole && !selected && statements.length > 1) {
                await runEach(tab, statements, source);
                return;
            }
            const statement = statementAt(statements, selected ? 0 : position);
            if (!statement) throw new ShellError("error.plan.nothing");
            const plan = planStatement(statement, tab.database);
            const text = source.slice(statement.start, statement.end);
            tab.output = undefined;
            await fetch(tab, plan, 0, text);
            remember(tab, text);
        });
    }

    /** Several statements, one after the other; a failing one stops the rest and keeps the cursor on it. */
    async function runEach(tab: WorkTab, statements: Statement[], source: string): Promise<void> {
        tab.output = undefined;
        const results: StatementResult[] = [];
        try {
            for (const statement of statements) {
                const text = source.slice(statement.start, statement.end);
                try {
                    await fetch(tab, planStatement(statement, tab.database), 0, text);
                } catch (error) {
                    if (error !== null && typeof error === "object") Object.assign(error, { position: statement.start });
                    throw error;
                }
                const label = statement.collection === undefined ? statement.method : `${statement.collection}.${statement.method}`;
                results.push({ label, start: statement.start, result: tab.result!, plan: tab.plan! });
            }
        } finally {
            if (results.length > 0) {
                tab.results = results;
                tab.resultIndex = results.length - 1;
            }
            remember(tab, source);
        }
    }

    /** Shows the result of another of the statements that ran together; the one shown keeps its page. */
    function showResult(tab: WorkTab, index: number): void {
        const results = tab.results;
        const target = results?.[index];
        if (!results || !target || tab.running) return;
        const current = tab.resultIndex === undefined ? undefined : results[tab.resultIndex];
        if (current && tab.result && tab.plan) results[tab.resultIndex!] = { ...current, result: tab.result, plan: tab.plan };
        tab.resultIndex = index;
        tab.result = target.result;
        tab.plan = target.plan;
        tab.error = undefined;
    }

    /** Browse tabs: runs the query its fields describe. */
    function runBrowse(tab: WorkTab): Promise<boolean> {
        return guarded(tab, async () => {
            const text = browseStatement(tab);
            let statement;
            try {
                [statement] = parseStatements(text);
            } catch (error) {
                // The place is one in the composed statement, not in a field.
                throw error instanceof ShellError ? new ShellError(error.key, error.params) : error;
            }
            if (!statement) throw new ShellError("error.plan.nothing");
            await fetch(tab, planStatement(statement, tab.database), 0, text);
            remember(tab, text);
        });
    }

    /**
     * Aggregate tabs: runs the stages that are switched on; with `upTo`, only those up to that
     * stage and none that writes, to look at the documents there.
     */
    function runAggregate(tab: WorkTab, upTo?: number): Promise<boolean> {
        return guarded(tab, async () => {
            const stages = tab.pipeline ?? [];
            const text = aggregateStatement(tab.collection ?? "", upTo === undefined ? stages : previewStages(stages, upTo), tab.aggregateOptions);
            let statement;
            try {
                [statement] = parseStatements(text);
            } catch (error) {
                throw error instanceof ShellError ? new ShellError(error.key, error.params) : error;
            }
            if (!statement) throw new ShellError("error.plan.nothing");
            await fetch(tab, planStatement(statement, tab.database), 0, text);
            remember(tab, text);
        });
    }

    /** SQL tabs: the SELECT becomes a shell statement, which runs like one typed in the shell. */
    function runSql(tab: WorkTab): Promise<boolean> {
        return guarded(tab, async () => {
            // A mistake in the SQL keeps its place in the SQL text.
            const text = sqlToShell(tab.text);
            const [statement] = parseStatements(text);
            if (!statement) throw new ShellError("error.plan.nothing");
            await fetch(tab, planStatement(statement, tab.database), 0, text);
            remember(tab, tab.text);
        });
    }

    function runTab(tab: WorkTab): Promise<boolean> {
        if (tab.kind === "aggregate") return runAggregate(tab);
        if (tab.kind === "sql") return runSql(tab);
        return tab.kind === "browse" ? runBrowse(tab) : run(tab, 0, undefined, true);
    }

    /**
     * Reads the plan of the query the tab shows (`explain("executionStats")`), for the view "Plan".
     * `hint` forces an index by name (`null`: the server chooses again). A result that is a plan
     * itself (`.explain()` typed in the shell) is read as it is.
     */
    function explainResult(tab: WorkTab, hint?: string | null): Promise<boolean> {
        return guarded(tab, async () => {
            const result = tab.result;
            if (!result) return;
            const before = tab.explain;
            const first = result.items[0];
            if (result.items.length === 1 && isExplain(first)) {
                const plan = readExplain(first, tab.collection ?? "");
                if (plan) tab.explain = markRaw({ statement: result.statement, plan: { ...plan, hints: hintsOf(plan, tab.plan?.command ?? {}) }, reply: first });
                return;
            }
            const [statement] = parseStatements(result.statement);
            if (!statement) throw new ShellError("error.plan.nothing");
            const modifiers = statement.modifiers.filter(modifier => modifier.name !== "explain" && modifier.name !== "hint");
            const forced = hint === undefined ? before?.hint : hint ?? undefined;
            if (forced) modifiers.push({ name: "hint", args: [forced] });
            modifiers.push({ name: "explain", args: ["executionStats"] });
            const plan = planStatement({ ...statement, modifiers }, tab.database);
            const reply = await backend.runCommand(tab.connectionId, plan.database, plan.command);
            const failure = replyError(reply);
            if (failure) throw new ReplyError(failure);
            const read = readExplain(reply, statement.collection ?? tab.collection ?? "");
            if (!read) throw new ShellError("error.explain.none");
            tab.explain = markRaw({
                statement: result.statement,
                hint: forced,
                plan: { ...read, hints: hintsOf(read, plan.command) },
                reply,
                previousMs: hint !== undefined && before ? before.plan.ms : before?.previousMs
            });
        });
    }

    /** Shows the page that starts at `offset`. */
    function showPage(tab: WorkTab, offset: number): Promise<boolean> {
        const { plan, result } = tab;
        if (!plan || !result) return Promise.resolve(false);
        return guarded(tab, () => fetch(tab, plan, Math.max(0, offset), result.statement));
    }

    /** Runs the last query again, staying on the page shown. */
    function refresh(tab: WorkTab): Promise<boolean> {
        return tab.result ? showPage(tab, tab.result.offset) : runTab(tab);
    }

    /** The collection the shown documents come from, when the result is one of documents of a collection. */
    function sourceCollection(tab: WorkTab): string | undefined {
        if (tab.kind === "browse") return tab.collection;
        // Documents a pipeline reshaped are not documents of the collection any more.
        if (tab.kind === "aggregate") return keepsDocuments(tab.pipeline ?? []) ? tab.collection : undefined;
        const command = tab.plan?.command;
        if (!command || tab.plan?.shape) return undefined;
        const name = command.find ?? command.aggregate;
        return typeof name === "string" ? name : undefined;
    }

    /**
     * "Filter by this value" (as Compass does from its schema view): a browse tab gets `field: value`
     * in its filter and runs again; any other tab with documents of a collection opens a browse tab
     * on it, with the filter of its `find` and the value. Several values become `$in`; `exclude`
     * keeps the documents without them (`$ne`, `$nin`).
     */
    async function filterByValue(tab: WorkTab, path: string, values: Json[], exclude = false): Promise<boolean> {
        const value = valueCondition(values, exclude);
        const field = filterPath(path);
        const collection = sourceCollection(tab);
        if (!field || collection === undefined) return false;
        if (tab.kind === "browse") {
            let stage = tab.stages.find(item => item.name === "filter");
            if (!stage) tab.stages.unshift((stage = { name: "filter", text: "{ }", enabled: true }));
            // Switched off, the filter in it did not apply: it starts anew.
            stage.text = addToFilter(stage.enabled ? stage.text : "", field, value);
            // A row in Json mode stays in it.
            if (stage.json) stage.text = convertQueryText(stage.text, true);
            stage.enabled = true;
            return runBrowse(tab);
        }
        const command = tab.plan?.command;
        const base = command?.find === collection && isDoc(command.filter) ? toShell(command.filter) : "";
        const browse = create("browse", { connectionId: tab.connectionId, database: tab.plan?.database ?? tab.database, collection });
        browse.stages[0]!.text = addToFilter(base, field, value);
        return runBrowse(browse);
    }

    /** How many documents the query matches in all; `undefined` when that can not be told. */
    async function count(tab: WorkTab): Promise<number | undefined> {
        const plan = tab.plan;
        const collection = sourceCollection(tab);
        if (!plan || collection === undefined || plan.command.find === undefined) return undefined;
        const filter = plan.command.filter ?? {};
        // Without a filter the collection's own count answers at once, instead of reading every document.
        if (isDoc(filter) && Object.keys(filter).length === 0 && plan.command.skip === undefined && plan.command.limit === undefined) {
            return toNumber((await backend.runCommand(tab.connectionId, plan.database, { count: collection })).n) ?? 0;
        }
        const pipeline: Json[] = [{ $match: filter }, { $group: { _id: 1, n: { $sum: 1 } } }];
        const page = await backend.runCursorCommand(tab.connectionId, plan.database, { aggregate: collection, pipeline, cursor: {} }, 1);
        return toNumber(page.documents[0]?.n) ?? 0;
    }

    /** Sends a write for the collection of the tab and shows the documents anew. */
    async function write(tab: WorkTab, command: (collection: string) => Doc): Promise<boolean> {
        const collection = sourceCollection(tab);
        const database = tab.plan?.database ?? tab.database;
        if (collection === undefined) return false;
        const done = await guarded(tab, async () => {
            guardWrite(tab, true, database, collection);
            const document = command(collection);
            if (!await writeGuard.confirmWrite(tab.connectionId, database, document, { editOnce: tab.id })) throw new ShellError("error.write.cancelled");
            const failure = replyError(await backend.runCommand(tab.connectionId, database, document));
            if (failure) throw new ReplyError(failure);
        });
        if (done) await refresh(tab);
        return done;
    }

    function insertDocuments(tab: WorkTab, documents: Doc[]): Promise<boolean> {
        return write(tab, collection => ({ insert: collection, documents }));
    }

    function replaceDocument(tab: WorkTab, id: Json, document: Doc): Promise<boolean> {
        return write(tab, collection => ({ update: collection, updates: [{ q: { _id: id }, u: document, multi: false }] }));
    }

    function removeDocuments(tab: WorkTab, ids: Json[]): Promise<boolean> {
        return write(tab, collection => ({ delete: collection, deletes: [{ q: { _id: { $in: ids } }, limit: 0 }] }));
    }

    /** Sets one field of a document; `path` is the dotted path from its root. */
    function setField(tab: WorkTab, id: Json, path: string, value: Json): Promise<boolean> {
        return write(tab, collection => ({ update: collection, updates: [{ q: { _id: id }, u: { $set: { [path]: value } }, multi: false }] }));
    }

    function removeField(tab: WorkTab, id: Json, path: string): Promise<boolean> {
        return write(tab, collection => ({ update: collection, updates: [{ q: { _id: id }, u: { $unset: { [path]: "" } }, multi: false }] }));
    }

    /** Reads one shown document again by its `_id` and puts it in its place; gone, it leaves the page. */
    async function refreshDocument(tab: WorkTab, index: number): Promise<void> {
        const result = tab.result;
        const item = result?.items[index];
        const collection = sourceCollection(tab);
        if (!result || !isDoc(item) || !("_id" in item) || collection === undefined) return;
        const database = tab.plan?.database ?? tab.database;
        const page = await backend.runCursorCommand(tab.connectionId, database, { find: collection, filter: { _id: item._id }, limit: 1 }, 1);
        const fresh = page.documents[0];
        const items = fresh ? result.items.map((old, position) => (position === index ? fresh : old)) : result.items.filter((_, position) => position !== index);
        tab.result = markRaw({ ...result, items });
    }

    /** The shown result as text, one document after the other. */
    function resultText(tab: WorkTab): string {
        return (tab.result?.items ?? []).map(item => toShell(item, "", true)).join("\n");
    }

    /** Whether the documents shown can be changed: they have an `_id` and a collection they come from. */
    function editable(tab: WorkTab): boolean {
        const collection = sourceCollection(tab);
        return !tab.readonly && collection !== undefined && !lockedByTree(tab, tab.plan?.database ?? tab.database, collection)
            && (tab.result?.items ?? []).every(item => isDoc(item) && "_id" in item);
    }

    return {
        tabs, activeId, active, historyOf, clearHistory,
        openStart, openBrowse, openShell, openAggregate, openSql, openServer, duplicate, close, closeOthers, closeAll, closeConnection, move, step,
        openSchema, analyzeSchema, browseFiltered, restoreTab, run, showResult, explainResult, stop, runBrowse, runAggregate, runSql, runTab, showPage, refresh, count, filterByValue, sourceCollection, editable, locked, lockedByTree, resultText,
        insertDocuments, replaceDocument, removeDocuments, setField, removeField, refreshDocument
    };
});
