import { isDoc, keyText, newObjectId, scalar, typeOf } from "./ejson";
import type { Json, ValueType } from "./ejson";

/**
 * A value as one changes it in place: its type apart, and the text without
 * the type around it (`abc` for the string "abc", the hex of an ObjectId, the digits of a number).
 */
export interface Draft {
    type: ValueType;
    text: string;
    /** Subtype of binary data other than UUIDs. */
    subType?: number;
}

/** The types the type menu of the editor offers; `more` in its submenu. */
export const DRAFT_TYPES: { main: (ValueType | "separator")[]; more: ValueType[] } = {
    main: ["object", "array", "separator", "binary", "uuid", "separator", "bool", "date", "timestamp", "objectId", "separator", "decimal", "double", "long", "int", "separator", "string"],
    more: ["null", "undefined", "regex", "minKey", "maxKey"]
};

/** Types without text of their own: the field of the editor stays empty. */
export const EMPTY_TYPES: readonly ValueType[] = ["null", "undefined", "minKey", "maxKey"];

const INTEGER = /^\s*-?\d+\s*$/;
const NUMBER = /^\s*-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** A value on one line in shell notation: `[ "a", 1 ]`, `{ name: "x" }`. */
export function oneLine(value: Json): string {
    const leaf = scalar(value);
    if (leaf) return leaf.text;
    if (Array.isArray(value)) return value.length === 0 ? "[]" : `[ ${value.map(oneLine).join(", ")} ]`;
    const entries = Object.entries(value as Record<string, Json>);
    return entries.length === 0 ? "{}" : `{ ${entries.map(([key, item]) => `${keyText(key)}: ${oneLine(item)}`).join(", ")} }`;
}

export function toDraft(value: Json): Draft {
    const type = typeOf(value);
    const leaf = scalar(value);
    const wrapped = (key: string) => (isDoc(value) ? String(value[key]) : String(value));
    switch (type) {
        case "object":
        case "array": return { type, text: oneLine(value) };
        case "string": return { type, text: typeof value === "string" ? value : JSON.parse(leaf!.text) as string };
        case "long": return { type, text: wrapped("$numberLong") };
        case "decimal": return { type, text: wrapped("$numberDecimal") };
        case "objectId": return { type, text: wrapped("$oid") };
        case "date": return { type, text: leaf!.text.slice(9, -2) };
        case "uuid": return { type, text: leaf!.text.slice(6, -2) };
        case "binary": {
            const binary = (value as { $binary: { base64: string; subType: string } }).$binary;
            return { type, text: binary.base64, subType: parseInt(binary.subType, 16) };
        }
        case "timestamp": return { type, text: leaf!.text.slice(10, -1) };
        default: return { type, text: EMPTY_TYPES.includes(type) ? "" : leaf?.text ?? "" };
    }
}

/**
 * The draft as shell text, to be parsed like a value typed in the shell. Text that does not fit the
 * type is written so that parsing fails and says why, rather than storing something else.
 */
export function fromDraft(draft: Draft): string {
    const text = draft.text.trim();
    const quoted = JSON.stringify(text);
    switch (draft.type) {
        case "string": return JSON.stringify(draft.text);
        // Plain numbers as the shell writes them: an integer is an int32, a fraction a double.
        case "int": return INTEGER.test(text) && Math.abs(Number(text)) < 2 ** 31 ? String(Number(text)) : `NumberInt(${INTEGER.test(text) ? quoted : text || "0"})`;
        case "long": return `NumberLong(${INTEGER.test(text) ? quoted : text || "0"})`;
        case "double":
            if (NUMBER.test(text) && !Number.isInteger(Number(text))) return String(Number(text));
            return `Double(${NUMBER.test(text) ? quoted : text || "0"})`;
        case "decimal": return `NumberDecimal(${NUMBER.test(text) ? quoted : text || "0"})`;
        case "bool": return text || "false";
        case "null": return "null";
        case "undefined": return "undefined";
        case "minKey": return "MinKey()";
        case "maxKey": return "MaxKey()";
        case "objectId": return `ObjectId(${quoted})`;
        case "date": return `ISODate(${quoted})`;
        case "uuid": return `UUID(${quoted})`;
        case "binary": return `BinData(${draft.subType ?? 0}, ${quoted})`;
        case "timestamp": return `Timestamp(${text || "0, 0"})`;
        case "regex": return text.startsWith("/") ? text : `/${text}/`;
        case "array": return text || "[]";
        case "object": return text || "{}";
        default: return text;
    }
}

function numberOf(draft: Draft): number | undefined {
    if (draft.type === "bool") return draft.text.trim() === "true" ? 1 : 0;
    if (draft.type === "date" || (draft.type === "string" && !NUMBER.test(draft.text))) {
        const milliseconds = new Date(draft.text).getTime();
        return Number.isNaN(milliseconds) ? undefined : milliseconds;
    }
    if (draft.type === "timestamp") return Number(draft.text.split(",")[0]);
    return NUMBER.test(draft.text) ? Number(draft.text) : undefined;
}

/** The draft as another type: what it says is kept as far as the type can hold it. */
export function convertDraft(draft: Draft, type: ValueType): Draft {
    if (type === draft.type) return draft;
    const text = draft.text.trim();
    const number = numberOf(draft);
    const next = (value: string): Draft => ({ type, text: value });
    switch (type) {
        case "string": return next(draft.text);
        case "int":
        case "long": return next(number === undefined ? "0" : String(Math.trunc(number)));
        case "double":
        case "decimal": return next(number === undefined ? "0" : String(number));
        case "bool": return next(text === "true" || (number !== undefined && number !== 0 && draft.type !== "bool") ? "true" : "false");
        case "date": {
            const milliseconds = draft.type === "timestamp" && number !== undefined ? number * 1000 : number;
            return next(new Date(milliseconds !== undefined && !Number.isNaN(milliseconds) ? milliseconds : Date.now()).toISOString());
        }
        case "timestamp": {
            const seconds = draft.type === "date" && number !== undefined ? Math.floor(number / 1000) : number;
            return next(`${seconds === undefined ? Math.floor(Date.now() / 1000) : Math.trunc(seconds)}, ${seconds === undefined ? 1 : 0}`);
        }
        case "objectId": return next(OBJECT_ID.test(text) ? text : String(newObjectId().$oid));
        case "uuid": return next(UUID.test(text) ? text : crypto.randomUUID());
        case "binary": return { type, text: text && BASE64.test(text) ? text : "", subType: 0 };
        case "regex": return next(text.startsWith("/") ? text : `/${text}/`);
        case "array": return next(draft.type === "object" || text === "" || EMPTY_TYPES.includes(draft.type) ? "[]" : `[ ${fromDraft(draft)} ]`);
        case "object": return next("{}");
        default: return next("");
    }
}
