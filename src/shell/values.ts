/**
 * Values of a field the editor can suggest. By themselves, as DataGrip does, only from documents
 * the app has already read (the sample for the fields, the result on screen); a search of all
 * data (`searchCommand`) runs only when asked for. Each place that knows values is a
 * `ValueSource`; more can be added later (see `docs/roadmap/16-werte.md`).
 */
import { isDoc, preview, scalar, toNumber } from "./ejson";
import type { Doc, Json } from "./ejson";
import { ShellError } from "./message";
import type { Message } from "./message";
import { parseValue } from "./parse";

/** A value seen in a field, and how often. */
export interface ValueHint {
    value: Json;
    count: number;
}

/** Somewhere values of fields are known: `undefined` or empty when it knows nothing of the field. */
export type ValueSource = (collection: string, field: string) => ValueHint[] | undefined;

/** Values per dotted field path, as `collectValues` counts them. */
export type ValueIndex = Map<string, ValueHint[]>;

/** A search of all data for the values of a field, while it runs and after. */
export interface ValueSearch {
    running: boolean;
    hints: ValueHint[];
    /** There were more values than the search keeps. */
    truncated: boolean;
    /** Searching everything took too long: the values are those of a sample. */
    sampled: boolean;
    error?: string | Message;
}

/** Runs searches of all data, for the editor; `prefix` is the text typed in the string so far. */
export interface ValueSearcher {
    state: (collection: string, field: string, prefix: string) => ValueSearch | undefined;
    run: (collection: string, field: string, prefix: string) => Promise<ValueSearch>;
}

/** Values kept per field; a field with more is likely an id or a name, not a choice. */
const MAX_VALUES = 100;
/** Longer strings are text, not a choice. */
const MAX_LENGTH = 100;
/** Sub documents are followed this deep. */
const DEPTH = 4;

/** Values one would pick from a list: strings, numbers and booleans; no ids, dates or binaries. */
function suggestible(value: Json): boolean {
    if (typeof value === "string") return value.length > 0 && value.length <= MAX_LENGTH;
    if (typeof value === "number" || typeof value === "boolean") return true;
    const leaf = isDoc(value) ? scalar(value) : undefined;
    return leaf?.type === "int" || leaf?.type === "long" || leaf?.type === "double" || leaf?.type === "decimal";
}

/** A key that tells two values apart: the same string and the same number count together, however written. */
function identity(value: Json): string {
    return scalar(value)?.text ?? JSON.stringify(value);
}

/** Counts the values of the fields of the documents, also of documents and values in arrays. */
export function collectValues(documents: Json[]): ValueIndex {
    const counts = new Map<string, Map<string, ValueHint>>();
    const add = (path: string, value: Json) => {
        if (!suggestible(value)) return;
        let field = counts.get(path);
        if (!field) counts.set(path, (field = new Map()));
        const key = identity(value);
        const hint = field.get(key);
        if (hint) hint.count++;
        // Past the limit only values already known are counted on.
        else if (field.size <= MAX_VALUES) field.set(key, { value, count: 1 });
    };
    const walk = (value: Json, path: string, depth: number) => {
        if (Array.isArray(value)) {
            // `{ tags: "a" }` matches an array that holds "a": its elements count for the array's path.
            for (const item of value) walk(item, path, depth);
            return;
        }
        if (isDoc(value) && !scalar(value)) {
            if (depth > DEPTH) return;
            for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key, depth + 1);
            return;
        }
        if (path) add(path, value);
    };
    for (const document of documents) walk(document, "", 1);

    const index: ValueIndex = new Map();
    for (const [path, field] of counts) {
        // Too many different values: not something to choose from.
        if (field.size > MAX_VALUES) continue;
        index.set(path, [...field.values()].sort((a, b) => b.count - a.count));
    }
    return index;
}

/** The values of `primary`, then those of `secondary` it does not have. */
export function preferValues(primary: ValueSource, secondary: ValueSource): ValueSource {
    return (collection, field) => {
        const first = primary(collection, field) ?? [];
        const known = new Set(first.map(hint => identity(hint.value)));
        return [...first, ...(secondary(collection, field) ?? []).filter(hint => !known.has(identity(hint.value)))];
    };
}

/** The values of several searches of one field (with different prefixes) as one list, each value once. */
export function combineSearches(searches: ValueSearch[]): ValueHint[] {
    const combined = new Map<string, ValueHint>();
    for (const search of searches) {
        for (const hint of search.hints) {
            const key = identity(hint.value);
            // A search with a longer prefix finds the same value with the same count.
            if ((combined.get(key)?.count ?? -1) < hint.count) combined.set(key, hint);
        }
    }
    return [...combined.values()].sort((a, b) => b.count - a.count);
}

