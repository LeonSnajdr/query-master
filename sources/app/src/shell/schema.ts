/**
 * The schema analysis (stage 23): what the fields of a collection hold, read from a sample. Per
 * field the types and how often, frequent values, a histogram for numbers and dates, the lengths of
 * arrays; and a `$jsonSchema` for "As validator …". Without Vue.
 */
import { isDoc, scalar, toNumber, typeOf } from "./ejson";
import type { Doc, Json, ValueType } from "./ejson";

/** Sample sizes offered; `0` reads all documents (with a time limit). */
export const SAMPLE_SIZES = [100, 1000, 5000, 0] as const;
export const DEFAULT_SAMPLE = 1000;
/** How long reading may take, in milliseconds; then a sample of 5000 is read instead. */
export const SCHEMA_TIME = 5000;
/** Values kept per field; more different values count as "many". */
export const MAX_VALUES = 100;
/** Classes of a histogram. */
export const BINS = 10;
/** Sub documents are followed this deep. */
const DEPTH = 6;

export interface Bin {
    from: number;
    /** Exclusive, except for the last class. */
    to: number;
    count: number;
}

export interface FieldStats {
    path: string;
    /** How many documents are in a sub document or array of the path: 0 for top-level fields. */
    depth: number;
    /** Documents that have the field (also with `null`). */
    present: number;
    /** By type, the most frequent first. */
    types: { type: ValueType; count: number }[];
    /** Most frequent values (strings, numbers, bools); absent when there were more than `MAX_VALUES`. */
    values?: { value: Json; count: number }[];
    /** Different values seen (up to `MAX_VALUES + 1`). */
    distinct: number;
    numbers?: Bin[];
    /** Milliseconds since 1970, in classes. */
    dates?: Bin[];
    /** Lengths of the arrays, as values. */
    lengths?: { value: number; count: number }[];
    /** Direct sub fields, by full path. */
    children: string[];
}

export interface SchemaResult {
    /** Documents analysed. */
    sampled: number;
    fields: FieldStats[];
}

/** How the documents are read: `$sample` of `size`, or all (`size` 0) with a time limit. */
export function sampleCommand(collection: string, size: number): Doc {
    const pipeline: Json[] = size > 0 ? [{ $sample: { size } }] : [];
    return { aggregate: collection, pipeline, cursor: {}, maxTimeMS: SCHEMA_TIME };
}

/** Milliseconds of a date, written `{ $date: "2024-…" }` or `{ $date: { $numberLong: "…" } }`. */
function dateMillis(value: Json): number | undefined {
    const inner = isDoc(value) ? value.$date : undefined;
    if (typeof inner === "string") {
        const parsed = Date.parse(inner);
        return Number.isNaN(parsed) ? undefined : parsed;
    }
    return inner === undefined ? undefined : toNumber(inner);
}

const valueKey = (value: Json) => scalar(value)?.text ?? JSON.stringify(value);

function choosable(value: Json): boolean {
    const type = typeOf(value);
    return type === "string" || type === "bool" || type === "int" || type === "long" || type === "double" || type === "decimal";
}

function bins(values: number[]): Bin[] | undefined {
    if (values.length === 0) return undefined;
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return [{ from: min, to: max, count: values.length }];
    const step = (max - min) / BINS;
    const result: Bin[] = Array.from({ length: BINS }, (_, index) => ({ from: min + index * step, to: index === BINS - 1 ? max : min + (index + 1) * step, count: 0 }));
    for (const value of values) result[Math.min(BINS - 1, Math.floor((value - min) / step))]!.count++;
    return result;
}

interface Collected {
    present: number;
    types: Map<ValueType, number>;
    values: Map<string, { value: Json; count: number }>;
    many: boolean;
    numbers: number[];
    dates: number[];
    lengths: Map<number, number>;
    children: Set<string>;
}

