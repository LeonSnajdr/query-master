/**
 * Values of a field the editor can suggest, as DataGrip does: only from documents the app has
 * already read (the sample for the fields, the result on screen), never with a query of its own.
 * Each place that knows documents is a `ValueSource`; more can be added later (the enum of a JSON
 * schema validator, a `$group` on demand …, see `docs/roadmap/16-werte.md`).
 */
import { isDoc, preview, scalar } from "./ejson";
import type { Doc, Json } from "./ejson";
import { ShellError } from "./message";
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

/** A key that tells two values apart: the same string and the same number count together. */
function identity(value: Json): string {
    return JSON.stringify(value);
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
