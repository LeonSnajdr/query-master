import {
    ACCUMULATORS, AGGREGATE_MODIFIERS, AGGREGATE_OPTIONS, BSON_HELPERS, BSON_TYPES, COLLECTION_METHODS, COMMANDS, CONSOLE_METHODS,
    CREATE_COLLECTION_OPTIONS, CURSOR_METHODS, DATABASE_METHODS, DELETE_OPTIONS, EXPRESSIONS, FIND_AND_MODIFY_OPTIONS, FIND_MODIFIERS,
    FIND_OPTIONS, INDEX_OPTIONS, PROJECTION_OPERATORS, QUERY_FIELD, QUERY_LOGICAL, SCRIPT_GLOBALS, STAGES, SYSTEM_VARIABLES,
    UPDATE_MODIFIERS, UPDATE_OPERATORS, UPDATE_OPTIONS, UPDATE_PIPELINE_STAGES, WINDOW_OPERATORS, available, docKey
} from "./catalog";
import type { Entry } from "./catalog";
import { scalar } from "./ejson";
import type { Message } from "./message";
import { chainTarget, cursorContext } from "./context";
import type { CursorContext, Target } from "./context";
import { filterField } from "./values";
import type { ValueHint, ValueSearcher, ValueSource } from "./values";

export type SuggestionType = "method" | "collection" | "database" | "field" | "operator" | "stage" | "option" | "value" | "variable";

export interface Suggestion {
    label: string;
    type: SuggestionType;
    /** Short note behind the label: `7.0+`, "deprecated". */
    detail?: string | Message;
    /** Sentences that describe it. */
    info?: Message[];
    /** Text to insert instead of the label. */
    apply?: string;
    /** Text to insert with places to fill in (`${…}`). */
    snippet?: string;
    /** Moves the suggestion up (positive) or down in the list. */
    boost: number;
}

export interface Suggestions {
    /** Where the text to replace starts. */
    from: number;
    options: Suggestion[];
    /** Worth showing without being asked for (Ctrl+Space). */
    auto: boolean;
}

/** What the editor knows about the connection it completes for. */
export interface Environment {
    serverVersion?: string;
    databases: string[];
    collections: string[];
    /** Field paths seen in a collection (`address.city`); empty until they are loaded. */
    fields: (collection: string) => string[];
    /** Values seen in a field of a collection, the most frequent first; see `values.ts`. */
    values?: ValueSource;
    /** Searches all data for the values of a field, when asked (the last entry of the list). */
    search?: ValueSearcher;
}

/** A value of a field where the cursor is: in which collection, and the text typed in its string. */
export interface ValuePlace {
    collection: string;
    field: string;
    /** What is typed in the string so far; empty outside a string. */
    prefix: string;
    inString: boolean;
}

const PLAIN_NAME = /^[A-Za-z_$][\w$]*$/;
const COLLATION_OPTIONS = ["locale", "strength", "caseLevel", "caseFirst", "numericOrdering", "alternate", "maxVariable", "backwards"];
const COLLECTION_KEYS = ["from", "coll", "into", "viewOn", "$out"];
const FIELD_KEYS = ["localField", "foreignField", "connectFromField", "connectToField", "distanceField", "field", "includeArrayIndex", "$unset", "on", "as"];
/** Methods that can follow `explain()`. */
const EXPLAINABLE = ["find", "aggregate", "count", "distinct", "updateOne", "updateMany", "deleteOne", "deleteMany", "findOneAndUpdate", "findOneAndDelete", "findOneAndReplace"];

/** What can stand at a key: catalog entries, plain names, and whether fields of the collection fit. */
interface KeyChoices {
    fields?: boolean;
    operators?: Entry[];
    stages?: Entry[];
    options?: string[];
}

function filterKeys(path: string[]): KeyChoices {
    if (path.includes("$expr")) return { operators: EXPRESSIONS };
    const keys = path.filter(part => part !== "[]");
    const last = keys.at(-1);
    if (last === undefined || last === "$and" || last === "$or" || last === "$nor") return { fields: true, operators: QUERY_LOGICAL };
    if (last === "$elemMatch") return { fields: true, operators: QUERY_FIELD };
    if (last === "$not") return { operators: QUERY_FIELD };
    if (last.startsWith("$")) return {};
    return { operators: QUERY_FIELD };
}

