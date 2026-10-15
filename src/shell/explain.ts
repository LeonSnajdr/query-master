/**
 * Reads what the server answers to `explain("executionStats")` (stage 19): the stages as a flow
 * from the source (collection or index) to the result, with documents and own time per stage, and
 * hints with an action. Without Vue; the plan view draws what this returns.
 */
import { isDoc, scalar, toNumber } from "./ejson";
import type { Doc, Json } from "./ejson";

export interface PlanNode {
    /** Unique in the plan: the path of the stage, `s0`, `s1` … */
    id: string;
    /** `COLLSCAN`, `IXSCAN`, `$lookup` … */
    stage: string;
    /** A line under the name: the index, the field, the collection. */
    detail?: string;
    returned?: number;
    docsExamined?: number;
    keysExamined?: number;
    /** Own time: the estimate of the stage minus that of the stages it reads from. */
    ms?: number;
    /** Where documents come from that do not flow through the main line ($lookup, other branches). */
    side?: PlanNode[];
    /** The stage as the server describes it, for its details. */
    raw: Doc;
}

export interface PlanHint {
    /** i18n key of the sentence, with its values. */
    key: string;
    params: Record<string, string | number>;
    /** The stage the hint is about, marked with its number there. */
    node?: string;
    /** "Create index …": the keys to start the index dialog with, and where. */
    index?: { collection: string; keys: Doc };
}

export interface ExplainResult {
    /** The source as the flow starts: the collection, or the index the scan reads. */
    source: { kind: "collection" | "index"; name: string; detail?: string };
    /** The stages from the first one reading to the last one returning. */
    stages: PlanNode[];
    examined: number;
    returned: number;
    ms: number;
    hints: PlanHint[];
}

/** A response that is a plan: what `.explain()` returns, for find and for aggregate. */
export function isExplain(value: Json | undefined): value is Doc {
    if (!isDoc(value) || scalar(value)) return false;
    if (isDoc(value.queryPlanner) || isDoc(value.executionStats)) return true;
    return Array.isArray(value.stages) && value.stages.some(stage => isDoc(stage) && "$cursor" in stage);
}

const number = (value: Json | undefined) => (value === undefined ? undefined : toNumber(value));

/** The stage chain of an execution tree, the stage that reads first at the front. */
function chainOf(stage: Doc, ids: { next: number }): PlanNode[] {
    const inputs = Array.isArray(stage.inputStages) ? stage.inputStages.filter(isDoc) : [];
    const shards = Array.isArray(stage.shards) ? stage.shards.filter(isDoc).map(shard => (isDoc(shard.executionStages) ? shard.executionStages : shard)) : [];
    const below = isDoc(stage.inputStage) ? [stage.inputStage] : [...inputs, ...shards];
    const [main, ...others] = below;
    const chain = main ? chainOf(main, ids) : [];
    const side = others.flatMap(other => chainOf(other, ids));
    const own = number(stage.executionTimeMillisEstimate);
    const inner = below.reduce((total, child) => total + (number(child.executionTimeMillisEstimate) ?? 0), 0);
    const name = typeof stage.stage === "string" ? stage.stage : "?";
    const raw = Object.fromEntries(Object.entries(stage).filter(([key]) => key !== "inputStage" && key !== "inputStages" && key !== "shards"));
    chain.push({
        id: `s${ids.next++}`,
        stage: name,
        detail: typeof stage.indexName === "string" ? stage.indexName : undefined,
        returned: number(stage.nReturned),
        docsExamined: number(stage.docsExamined),
        keysExamined: number(stage.keysExamined),
        ms: own === undefined ? undefined : Math.max(0, own - inner),
        side: side.length > 0 ? side : undefined,
        raw
    });
    return chain;
}

/** A pipeline stage after the `$cursor`: its name, numbers and (for `$lookup`) the collection it reads. */
function pipelineNode(stage: Doc, ids: { next: number }, before: number | undefined): PlanNode {
    const name = Object.keys(stage).find(key => key.startsWith("$")) ?? "?";
    const body = stage[name];
    const total = number(stage.executionTimeMillisEstimate);
    const node: PlanNode = {
        id: `s${ids.next++}`,
        stage: name,
        returned: number(stage.nReturned),
        ms: total === undefined ? undefined : Math.max(0, total - (before ?? 0)),
        raw: stage
    };
    if (name === "$lookup" && isDoc(body) && typeof body.from === "string") {
        node.detail = body.from;
        node.docsExamined = number(stage.totalDocsExamined);
        node.side = [{ id: `s${ids.next++}`, stage: body.from, detail: String(body.foreignField ?? ""), docsExamined: number(stage.totalDocsExamined), raw: { collectionScans: stage.collectionScans ?? null, indexesUsed: stage.indexesUsed ?? null } }];
    }
    return node;
}