/** Reads every field of the documents, also in sub documents and the documents of arrays. */
export function analyze(documents: Json[]): SchemaResult {
    const fields = new Map<string, Collected>();
    const field = (path: string) => {
        let found = fields.get(path);
        if (!found) fields.set(path, (found = { present: 0, types: new Map(), values: new Map(), many: false, numbers: [], dates: [], lengths: new Map(), children: new Set() }));
        return found;
    };
    // Each field counts once per document, even when it shows in several elements of an array.
    const seen = new Set<string>();
    const add = (path: string, value: Json, depth: number) => {
        const stats = field(path);
        if (!seen.has(path)) {
            seen.add(path);
            stats.present++;
        }
        const type = typeOf(value);
        stats.types.set(type, (stats.types.get(type) ?? 0) + 1);
        if (choosable(value) && !stats.many) {
            const key = valueKey(value);
            const known = stats.values.get(key);
            if (known) known.count++;
            else if (stats.values.size < MAX_VALUES) stats.values.set(key, { value, count: 1 });
            else stats.many = true;
        }
        if (type === "int" || type === "long" || type === "double" || type === "decimal") {
            const number = toNumber(value);
            if (number !== undefined && Number.isFinite(number)) stats.numbers.push(number);
        }
        if (type === "date") {
            const time = dateMillis(value);
            if (time !== undefined) stats.dates.push(time);
        }
        if (depth >= DEPTH) return;
        if (Array.isArray(value)) {
            stats.lengths.set(value.length, (stats.lengths.get(value.length) ?? 0) + 1);
            for (const item of value) {
                if (isDoc(item) && !scalar(item)) walk(item, path, depth + 1);
            }
        } else if (isDoc(value) && !scalar(value)) {
            walk(value, path, depth + 1);
        }
    };
    const walk = (document: Doc, prefix: string, depth: number) => {
        for (const [key, value] of Object.entries(document)) {
            const path = prefix ? `${prefix}.${key}` : key;
            if (prefix) field(prefix).children.add(path);
            add(path, value, depth);
        }
    };
    for (const document of documents) {
        seen.clear();
        if (isDoc(document)) walk(document, "", 0);
    }
    const result: FieldStats[] = [...fields].map(([path, stats]) => ({
        path,
        depth: path.split(".").length - 1,
        present: stats.present,
        types: [...stats.types].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
        values: stats.many || stats.values.size === 0 ? undefined : [...stats.values.values()].sort((a, b) => b.count - a.count),
        distinct: stats.many ? MAX_VALUES + 1 : stats.values.size,
        numbers: bins(stats.numbers),
        dates: bins(stats.dates),
        lengths: stats.lengths.size === 0 ? undefined : [...stats.lengths].map(([value, count]) => ({ value, count })).sort((a, b) => a.value - b.value),
        children: [...stats.children]
    }));
    // In the order of the documents, sub fields right after their parent.
    return { sampled: documents.length, fields: result };
}

/** The type most values have; the others are "different" (shown grey, with a hint). */
export function mainType(stats: FieldStats): ValueType | undefined {
    return stats.types.find(entry => entry.type !== "null")?.type;
}

/** More than one type besides `null`. */
export function mixedTypes(stats: FieldStats): boolean {
    return stats.types.filter(entry => entry.type !== "null").length > 1;
}

/** Documents of the sample without the field, or with `null`. */
export function gaps(stats: FieldStats, sampled: number): number {
    return sampled - stats.present + (stats.types.find(entry => entry.type === "null")?.count ?? 0);
}

/** A field is called unique only from this many documents on; below, few values just differ by chance. */
export const UNIQUE_FROM = 10;

/** Every value is different: an id or a key, not something to count. */
export function unique(stats: FieldStats): boolean {
    return stats.present >= UNIQUE_FROM && stats.values !== undefined && stats.values.every(value => value.count === 1) && stats.values.length === stats.present;
}