/** Where a pipeline starts inside a stage: `$lookup.pipeline`, `$facet.<name>`, `$rankFusion.input.pipelines.<name>`. */
function nestedPipeline(path: string[]): number {
    for (let index = path.length - 1; index > 1; index--) {
        if (path[index] !== "[]") continue;
        if (path[index - 1] === "pipeline" || path[index - 2] === "$facet" || path[index - 2] === "pipelines") return index;
    }
    return -1;
}

function pipelineKeys(path: string[], stages: Entry[] = STAGES): KeyChoices {
    if (path[0] !== "[]") return {};
    if (path.length === 1) return { stages };
    const nested = nestedPipeline(path);
    if (nested > 0) return pipelineKeys(path.slice(nested));

    const stage = path[1]!;
    const rest = path.slice(2);
    const entry = STAGES.find(item => item.name === stage);
    switch (stage) {
        case "$match":
            return filterKeys(rest);
        case "$group":
            if (rest.length === 0) return { options: ["_id"] };
            return { operators: rest.length === 1 && rest[0] !== "_id" ? ACCUMULATORS : EXPRESSIONS };
        case "$setWindowFields":
            if (rest.length === 0) return { options: entry?.keys };
            if (rest[0] === "output" && rest.length === 2) return { operators: [...ACCUMULATORS, ...WINDOW_OPERATORS], options: ["window"] };
            if (rest[0] === "output" && rest[2] === "window") return { options: ["documents", "range", "unit"] };
            return rest[0] === "sortBy" ? { fields: true } : { operators: EXPRESSIONS };
        case "$sort":
            return { fields: true };
        case "$project":
        case "$addFields":
        case "$set":
            return rest.length === 0 ? { fields: true } : { operators: EXPRESSIONS };
        case "$geoNear":
            if (rest[0] === "query") return filterKeys(rest.slice(1));
            break;
        case "$vectorSearch":
            if (rest[0] === "filter") return filterKeys(rest.slice(1));
            break;
        case "$fill":
            if (rest[0] === "output" && rest.length === 2) return { options: ["value", "method"] };
            if (rest[0] === "sortBy" || rest[0] === "output") return { fields: true };
            break;
        case "$densify":
            if (rest[0] === "range") return { options: ["step", "unit", "bounds"] };
            break;
        case "$facet":
            return {};
    }
    if (rest.length === 0 && entry?.keys) return { options: entry.keys };
    return { operators: EXPRESSIONS };
}

function updateKeys(path: string[]): KeyChoices {
    if (path.length === 0) return { operators: UPDATE_OPERATORS };
    if (path[0] === "[]") return pipelineKeys(path, STAGES.filter(stage => UPDATE_PIPELINE_STAGES.includes(stage.name)));
    if (path.length === 1) return { fields: true };
    if ((path[0] === "$push" || path[0] === "$addToSet") && path.length === 2) return { operators: UPDATE_MODIFIERS };
    if (path[0] === "$pull") return filterKeys(path.slice(1));
    return {};
}