/**
 * The plan of a response, or `undefined` when it is none. `collection` names the source when the
 * plan does not (a pipeline).
 */
export function readExplain(reply: Json, collection: string): ExplainResult | undefined {
    if (!isExplain(reply)) return undefined;
    const ids = { next: 0 };
    const stages: PlanNode[] = [];
    let statsOf: Doc | undefined;
    let planner: Doc | undefined;
    if (Array.isArray(reply.stages)) {
        // aggregate: `$cursor` holds the plan of the query part, the stages after it their own numbers.
        const [cursorStage, ...rest] = reply.stages.filter(isDoc);
        const cursor = isDoc(cursorStage?.$cursor) ? cursorStage.$cursor : {};
        statsOf = isDoc(cursor.executionStats) ? cursor.executionStats : undefined;
        planner = isDoc(cursor.queryPlanner) ? cursor.queryPlanner : undefined;
        if (isDoc(statsOf?.executionStages)) stages.push(...chainOf(statsOf.executionStages, ids));
        // Times of later stages add up along the pipeline (MongoDB 4.4 and later).
        let before = number(cursorStage?.executionTimeMillisEstimate) ?? number(statsOf?.executionTimeMillis);
        for (const stage of rest) {
            const node = pipelineNode(stage, ids, before);
            stages.push(node);
            before = number(stage.executionTimeMillisEstimate) ?? before;
        }
    } else {
        statsOf = isDoc(reply.executionStats) ? reply.executionStats : undefined;
        planner = isDoc(reply.queryPlanner) ? reply.queryPlanner : undefined;
        // The slot based engine (aggregate with $group from MongoDB 7.0) has its plan in the classic form apart.
        const winning = isDoc(planner?.winningPlan) ? planner.winningPlan : undefined;
        const classic = isDoc(winning?.queryPlan) ? winning.queryPlan : undefined;
        if (classic) stages.push(...chainOf(classic, ids));
        else if (isDoc(statsOf?.executionStages)) stages.push(...chainOf(statsOf.executionStages, ids));
        else if (winning) stages.push(...chainOf(winning, ids));
    }
    const scan = stages.find(node => node.stage === "IXSCAN" || node.stage === "COLLSCAN" || node.stage === "EXPRESS_IXSCAN");
    const name = typeof planner?.namespace === "string" ? planner.namespace.split(".").slice(1).join(".") : collection;
    const source: ExplainResult["source"] = scan?.stage === "IXSCAN" || scan?.stage === "EXPRESS_IXSCAN"
        ? { kind: "index", name: scan.detail ?? "", detail: name || collection }
        : { kind: "collection", name: name || collection };
    const last = stages.at(-1);
    const result: ExplainResult = {
        source,
        stages,
        examined: number(statsOf?.totalDocsExamined) ?? 0,
        returned: last?.returned ?? number(statsOf?.nReturned) ?? 0,
        ms: number(statsOf?.executionTimeMillis) ?? stages.reduce((total, node) => total + (node.ms ?? 0), 0),
        hints: []
    };
    // A pipeline after the cursor takes longer than the query part alone.
    const lastMs = Array.isArray(reply.stages) ? number((reply.stages.filter(isDoc).at(-1) ?? {}).executionTimeMillisEstimate) : undefined;
    if (lastMs !== undefined) result.ms = Math.max(result.ms, lastMs);
    return result;
}

/** Thresholds of the hints: a scan is worth an index from this many documents read … */
export const SCAN_FROM = 1000;
/** … and when it reads this many times more than it returns. */
export const SCAN_FACTOR = 10;

function emptyFilter(value: Json | undefined): boolean {
    return !isDoc(value) || Object.keys(value).length === 0;
}

const RANGE_OPERATORS = ["$gt", "$gte", "$lt", "$lte", "$ne", "$nin", "$exists", "$regex", "$type"];

/**
 * The keys of an index for a filter and a sort: equality first, then the sort, then ranges (the
 * rule ESR). Operators of logic (`$and` …) are looked into; others are left out.
 */
export function indexFor(filter: Json | undefined, sort: Json | undefined): Doc {
    const equal: string[] = [];
    const range: string[] = [];
    const walk = (node: Json | undefined) => {
        if (!isDoc(node)) return;
        for (const [field, condition] of Object.entries(node)) {
            if (field === "$and" && Array.isArray(condition)) condition.forEach(walk);
            if (field.startsWith("$")) continue;
            const operators = isDoc(condition) && !scalar(condition) ? Object.keys(condition) : [];
            if (operators.some(operator => RANGE_OPERATORS.includes(operator))) range.push(field);
            else equal.push(field);
        }
    };
    walk(filter);
    const keys: Doc = {};
    for (const field of equal) keys[field] = 1;
    if (isDoc(sort)) for (const [field, direction] of Object.entries(sort)) if (!(field in keys)) keys[field] = toNumber(direction) === -1 ? -1 : 1;
    for (const field of range) if (!(field in keys)) keys[field] = 1;
    return keys;
}