const BSON_TYPES: Partial<Record<ValueType, string>> = {
    object: "object", array: "array", string: "string", int: "int", long: "long", double: "double", decimal: "decimal", bool: "bool",
    null: "null", objectId: "objectId", date: "date", regex: "regex", binary: "binData", uuid: "binData", timestamp: "timestamp", minKey: "minKey", maxKey: "maxKey"
};

/** At most this many values make an `enum`. */
const ENUM_UP_TO = 10;

/**
 * A `$jsonSchema` from the sample, for the validator dialog: `bsonType` per field, `required` for
 * fields every document has, `enum` for fields of strings with at most ten values. It is a start
 * to check, not a rule found.
 */
export function validatorOf(schema: SchemaResult): Doc {
    const node = (prefix: string): Doc => {
        const own = schema.fields.filter(stats => stats.depth === (prefix ? prefix.split(".").length : 0) && (prefix ? stats.path.startsWith(`${prefix}.`) : true));
        const properties: Doc = {};
        const required: string[] = [];
        for (const stats of own) {
            const name = prefix ? stats.path.slice(prefix.length + 1) : stats.path;
            const types = [...new Set(stats.types.map(entry => BSON_TYPES[entry.type]).filter((type): type is string => type !== undefined))];
            const property: Doc = { bsonType: types.length === 1 ? types[0]! : types };
            const allStrings = stats.types.every(entry => entry.type === "string");
            if (allStrings && stats.values && stats.values.length <= ENUM_UP_TO && !unique(stats)) property.enum = stats.values.map(value => value.value);
            if (types.length === 1 && types[0] === "object" && stats.children.length > 0) Object.assign(property, node(stats.path));
            properties[name] = property;
            const parent = prefix ? schema.fields.find(item => item.path === prefix)?.present ?? schema.sampled : schema.sampled;
            if (stats.present === parent && !stats.types.some(entry => entry.type === "null")) required.push(name);
        }
        return required.length > 0 ? { properties, required } : { properties };
    };
    return { $jsonSchema: { bsonType: "object", ...node("") } };
}

/**
 * The filter a click on a chart sets: a value (`{ status: "open" }`), several values of one field
 * (`$in`), a class of a histogram (`$gte`/`$lt`, the last class with `$lte`), or conditions on
 * several fields together (`$and`).
 */
export type ChartPick = { field: string; value: Json } | { field: string; range: Bin; last: boolean; date: boolean };

function conditionOf(pick: ChartPick): Json {
    if ("value" in pick) return pick.value;
    const bound = (number: number): Json => (pick.date ? { $date: new Date(number).toISOString() } : number);
    return pick.last ? { $gte: bound(pick.range.from), $lte: bound(pick.range.to) } : { $gte: bound(pick.range.from), $lt: bound(pick.range.to) };
}

export function filterOf(picks: ChartPick[]): Doc {
    const byField = new Map<string, ChartPick[]>();
    for (const pick of picks) byField.set(pick.field, [...(byField.get(pick.field) ?? []), pick]);
    const parts: Doc[] = [];
    for (const [field, of] of byField) {
        const values = of.filter((pick): pick is Extract<ChartPick, { value: Json }> => "value" in pick).map(pick => pick.value);
        const ranges = of.filter(pick => !("value" in pick));
        if (values.length === 1 && ranges.length === 0) parts.push({ [field]: values[0]! });
        else if (values.length > 1 && ranges.length === 0) parts.push({ [field]: { $in: values } });
        else if (ranges.length === 1 && values.length === 0) parts.push({ [field]: conditionOf(ranges[0]!) });
        else parts.push({ $or: of.map(pick => ({ [field]: conditionOf(pick) })) });
    }
    if (parts.length === 0) return {};
    return parts.length === 1 ? parts[0]! : { $and: parts };
}

/** The filter that shows the documents whose field has another type than the main one. */
export function typeFilter(field: string, type: ValueType): Doc {
    return { [field]: { $type: BSON_TYPES[type] ?? type } };
}
