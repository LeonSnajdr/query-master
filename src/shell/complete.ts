import {
    ACCUMULATORS, AGGREGATE_MODIFIERS, AGGREGATE_OPTIONS, BSON_HELPERS, BSON_TYPES, COLLECTION_METHODS, COMMANDS,
    CREATE_COLLECTION_OPTIONS, DATABASE_METHODS, DELETE_OPTIONS, EXPRESSIONS, FIND_AND_MODIFY_OPTIONS, FIND_MODIFIERS,
    FIND_OPTIONS, INDEX_OPTIONS, PROJECTION_OPERATORS, QUERY_FIELD, QUERY_LOGICAL, STAGES, SYSTEM_VARIABLES,
    UPDATE_MODIFIERS, UPDATE_OPERATORS, UPDATE_OPTIONS, UPDATE_PIPELINE_STAGES, WINDOW_OPERATORS, available, docKey
} from "./catalog";
import type { Entry } from "./catalog";
import type { Message } from "./message";
import { chainTarget, cursorContext } from "./context";
import type { Target } from "./context";

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
    const fieldsOf = (collection: string | undefined) => (collection ? environment.fields(collection) : []);

    if (context.kind === "member") {
        const target = chainTarget(context.chain);
        if (!target) return undefined;
        if (target.open && target.method !== undefined) return undefined;
        if (target.method === "explain") {
            options.push(...COLLECTION_METHODS.filter(entry => EXPLAINABLE.includes(entry.name)).map(entry => snippetOf(entry, "method")));
        } else if (target.method === "find") {
            options.push(...FIND_MODIFIERS.map(entry => snippetOf(entry, "method")));
        } else if (target.method === "aggregate") {
            options.push(...AGGREGATE_MODIFIERS.map(entry => snippetOf(entry, "method")));
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
    const target = chainTarget([...context.chain, { call: true }]);

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
        if (options.length === 0) return undefined;
        return { from: context.from, options, auto: true };
    }

    if (context.kind === "value") {
        if (!target && context.chain.length === 0 && context.path.length === 0 && "db".startsWith(context.word)) {
            // An empty line, or the start of a statement.
            return { from: context.from, options: [{ label: "db", type: "value", boost: 0 }], auto: context.word !== "" };
        }
        options.push(...BSON_HELPERS.map(entry => snippetOf(entry, "value")));
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