function keyChoices(target: Target, argument: number, path: string[]): KeyChoices {
    const modifier = target.modifiers.at(-1);
    if (modifier !== undefined) {
        if (["sort", "hint", "project", "projection", "min", "max"].includes(modifier)) return { fields: true };
        return modifier === "collation" ? { options: COLLATION_OPTIONS } : {};
    }
    const options = (names: string[]): KeyChoices => {
        if (path[0] === "collation") return { options: COLLATION_OPTIONS };
        if (path[0] === "sort" || path[0] === "projection" || path[0] === "hint") return { fields: true };
        if (path[0] === "partialFilterExpression" || path[0] === "validator") return filterKeys(path.slice(1));
        return path.length === 0 ? { options: names } : {};
    };
    switch (target.method) {
        case "find":
        case "findOne":
            if (argument === 0) return filterKeys(path);
            if (argument === 1) return path.length === 0 ? { fields: true } : { operators: PROJECTION_OPERATORS };
            return options(FIND_OPTIONS);
        case "countDocuments":
        case "count":
            return argument === 0 ? filterKeys(path) : options(["limit", "skip", "hint", "maxTimeMS", "collation", "comment"]);
        case "deleteOne":
        case "deleteMany":
        case "remove":
            return argument === 0 ? filterKeys(path) : options(DELETE_OPTIONS);
        case "findOneAndDelete":
            return argument === 0 ? filterKeys(path) : options(FIND_AND_MODIFY_OPTIONS);
        case "distinct":
            return argument === 1 ? filterKeys(path) : {};
        case "updateOne":
        case "updateMany":
        case "update":
            if (argument === 0) return filterKeys(path);
            return argument === 1 ? updateKeys(path) : options(UPDATE_OPTIONS);
        case "findOneAndUpdate":
            if (argument === 0) return filterKeys(path);
            return argument === 1 ? updateKeys(path) : options(FIND_AND_MODIFY_OPTIONS);
        case "replaceOne":
        case "findOneAndReplace":
            if (argument === 0) return filterKeys(path);
            return argument === 1 ? { fields: true } : options(target.method === "replaceOne" ? UPDATE_OPTIONS : FIND_AND_MODIFY_OPTIONS);
        case "insertOne":
        case "insertMany":
        case "insert":
            return argument === 0 ? { fields: true } : options(["ordered", "writeConcern", "bypassDocumentValidation", "comment"]);
        case "aggregate":
            return argument === 0 ? pipelineKeys(path) : options(AGGREGATE_OPTIONS);
        case "createIndex":
        case "ensureIndex":
        case "createIndexes":
            return argument === 0 ? { fields: true } : options(INDEX_OPTIONS);
        case "runCommand":
        case "adminCommand":
            return path.length === 0 ? { options: COMMANDS } : {};
        case "createCollection":
            return argument === 1 ? options(CREATE_COLLECTION_OPTIONS) : {};
        case "createView":
            return argument === 2 ? pipelineKeys(path) : {};
        default:
            return {};
    }
}

/** The next part of the field paths below `path`: behind `o.` `customer` for `customer.name`, behind `o.customer.` `name`. */
function fieldParts(fields: string[], path: string[]): string[] {
    const prefix = path.length === 0 ? "" : `${path.join(".")}.`;
    const parts = fields.filter(field => field.startsWith(prefix)).map(field => field.slice(prefix.length).split(".")[0]!);
    return [...new Set(parts)].filter(part => PLAIN_NAME.test(part));
}

/** Where a statement starts: `db`, `print`, a keyword can stand here. */
function atStatement(context: CursorContext): boolean {
    return context.kind === "value" && context.chain.length === 0 && context.path.length === 0;
}

/**
 * What JavaScript itself can complete at the end of the text: variables at a value, keywords
 * where a statement starts; nothing at a key, behind a dot or in a string.
 */
export function scriptPlace(text: string): "statement" | "value" | undefined {
    const context = cursorContext(text);
    if (context.kind !== "value") return undefined;
    return atStatement(context) ? "statement" : "value";
}

/** Methods whose first argument is a filter. */
const FILTER_METHODS = [
    "find", "findOne", "countDocuments", "count", "deleteOne", "deleteMany", "remove", "findOneAndDelete",
    "findOneAndUpdate", "findOneAndReplace", "updateOne", "updateMany", "update", "replaceOne"
];
const UPDATE_METHODS = ["updateOne", "updateMany", "update", "findOneAndUpdate"];

/**
 * The field whose values fit where the cursor is: a value in a filter, in a `$match` stage or in
 * the `$set` of an update. `path` leads from the argument to the value, its key included.
 */
function valueField(target: Target | undefined, argument: number, path: string[]): string | undefined {
    if (!target?.method || target.modifiers.length > 0) return undefined;
    if (FILTER_METHODS.includes(target.method) && argument === 0) return filterField(path);
    if (UPDATE_METHODS.includes(target.method) && argument === 1 && path[0] === "$set") return filterField(path.slice(1));
    if (target.method === "distinct" && argument === 1) return filterField(path);
    if (target.method === "aggregate" && argument === 0 && path[0] === "[]" && path[1] === "$match") return filterField(path.slice(2));
    return undefined;
}