/** The filter and sort of a command, to suggest an index from: a find, or the first `$match`/`$sort` of a pipeline. */
export function querySide(command: Doc): { collection?: string; filter?: Json; sort?: Json } {
    const inner = isDoc(command.explain) ? command.explain : command;
    if (typeof inner.find === "string") return { collection: inner.find, filter: inner.filter, sort: inner.sort };
    if (typeof inner.aggregate === "string" && Array.isArray(inner.pipeline)) {
        const stages = inner.pipeline.filter(isDoc);
        return { collection: inner.aggregate, filter: stages.find(stage => "$match" in stage)?.$match, sort: stages.find(stage => "$sort" in stage)?.$sort };
    }
    return {};
}

/** Sizes as people read them: 4.1 MB. */
function size(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
}

/** The hints of a plan, each with the stage it is about and, where it helps, an index to create. */
export function hintsOf(plan: ExplainResult, command: Doc): PlanHint[] {
    const hints: PlanHint[] = [];
    const query = querySide(command);
    const suggestion = indexFor(query.filter, query.sort);
    const offerIndex = query.collection !== undefined && Object.keys(suggestion).length > 0 ? { collection: query.collection, keys: suggestion } : undefined;
    const all = plan.stages.flatMap(node => [node, ...(node.side ?? [])]);
    for (const node of all) {
        const examined = node.docsExamined ?? 0;
        if (node.stage === "COLLSCAN" && !emptyFilter(node.raw.filter) && examined > SCAN_FROM && examined > SCAN_FACTOR * Math.max(1, plan.returned)) {
            hints.push({ key: "explain.hint.noIndex", params: { examined, returned: plan.returned }, node: node.id, index: offerIndex });
        }
        if (node.stage === "SORT" && (node.raw.memLimit !== undefined || node.raw.totalDataSizeSorted !== undefined)) {
            hints.push({ key: "explain.hint.memorySort", params: { size: size(toNumber(node.raw.totalDataSizeSorted) ?? 0) }, node: node.id });
        }
        if (node.raw.usedDisk === true) hints.push({ key: "explain.hint.disk", params: { stage: node.stage }, node: node.id });
        if (node.stage === "FETCH" && (node.returned ?? 0) * SCAN_FACTOR < examined && examined > SCAN_FROM) {
            hints.push({ key: "explain.hint.partialIndex", params: { examined, returned: node.returned ?? 0 }, node: node.id, index: offerIndex });
        }
        if (node.stage === "$lookup") {
            const scans = toNumber(node.raw.collectionScans) ?? 0;
            const body = node.raw.$lookup;
            if (scans > 0 && isDoc(body) && typeof body.from === "string") {
                const field = typeof body.foreignField === "string" ? body.foreignField : undefined;
                hints.push({
                    key: "explain.hint.lookup",
                    params: { collection: body.from, field: field ?? "", scans },
                    node: node.id,
                    index: field ? { collection: body.from, keys: { [field]: 1 } } : undefined
                });
            }
        }
    }
    return hints;
}

/** Positions of the stages in rows of the width there is: source, stages, result, wrapping. */
export interface PlacedNode {
    id: string;
    x: number;
    y: number;
    row: number;
}

export const NODE_WIDTH = 150;
export const NODE_HEIGHT = 84;
export const NODE_GAP = 52;
/** Room below a row for its side sources and the arrows to them. */
export const ROW_HEIGHT = 200;

/** Lays out a flow of `ids` from left to right; when it would be wider than `width`, it goes on in a new row. */
export function layoutPlan(ids: string[], width: number): PlacedNode[] {
    const perRow = Math.max(2, Math.floor((width + NODE_GAP) / (NODE_WIDTH + NODE_GAP)));
    return ids.map((id, index) => {
        const row = Math.floor(index / perRow);
        const column = index % perRow;
        return { id, row, x: column * (NODE_WIDTH + NODE_GAP), y: row * ROW_HEIGHT };
    });
}

/** Stroke width of an arrow for `n` documents, where `max` is the most any arrow carries. */
export function strokeFor(n: number, max: number): number {
    return Math.max(2, 20 * Math.sqrt(Math.max(0, n) / Math.max(1, max)));
}
