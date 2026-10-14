import { defineStore } from "pinia";
import { computed, markRaw, reactive, ref } from "vue";
import type { Ref } from "vue";
import { backend, errorMessage } from "@/api";
import { isDoc, toNumber, toShell } from "@/shell/ejson";
import type { Doc, Json } from "@/shell/ejson";
import { ShellError } from "@/shell/message";
import type { Message } from "@/shell/message";
import { parseStatements, statementAt } from "@/shell/parse";
import { isWrite, pageCommand, planStatement, replyError } from "@/shell/plan";
import type { Plan } from "@/shell/plan";
import { aggregateStatement, keepsDocuments, newStage, previewStages } from "@/shell/pipeline";
import type { PipelineStage } from "@/shell/pipeline";
import { useConnectionsStore } from "./connections";
import { useNotesStore } from "./notes";

/** Sizes offered for a page of results. */
export const PAGE_SIZES = [10, 20, 50, 100, 200, 500];
const DEFAULT_PAGE_SIZE = 20;
/** Read at most from a cursor whose result is not paged (index lists, counts …). */
const UNPAGED_LIMIT = 10_000;
/** Commands after which the tree of databases and collections may have changed. */
const STRUCTURE_COMMANDS = ["create", "drop", "dropDatabase", "renameCollection"];

export type ResultView = "tree" | "table" | "json";
/** The start page, a collection with its query fields, a shell, a pipeline, or a page about the server. */
export type TabKind = "start" | "browse" | "shell" | "aggregate" | "server";
/** What a server tab shows. */
export type ServerPage = "status" | "log" | "users" | "roles";
export type StageName = "filter" | "projection" | "sort" | "skip" | "limit";
/** The stages a browse tab can show, in the order they apply. */
export const STAGE_NAMES: StageName[] = ["filter", "projection", "sort", "skip", "limit"];

/** One line of the query of a browse tab. */
export interface Stage {
    name: StageName;
    text: string;
    enabled: boolean;
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

export interface WorkTab {
    id: string;
    kind: TabKind;
    connectionId: string;
    database: string;
    /** Browse tabs: the collection shown. */
    collection?: string;
    /** Shell tabs: the script. */
    text: string;
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
    /** The script that is running, to stop it. */
    runId?: string;
    /** Server tabs: what they show. */
    page?: ServerPage;
    /** Aggregate tabs: the stages of the pipeline. */
    pipeline?: PipelineStage[];
    /** Aggregate tabs: shell text of the options (`allowDiskUse`, `maxTimeMS` …). */
    aggregateOptions?: string;
}

/** Tabs with a query or a script, results and a result view. */
export function isQueryTab(tab: WorkTab | undefined): tab is WorkTab {
    return tab?.kind === "browse" || tab?.kind === "shell" || tab?.kind === "aggregate";
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
            view: "tree",
            pageSize: DEFAULT_PAGE_SIZE,
            readonly: false,
            search: "",
            running: false,
            ...options
        });
        activeId.value = id;
        // The object in the list is the reactive one.
        return tabs.value.at(-1)!;
    }

    function openStart(): void {
        const existing = tabs.value.find(tab => tab.kind === "start");
        if (existing) activeId.value = existing.id;
        else create("start", {});
    }

    /** Shows a collection with its query fields and runs the query. */
    function openBrowse(target: { connectionId: string; database: string; collection: string }): WorkTab {
        const tab = create("browse", target);
        void runBrowse(tab);
        return tab;
    }

    function openShell(target: { connectionId: string; database: string; collection?: string; text?: string }): WorkTab {
        const text = target.text ?? (target.collection ? `db.getCollection(${JSON.stringify(target.collection)}).find({})` : "db.");
        return create("shell", { connectionId: target.connectionId, database: target.database, text });
    }

    /** The aggregation builder on a collection, with the stages given or one empty $match. */
    function openAggregate(target: { connectionId: string; database: string; collection: string; pipeline?: PipelineStage[]; aggregateOptions?: string }): WorkTab {
        return create("aggregate", { ...target, pipeline: target.pipeline ?? [newStage("$match", "{ }")] });
    }

    /**
     * The status or the log of a server, or the users or roles of a database; a tab that shows it
     * already comes to the front.
     */
    function openServer(connectionId: string, page: ServerPage, database = "admin"): WorkTab {
        const existing = tabs.value.find(tab => tab.kind === "server" && tab.connectionId === connectionId && tab.page === page && tab.database === database);
        if (existing) {
            activeId.value = existing.id;
            return existing;
        }
        return create("server", { connectionId, database, page });
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
    }

    async function guarded(tab: WorkTab, work: () => Promise<void>): Promise<boolean> {
        if (tab.running) return false;
        tab.running = true;
        tab.error = undefined;
        tab.errorPosition = undefined;
        try {
            await work();
            return true;
        } catch (error) {
            tab.error = error instanceof ReplyError ? error.reason : errorMessage(error);
            tab.errorPosition = error instanceof ShellError ? error.position : undefined;
            return false;
        } finally {
            tab.running = false;
        }
    }

    /** Runs the text as a script in the engine of the Rust side: variables, loops, `print`. */
    async function runScript(tab: WorkTab, source: string): Promise<void> {
        const started = performance.now();
        tab.runId = `${tab.id}-${Date.now()}`;
        tab.output = undefined;
        try {
            // A script may write anywhere on the connection: any read-only mark on it makes the run read-only.
            const marked = Object.values(notes.notes[tab.connectionId] ?? {}).some(note => note.readonly);
            const outcome = await backend.runScript(tab.connectionId, tab.runId, tab.database, source, tab.readonly || marked);
            tab.output = outcome.output;
            tab.plan = undefined;
            tab.result = markRaw({
                items: outcome.items,
                offset: 0,
                hasMore: outcome.truncated,
                statement: source,
                milliseconds: Math.round(performance.now() - started)
            });
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
            let statements;
            try {
                statements = parseStatements(source);
            } catch (error) {
                if (!(error instanceof ShellError)) throw error;
                // Not a plain statement (or not valid at all): the engine runs it, or says what is wrong.
                await runScript(tab, source);
                remember(tab, source);
                return;
            }
            // "Run" on several statements runs them all, in order, as the shell would; so does anything
            // only the engine can do. One statement keeps the way that can be paged and edited.
            if ((whole && !selected && statements.length > 1) || statements.some(item => item.method === "bulkWrite")) {
                await runScript(tab, source);
                remember(tab, source);
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

    function runTab(tab: WorkTab): Promise<boolean> {
        if (tab.kind === "aggregate") return runAggregate(tab);
        return tab.kind === "browse" ? runBrowse(tab) : run(tab, 0, undefined, true);
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
            const failure = replyError(await backend.runCommand(tab.connectionId, database, command(collection)));
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
        openStart, openBrowse, openShell, openAggregate, openServer, duplicate, close, closeOthers, closeAll, closeConnection, step,
        run, stop, runBrowse, runAggregate, runTab, showPage, refresh, count, sourceCollection, editable, locked, lockedByTree, resultText,
        insertDocuments, replaceDocument, removeDocuments, setField, removeField, refreshDocument
    };
});