/** The values of all sources together, counted together, the most frequent first. */
export function mergeValues(sources: ValueSource[]): ValueSource {
    return (collection, field) => {
        const merged = new Map<string, ValueHint>();
        for (const source of sources) {
            for (const hint of source(collection, field) ?? []) {
                const key = identity(hint.value);
                const known = merged.get(key);
                if (known) known.count += hint.count;
                else merged.set(key, { ...hint });
            }
        }
        return [...merged.values()].sort((a, b) => b.count - a.count);
    };
}

/** Values a search of all data keeps; it asks for one more to tell that there were more. */
export const SEARCH_LIMIT = 100;
/** How long the server may search, in milliseconds; then the search looks at a sample instead. */
export const SEARCH_TIME = 2000;
/** Documents that sample holds. */
export const SEARCH_SAMPLE = 5000;

function startsWith(prefix: string): Doc {
    return { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` };
}

/**
 * The search of all documents of a collection for the values of a field, the most frequent first.
 * With `prefix` only strings that start with it (an index on the field serves that); with
 * `sample` only in a random part of the collection, after a search of everything took too long.
 * Values in arrays count one by one, as a filter matches them.
 */
export function searchCommand(collection: string, field: string, prefix: string, sample = false): Doc {
    const pipeline: Json[] = [
        ...(sample ? [{ $sample: { size: SEARCH_SAMPLE } }] : []),
        { $match: { [field]: prefix ? startsWith(prefix) : { $exists: true } } },
        { $project: { _id: 0, v: `$${field}` } },
        { $unwind: "$v" },
        // In an array that matched, other elements need not start with the text.
        ...(prefix ? [{ $match: { v: startsWith(prefix) } }] : []),
        { $group: { _id: "$v", n: { $sum: 1 } } },
        { $sort: { n: -1, _id: 1 } },
        { $limit: SEARCH_LIMIT + 1 }
    ];
    return { aggregate: collection, pipeline, cursor: {}, maxTimeMS: SEARCH_TIME };
}

/** The values a search found, and whether there were more than it keeps. */
export function searchHints(documents: Json[]): { hints: ValueHint[]; truncated: boolean } {
    const hints = documents
        .filter(isDoc)
        .map(document => ({ value: document._id ?? null, count: toNumber(document.n) ?? 0 }))
        .filter(hint => suggestible(hint.value));
    return { hints: hints.slice(0, SEARCH_LIMIT), truncated: documents.length > SEARCH_LIMIT };
}

/**
 * The field a value belongs to, from the documents around it in a filter: `{ status: | }`,
 * `{ status: { $in: [| } }`, `{ $or: [{ status: | }] }`, `{ "customer.name": | }`.
 * `undefined` where the value is not compared with a field (`$expr`, `$regex`, `$size` …).
 */
export function filterField(path: string[]): string | undefined {
    const parts = [...path];
    if (parts.at(-1) === "[]") parts.pop();
    // The value of a comparison belongs to the field above it.
    if (["$eq", "$ne", "$in", "$nin"].includes(parts.at(-1) ?? "")) parts.pop();
    const names: string[] = [];
    for (let index = 0; index < parts.length; index++) {
        const part = parts[index]!;
        // `$and: [{ … }]`: the documents in the array are filters again.
        if (["$and", "$or", "$nor"].includes(part) && parts[index + 1] === "[]") {
            index++;
            continue;
        }
        if (part === "" || part === "[]" || part.startsWith("$")) return undefined;
        names.push(part);
    }
    return names.length > 0 ? names.join(".") : undefined;
}

/**
 * "Filter by this value": the filter text with `field: value` in it, on one line. An existing
 * condition on the field is replaced; the others stay.
 */
export function addToFilter(text: string, field: string, value: Json): string {
    const parsed = text.replace(/\s/g, "") === "" ? {} : parseValue(text);
    if (!isDoc(parsed) || scalar(parsed)) throw new ShellError("error.plan.document", { what: "filter" });
    const filter: Doc = { ...parsed, [field]: value };
    return preview(filter, Number.POSITIVE_INFINITY);
}

/** The dotted path of a field in a result as a filter takes it: without the places in arrays. */
export function filterPath(path: string): string {
    return path.split(".").filter(part => !/^\d+$/.test(part)).join(".");
}
