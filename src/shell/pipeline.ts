import { STAGES } from "@/shell/catalog";
import { isDoc, preview, toShell } from "@/shell/ejson";
import type { Json } from "@/shell/ejson";
import { ShellError } from "@/shell/message";
import type { Statement } from "@/shell/parse";

/** One row of the stage builder: a stage operator and the text of its value. */
export interface PipelineStage {
    id: number;
    /** With its `$`, as `$match`. */
    operator: string;
    text: string;
    enabled: boolean;
    /** The text is strict extended JSON instead of shell notation; both run alike. */
    json?: boolean;
}

/** A stage as a tab, a saved query or the session keeps it (a type, so it is Json). */
export type StoredStage = {
    operator: string;
    text: string;
    enabled: boolean;
    json?: boolean;
};

/** Stages after which the documents are still those of the collection, and can be edited. */
const SHAPE_KEEPING = ["$match", "$sort", "$skip", "$limit", "$sample"];
/** Stages that write; never run for a preview. */
export const WRITING_STAGES = ["$out", "$merge"];

let nextId = 0;

export function newStage(operator: string, text = stageTemplate(operator), enabled = true, json = false): PipelineStage {
    return { id: ++nextId, operator, text, enabled, ...(json ? { json: true } : {}) };
}

/** Stages whose empty document means nothing; they are left out ($project and $sort refuse `{}`). */
const NOTHING_WHEN_EMPTY = ["$match", "$project", "$sort"];

function isEmptyDocument(text: string): boolean {
    return text.replace(/\s/g, "") === "{}";
}

function isEmptyOptions(options: string): boolean {
    const text = options.replace(/\s/g, "");
    return text === "" || text === "{}";
}

/** The stages that take part: switched on, and no empty `$match`, `$project` or `$sort`. */
export function activeStages(stages: PipelineStage[]): PipelineStage[] {
    return stages.filter(stage => stage.enabled && !(NOTHING_WHEN_EMPTY.includes(stage.operator) && isEmptyDocument(stage.text)));
}

/** The rows a collection opens with: filter, sort and projection, empty, in the order `find` applies them. */
export function browseStages(filter = "{ }"): PipelineStage[] {
    return [newStage("$match", filter), newStage("$sort", "{ }"), newStage("$project", "{ }")];
}

/** The order in which `find` applies its parts. */
const FIND_ORDER = ["$match", "$sort", "$skip", "$limit", "$project"];

/**
 * The `find` statement the stages stand for: when they are only `$match`, `$sort`, `$skip`,
 * `$limit` and `$project`, each once and in the order `find` applies them, without options. Else
 * `undefined`, and the stages run as a pipeline.
 */
export function findStatement(collection: string, stages: PipelineStage[], options = ""): string | undefined {
    if (!isEmptyOptions(options)) return undefined;
    const parts: Record<string, string> = {};
    let last = -1;
    for (const stage of activeStages(stages)) {
        const at = FIND_ORDER.indexOf(stage.operator);
        // An empty stage is reported by the pipeline.
        if (at <= last || stage.text.trim() === "") return undefined;
        last = at;
        parts[stage.operator] = stage.text.trim();
    }
    let statement = `db.getCollection(${JSON.stringify(collection)}).find(${parts.$match ?? "{}"}${parts.$project ? `, ${parts.$project}` : ""})`;
    for (const [operator, method] of [["$sort", "sort"], ["$skip", "skip"], ["$limit", "limit"]] as const) {
        if (parts[operator]) statement += `.${method}(${parts[operator]})`;
    }
    return statement;
}

/** The stages for keeping: without their ids. */
export function storedStages(stages: PipelineStage[]): StoredStage[] {
    return stages.map(stage => ({ operator: stage.operator, text: stage.text, enabled: stage.enabled, ...(stage.json ? { json: true } : {}) }));
}

/** The names of the rows a collection had before it had stages. */
const OLD_ROWS: Record<string, string> = { filter: "$match", projection: "$project", sort: "$sort", skip: "$skip", limit: "$limit" };

/**
 * The stages kept in a tab, a saved query or the session: `pipeline`, or `stages` of the rows a
 * collection had before (filter, projection, sort …), which become stages in the order `find`
 * applies them. `undefined` when there are none.
 */
