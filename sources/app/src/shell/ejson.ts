/** A value as MongoDB extended JSON: BSON types that JSON lacks are wrapped (`{ $oid: "…" }`). */
export type Json = null | boolean | number | string | Json[] | Doc;
export interface Doc { [key: string]: Json }

export function isDoc(value: Json | undefined): value is Doc {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A plain number out of a number in either notation (`5`, `{ $numberInt: "5" }` …). */
export function toNumber(value: Json | undefined): number | undefined {
    if (typeof value === "number") return value;
    if (!isDoc(value)) return undefined;
    const wrapped = value.$numberInt ?? value.$numberLong ?? value.$numberDouble ?? value.$numberDecimal;
    return typeof wrapped === "string" ? Number(wrapped) : undefined;
}

export function objectId(hex: string): Doc {
    return { $oid: hex };
}

function randomHex(bytes: number): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** A new ObjectId: seconds since 1970, then random bytes (the counter part is random here too). */
export function newObjectId(now = Date.now()): Doc {
    return objectId(Math.floor(now / 1000).toString(16).padStart(8, "0") + randomHex(8));
}

export function date(milliseconds: number): Doc {
    return { $date: { $numberLong: String(milliseconds) } };
}

/** A UUID (with or without dashes) as BSON binary of subtype 4; `undefined` if the text is none. */
export function uuid(text: string): Doc | undefined {
    const hex = text.replaceAll("-", "");
    if (!/^[0-9a-f]{32}$/i.test(hex)) return undefined;
    const bytes = hex.match(/../g)!.map(pair => String.fromCharCode(parseInt(pair, 16))).join("");
    return { $binary: { base64: btoa(bytes), subType: "04" } };
}

function uuidText(base64: string): string {
    const hex = Array.from(atob(base64), char => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** What a value is, for the type column and the coloring of results. */
export type ValueType = "object" | "array" | "string" | "int" | "long" | "double" | "decimal" | "bool" | "null"
    | "objectId" | "date" | "regex" | "binary" | "uuid" | "timestamp" | "minKey" | "maxKey" | "undefined" | "code" | "other";

export interface Scalar {
    type: ValueType;
    /** As one writes it in the shell: `ObjectId("…")`, `NumberLong(5)`. */
    text: string;
}

function isoDate(value: Json): string {
    const milliseconds = isDoc(value) ? toNumber(value) : typeof value === "number" ? value : undefined;
    if (milliseconds === undefined) return String(value);
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? String(milliseconds) : parsed.toISOString();
}

/** The scalar a wrapped value stands for, or `undefined` for a document of the user. */
function unwrap(value: Doc): Scalar | undefined {
    const keys = Object.keys(value);
    const first = keys[0];
    if (first === undefined || !first.startsWith("$") || keys.length > 2) return undefined;
    const inner = value[first]!;
    switch (first) {
        case "$oid": return { type: "objectId", text: `ObjectId("${String(inner)}")` };
        case "$date": return { type: "date", text: `ISODate("${isoDate(inner)}")` };
        case "$numberInt": return { type: "int", text: String(inner) };
        case "$numberLong": return { type: "long", text: `NumberLong(${String(inner)})` };
        case "$numberDouble": {
            const text = String(inner);
            return { type: "double", text: /^-?\d+$/.test(text) ? `${text}.0` : text };
        }
        case "$numberDecimal": return { type: "decimal", text: `NumberDecimal("${String(inner)}")` };
        case "$regularExpression":
            return isDoc(inner) ? { type: "regex", text: `/${String(inner.pattern)}/${String(inner.options ?? "")}` } : undefined;
        case "$binary": {
            if (!isDoc(inner)) return undefined;
            const subType = String(inner.subType);
            const base64 = String(inner.base64);
            if (subType === "04" && base64.length === 24) return { type: "uuid", text: `UUID("${uuidText(base64)}")` };
            return { type: "binary", text: `BinData(${parseInt(subType, 16)}, "${base64}")` };
        }
        case "$timestamp":
            return isDoc(inner) ? { type: "timestamp", text: `Timestamp(${String(inner.t)}, ${String(inner.i)})` } : undefined;
        case "$minKey": return { type: "minKey", text: "MinKey()" };
        case "$maxKey": return { type: "maxKey", text: "MaxKey()" };
        case "$undefined": return { type: "undefined", text: "undefined" };
        case "$code": return { type: "code", text: `Code(${JSON.stringify(inner)})` };
        case "$symbol": return { type: "string", text: JSON.stringify(inner) };
        default: return undefined;
    }
}

/** A value that has no children in the result tree, or `undefined` for documents and arrays. */
export function scalar(value: Json): Scalar | undefined {
    if (value === null) return { type: "null", text: "null" };
    if (typeof value === "string") return { type: "string", text: JSON.stringify(value) };
    if (typeof value === "boolean") return { type: "bool", text: String(value) };
    if (typeof value === "number") return { type: Number.isInteger(value) ? "int" : "double", text: String(value) };
    if (Array.isArray(value)) return undefined;
    return unwrap(value);
}

export function typeOf(value: Json): ValueType {
    return scalar(value)?.type ?? (Array.isArray(value) ? "array" : "object");
}

const PLAIN_KEY = /^[A-Za-z_$][\w$]*$/;

/** A key as the shell takes it: quoted only where it has to be. */
export function keyText(key: string): string {
    return PLAIN_KEY.test(key) ? key : JSON.stringify(key);
}

/** A value as shell text, indented with four spaces; with `quoteKeys` every key is in quotes, as in JSON. */
export function toShell(value: Json, indent = "", quoteKeys = false): string {
    const leaf = scalar(value);
    if (leaf) return leaf.text;
    const inner = `${indent}    `;
    if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        return `[\n${value.map(item => inner + toShell(item, inner, quoteKeys)).join(",\n")}\n${indent}]`;
    }
    const entries = Object.entries(value as Doc);
    if (entries.length === 0) return "{}";
    const key = (name: string) => (quoteKeys ? JSON.stringify(name) : keyText(name));
    return `{\n${entries.map(([name, item]) => `${inner}${key(name)}: ${toShell(item, inner, quoteKeys)}`).join(",\n")}\n${indent}}`;
}

/** A value on one line, cut off after `max` characters (for collapsed rows and table cells). */
export function preview(value: Json, max = 80): string {
    const leaf = scalar(value);
    if (leaf) return leaf.text.length > max ? `${leaf.text.slice(0, max - 1)}…` : leaf.text;
    const entries: [string | undefined, Json][] = Array.isArray(value)
        ? value.map(item => [undefined, item])
        : Object.entries(value as Doc);
    const parts: string[] = [];
    let length = 0;
    for (const [key, item] of entries) {
        if (length > max) {
            parts.push("…");
            break;
        }
        // Also the last value that fits is shown with a few characters at least.
        const part = `${key === undefined ? "" : `${keyText(key)}: `}${preview(item, Math.max(12, max - length))}`;
        parts.push(part);
        length += part.length + 2;
    }
    const text = parts.join(", ");
    if (Array.isArray(value)) return text ? `[ ${text} ]` : "[]";
    return text ? `{ ${text} }` : "{}";
}
