import { isDoc } from "@/shell/ejson";
import type { Doc, Json } from "@/shell/ejson";

/** How one field is indexed; `1`/`-1` ascending/descending, the others special kinds. */
export const INDEX_KINDS = ["1", "-1", "text", "2dsphere", "2d", "hashed"] as const;
export type IndexKind = typeof INDEX_KINDS[number];

export interface IndexField {
    field: string;
    kind: IndexKind;
}

/** What the index dialog edits. */
export interface IndexForm {
    fields: IndexField[];
    /** Empty: derived from the fields like MongoDB does. */
    name: string;
    unique: boolean;
    sparse: boolean;
    hidden: boolean;
    /** Seconds after which documents expire; empty for none. */
    ttl: string;
    /** Only documents matching it are indexed; absent or `{}` for all. */
    partialFilter?: Doc;
    /** Collation locale; empty for none. */
    locale: string;
    /**
     * Options of an existing index the dialog has no field for (`weights`, `default_language`,
     * `2dsphereIndexVersion`, `bits`, `wildcardProjection`, the collation besides its locale …):
     * they go into the index again unchanged, so re-creating or duplicating loses nothing.
     */
    kept?: Doc;
}

export function emptyIndexForm(): IndexForm {
    return { fields: [{ field: "", kind: "1" }], name: "", unique: false, sparse: false, hidden: false, ttl: "", locale: "" };
}

function keyValue(kind: IndexKind): Json {
    return kind === "1" ? 1 : kind === "-1" ? -1 : kind;
}

/** The key document, fields in their order; rows without a field are left out. */
export function indexKey(fields: IndexField[]): Doc {
    const key: Doc = {};
    for (const row of fields) {
        const field = row.field.trim();
        if (field) key[field] = keyValue(row.kind);
    }
    return key;
}

/** The name MongoDB gives an index without one: `a_1_b_-1`. */
export function defaultIndexName(key: Doc): string {
    return Object.entries(key).map(([field, value]) => `${field}_${String(value)}`).join("_");
}

/** Problems of the form, as i18n keys; empty when it can be saved. */
export function indexFormErrors(form: IndexForm): string[] {
    const errors: string[] = [];
    const fields = form.fields.map(row => row.field.trim()).filter(Boolean);
    if (fields.length === 0) errors.push("indexDialog.error.noField");
    if (new Set(fields).size !== fields.length) errors.push("indexDialog.error.duplicateField");
    if (form.ttl.trim() !== "") {
        const seconds = Number(form.ttl);
        if (!Number.isInteger(seconds) || seconds < 0) errors.push("indexDialog.error.ttl");
        else if (fields.length > 1) errors.push("indexDialog.error.ttlCompound");
    }
    if (form.fields.some(row => row.kind === "hashed") && form.unique) errors.push("indexDialog.error.hashedUnique");
    return errors;
}

/** The index specification for `createIndexes`. */
export function indexSpec(form: IndexForm): Doc {
    const key = indexKey(form.fields);
    const { collation: keptCollation, ...kept } = form.kept ?? {};
    const spec: Doc = { key, name: form.name.trim() || defaultIndexName(key), ...kept };
    if (form.unique) spec.unique = true;
    if (form.sparse) spec.sparse = true;
    if (form.hidden) spec.hidden = true;
    if (form.ttl.trim() !== "") spec.expireAfterSeconds = Number(form.ttl);
    if (form.partialFilter && Object.keys(form.partialFilter).length > 0) spec.partialFilterExpression = form.partialFilter;
    // The other settings of a collation stay with it; without a locale there is none.
    if (form.locale) spec.collation = { ...(isDoc(keptCollation) ? keptCollation : {}), locale: form.locale };
    return spec;
}

function kindOf(value: Json): IndexKind {
    if (typeof value === "string") return INDEX_KINDS.find(kind => kind === value) ?? "1";
    const number = isDoc(value) ? Number(value.$numberInt ?? value.$numberLong ?? value.$numberDouble ?? 1) : Number(value);
    return number < 0 ? "-1" : "1";
}

function seconds(value: Json | undefined): string {
    if (value === undefined) return "";
    if (isDoc(value)) return String(value.$numberInt ?? value.$numberLong ?? value.$numberDouble ?? "");
    return String(value);
}

/** An index as `listIndexes` gives it, as a specification to create it again. */
export function storedSpec(index: Doc): Doc {
    const spec = { ...index };
    delete spec.v;
    delete spec.ns;
    return spec;
}

/** What the form has a field for; the rest of a stored index is `kept`. */
const FORM_OPTIONS = new Set(["v", "ns", "key", "name", "unique", "sparse", "hidden", "expireAfterSeconds", "partialFilterExpression"]);

/**
 * The fields of a stored key. A text index is stored as `{ _fts: "text", _ftsx: 1 }` with its
 * fields in `weights`: they come back as text fields, in place of the two.
 */
function keyFields(key: Doc, weights: Json | undefined): IndexField[] {
    const fields: IndexField[] = [];
    for (const [field, value] of Object.entries(key)) {
        if (field === "_ftsx") continue;
        if (field === "_fts") fields.push(...Object.keys(isDoc(weights) ? weights : {}).map(name => ({ field: name, kind: "text" as const })));
        else fields.push({ field, kind: kindOf(value) });
    }
    return fields;
}

/** The form for an index as `listIndexes` gives it, to duplicate or re-create it. */
export function indexFormOf(index: Doc): IndexForm {
    const key = isDoc(index.key) ? index.key : {};
    const collation = isDoc(index.collation) ? index.collation : {};
    const kept = Object.fromEntries(Object.entries(index).filter(([option]) => !FORM_OPTIONS.has(option)));
    return {
        kept,
        fields: keyFields(key, index.weights),
        name: typeof index.name === "string" ? index.name : "",
        unique: index.unique === true,
        sparse: index.sparse === true,
        hidden: index.hidden === true,
        ttl: seconds(index.expireAfterSeconds),
        partialFilter: isDoc(index.partialFilterExpression) ? index.partialFilterExpression : undefined,
        locale: typeof collation.locale === "string" ? collation.locale : ""
    };
}