export function readStages(content: { [key: string]: Json }): PipelineStage[] | undefined {
    const items = Array.isArray(content.pipeline) ? content.pipeline : Array.isArray(content.stages) ? content.stages : undefined;
    if (!items) return undefined;
    const stages: PipelineStage[] = [];
    for (const item of items) {
        if (!isDoc(item) || typeof item.text !== "string") continue;
        const operator = typeof item.operator === "string" ? item.operator : typeof item.name === "string" ? OLD_ROWS[item.name] : undefined;
        if (!operator) continue;
        stages.push(newStage(operator, item.text, item.enabled !== false, item.json === true));
    }
    if (!Array.isArray(content.pipeline)) stages.sort((a, b) => FIND_ORDER.indexOf(a.operator) - FIND_ORDER.indexOf(b.operator));
    return stages;
}

/**
 * The value a new stage starts with: its snippet from the catalog without the operator, the places
 * to fill in replaced by their default (`$limit: ${10}` gives `10`).
 */
export function stageTemplate(operator: string): string {
    const snippet = STAGES.find(entry => entry.name === operator)?.snippet;
    if (!snippet) return "{ }";
    return snippet
        .slice(snippet.indexOf(":") + 1)
        .trim()
        .replace(/\$\{([^}]*)\}/g, "$1")
        .replaceAll("\t", "    ");
}

/** The stages that are switched on, as the text of the pipeline array. */
export function pipelineText(stages: PipelineStage[]): string {
    const parts = activeStages(stages).map((stage) => {
        if (stage.text.trim() === "") throw new ShellError("error.pipeline.emptyStage", { operator: stage.operator });
        return `{ ${stage.operator}: ${stage.text.trim()} }`;
    });
    return parts.length === 0 ? "[]" : `[\n    ${parts.join(",\n    ")}\n]`;
}

/** The shell statement the builder stands for; `options` is the shell text of the second argument. */
export function aggregateStatement(collection: string, stages: PipelineStage[], options = ""): string {
    const extra = isEmptyOptions(options) ? "" : `, ${options.trim()}`;
    return `db.getCollection(${JSON.stringify(collection)}).aggregate(${pipelineText(stages)}${extra})`;
}

/**
 * The stages up to and including the one at `index`, to look at the documents there. Stages that
 * write are left out: looking must not change data.
 */
export function previewStages(stages: PipelineStage[], index: number): PipelineStage[] {
    return stages.slice(0, index + 1).filter(stage => !WRITING_STAGES.includes(stage.operator));
}

/** The rows of an `aggregate` statement, for one pasted or chosen from the history. */
export function stagesOf(statement: Statement): PipelineStage[] {
    if (statement.method !== "aggregate" || !Array.isArray(statement.args[0])) throw new ShellError("error.pipeline.notAggregate");
    return statement.args[0].map((item) => {
        const entries = isDoc(item) ? Object.entries(item) : [];
        if (entries.length !== 1) throw new ShellError("error.pipeline.stageShape");
        const [operator, value] = entries[0]!;
        return newStage(operator, toShell(value));
    });
}

/** A value on one line, as a row holds a filter. */
function line(value: Json | undefined, fallback: string): string {
    return value === undefined ? fallback : preview(value, Number.MAX_SAFE_INTEGER);
}

/**
 * The rows of a `find` or `aggregate` statement, for one pasted or chosen from the history: a
 * `find` becomes `$match`, `$sort`, `$skip`, `$limit` and `$project`.
 */
export function stagesOfQuery(statement: Statement): PipelineStage[] {
    if (statement.method === "aggregate") return stagesOf(statement);
    if (statement.method !== "find") throw new ShellError("error.pipeline.notQuery");
    const modifier = (name: string) => statement.modifiers.find(item => item.name === name)?.args[0];
    const stages = [newStage("$match", line(statement.args[0], "{ }")), newStage("$sort", line(modifier("sort"), "{ }"))];
    for (const name of ["skip", "limit"] as const) {
        const value = modifier(name);
        if (value !== undefined) stages.push(newStage(`$${name}`, line(value, "")));
    }
    stages.push(newStage("$project", line(statement.args[1], "{ }")));
    return stages;
}

/** The options of an `aggregate` statement as shell text; empty when it has none. */
export function optionsOf(statement: Statement): string {
    const options = statement.args[1];
    return isDoc(options) && Object.keys(options).length > 0 ? toShell(options) : "";
}

/** Whether the result still consists of documents of the collection, unchanged. */
export function keepsDocuments(stages: PipelineStage[]): boolean {
    return activeStages(stages).every(stage => SHAPE_KEEPING.includes(stage.operator));
}

/** The list with the item at `from` taken out and put in at `to` (an index in the list without it). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
    const next = [...items];
    if (from < 0 || from >= next.length) return next;
    const [item] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, item!);
    return next;
}