function placeIn(context: CursorContext): ValuePlace | undefined {
    if (context.kind !== "value" && context.kind !== "string") return undefined;
    const target = chainTarget([...context.chain, { call: true }], context.variables);
    const field = valueField(target, context.argument, context.key === undefined ? context.path : [...context.path, context.key]);
    if (field === undefined || !target?.collection) return undefined;
    const inString = context.kind === "string";
    return { collection: target.collection, field, prefix: inString ? context.word : "", inString };
}

/** The value of a field at the end of the text, for the search of all data; `undefined` elsewhere. */
export function valuePlace(text: string): ValuePlace | undefined {
    return placeIn(cursorContext(text));
}

/** How often a value was seen; allowed by the validator: no count when none was seen, a mark either way. */
export function valueDetail(hint: ValueHint): string {
    return hint.allowed ? (hint.count > 0 ? `✓ ${hint.count}×` : "✓") : `${hint.count}×`;
}

/** A value as a suggestion: strings without quotes in the list, with them when inserted outside a string. */
function valueSuggestion(hint: ValueHint, rank: number, inString: boolean): Suggestion {
    const text = typeof hint.value === "string" ? hint.value : scalar(hint.value)?.text ?? "";
    const quoted = typeof hint.value === "string" ? JSON.stringify(hint.value) : text;
    // The most frequent first, as long as the typed text fits them equally well.
    return { label: text, type: "value", detail: valueDetail(hint), apply: inString ? quoted.slice(1, -1) : quoted, boost: Math.max(0, 30 - rank) };
}

/** Numbers the places of a snippet in the order they are written, so Tab walks them that way. */
function orderedSnippet(snippet: string): string {
    let count = 0;
    return snippet.replace(/\$\{([^}]*)\}/g, (_, name: string) => `\${${++count}:${name}}`);
}

export function suggest(text: string, environment: Environment): Suggestions | undefined {
    const context = cursorContext(text);
    const options: Suggestion[] = [];
    const version = environment.serverVersion;

    const fromEntry = (entry: Entry, type: SuggestionType, boost = 0): Suggestion => {
        const usable = available(entry, version);
        const info: Message[] = [{ key: docKey(entry) }];
        if (entry.replacedBy) info.push({ key: "complete.replacedBy", params: { names: entry.replacedBy.join(", ") } });
        else if (!usable) info.push({ key: "complete.serverVersion", params: { version: version ?? "" } });
        let detail: Suggestion["detail"];
        if (entry.replacedBy) detail = { key: "complete.deprecated" };
        else if (entry.since) detail = usable ? `${entry.since}+` : { key: "complete.needs", params: { version: entry.since } };
        return { label: entry.name, type, detail, info, boost: entry.replacedBy ? boost - 60 : usable ? boost : boost - 50 };
    };
    const snippetOf = (entry: Entry, type: SuggestionType, boost = 0): Suggestion => ({
        ...fromEntry(entry, type, boost),
        snippet: entry.snippet ? orderedSnippet(entry.snippet) : undefined
    });
    const keySuffix = context.quoted ? "" : ": ";
    /** Values of the field the cursor is at, as far as the sources know them. */
    const valuesHere = (): Suggestion[] => {
        const place = placeIn(context);
        if (!place || !environment.values) return [];
        return (environment.values(place.collection, place.field) ?? [])
            .filter(hint => !place.inString || typeof hint.value === "string")
            .map((hint, rank) => valueSuggestion(hint, rank, place.inString));
    };
    const fieldsOf = (collection: string | undefined) => (collection ? environment.fields(collection) : []);

    if (context.kind === "member") {
        const [root] = context.chain;
        if (context.chain.length === 1 && root && "name" in root && root.name === "console") {
            return { from: context.from, options: CONSOLE_METHODS.map(entry => snippetOf(entry, "method")), auto: true };
        }
        const target = chainTarget(context.chain, context.variables);
        if (!target) return undefined;
        if (target.document) {
            options.push(...fieldParts(fieldsOf(target.collection), target.document).map((label): Suggestion => ({ label, type: "field", boost: 10 })));
            if (options.length === 0) return undefined;
            return { from: context.from, options, auto: true };
        }
        if (target.open && target.method !== undefined) return undefined;
        if (target.method === "explain") {
            options.push(...COLLECTION_METHODS.filter(entry => EXPLAINABLE.includes(entry.name)).map(entry => snippetOf(entry, "method")));
        } else if (target.method === "find") {
            options.push(...[...FIND_MODIFIERS, ...CURSOR_METHODS].map(entry => snippetOf(entry, "method")));
        } else if (target.method === "aggregate") {
            options.push(...[...AGGREGATE_MODIFIERS, ...CURSOR_METHODS].map(entry => snippetOf(entry, "method")));
        } else if (target.method === undefined && target.collection !== undefined) {
            options.push(...COLLECTION_METHODS.map(entry => snippetOf(entry, "method")));
        } else if (target.method === undefined) {
            options.push(...environment.collections.map((name): Suggestion => ({
                label: name,
                type: "collection",
                apply: PLAIN_NAME.test(name) ? undefined : `getCollection(${JSON.stringify(name)})`,
                boost: 10
            })));
            options.push(...DATABASE_METHODS.map(entry => snippetOf(entry, "method")));
        }
        return { from: context.from, options, auto: true };
    }

    const callee = context.chain.at(-1);
    const calleeName = callee && "name" in callee ? callee.name : undefined;
    const target = chainTarget([...context.chain, { call: true }], context.variables);

    if (context.kind === "string") {
        const names = (list: string[], type: SuggestionType) => options.push(...list.map((label): Suggestion => ({ label, type, boost: 0 })));
        if (calleeName === "getCollection" && context.path.length === 0) names(environment.collections, "collection");
        else if (calleeName === "getSiblingDB" && context.path.length === 0) names(environment.databases, "database");
        else if (context.key !== undefined && COLLECTION_KEYS.includes(context.key)) names(environment.collections, "collection");
        else if (context.key === "$type") names(BSON_TYPES, "value");
        else if (context.word.startsWith("$$")) options.push(...SYSTEM_VARIABLES.map(entry => fromEntry(entry, "variable")));
        else if (context.word.startsWith("$")) names(fieldsOf(target?.collection).map(field => `$${field}`), "field");
        else if (target?.method === "distinct" && context.argument === 0) names(fieldsOf(target.collection), "field");
        else if (context.key !== undefined && FIELD_KEYS.includes(context.key)) names(fieldsOf(target?.collection), "field");
        else options.push(...valuesHere());
        if (options.length === 0) return undefined;
        return { from: context.from, options, auto: true };
    }

    if (context.kind === "value") {
        if (atStatement(context)) {
            // An empty line, or the start of a statement: `db`, then what else a script has.
            options.push({ label: "db", type: "value", boost: 20 }, ...SCRIPT_GLOBALS.map(entry => snippetOf(entry, "value", 10)));
        }
        options.push(...valuesHere(), ...BSON_HELPERS.map(entry => snippetOf(entry, "value")));
        return { from: context.from, options, auto: context.word !== "" };
    }

    if (!target) return undefined;
    const choices = keyChoices(target, context.argument, context.path);
    if (choices.stages) options.push(...choices.stages.map(entry => snippetOf(entry, "stage")));
    if (choices.operators) {
        options.push(...choices.operators.map((entry): Suggestion => ({ ...fromEntry(entry, "operator"), apply: `${entry.name}${keySuffix}` })));
    }
    if (choices.options) options.push(...choices.options.map((label): Suggestion => ({ label, type: "option", apply: `${label}${keySuffix}`, boost: 5 })));
    if (choices.fields) {
        options.push(...fieldsOf(target.collection).map((field): Suggestion => ({
            label: field,
            type: "field",
            apply: context.quoted ? field : `${PLAIN_NAME.test(field) ? field : JSON.stringify(field)}: `,
            boost: 10
        })));
    }
    if (options.length === 0) return undefined;
    return { from: context.from, options, auto: true };
}
