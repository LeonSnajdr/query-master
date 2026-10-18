import { collationDoc, collationFormOf, emptyCollation } from "@/shell/collation";
import type { CollationForm } from "@/shell/collation";
import { isDoc, toNumber, toShell } from "@/shell/ejson";
import type { Doc, Json } from "@/shell/ejson";
import { parseValue } from "@/shell/parse";

/** How one field is indexed; `1`/`-1` ascending/descending, the others special kinds. */
export const INDEX_KINDS = ["1", "-1", "text", "2dsphere", "2d", "hashed"] as const;
export type IndexKind = typeof INDEX_KINDS[number];

/** Languages of a text index (MongoDB's); `none` for no stemming and no stop words. */
export const TEXT_LANGUAGES = ["none", "danish", "dutch", "english", "finnish", "french", "german", "hungarian", "italian", "norwegian", "portuguese", "romanian", "russian", "spanish", "swedish", "turkish"] as const;

export interface IndexField {
    field: string;
    kind: IndexKind;
}

/** The options of a text index tab *Text*; empty leaves one out. */
export interface TextOptions {
    defaultLanguage: string;
    languageOverride: string;
    /** `1`, `2` or `3`. */
    version: string;
    /** Weights of the fields as shell text, `{ title: 10 }`; empty for 1 each. */
    weights: string;
}

/** The options of a geo index tab *Geo*: bounds and bits of 2d, the 2dsphere version. */
export interface GeoOptions {
    min: string;
    max: string;
    bits: string;
    sphereVersion: string;
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
    collation: CollationForm;
    text: TextOptions;
    geo: GeoOptions;
    /**
     * Options of an existing index the dialog has no field for (`wildcardProjection` …): they go
     * into the index again unchanged, so re-creating or duplicating loses nothing.
     */
    kept?: Doc;
}

export function emptyIndexForm(): IndexForm {
    return {
        fields: [{ field: "", kind: "1" }],
        name: "",
        unique: false,
        sparse: false,
        hidden: false,
        ttl: "",
        collation: emptyCollation(),
        text: { defaultLanguage: "", languageOverride: "", version: "", weights: "" },
        geo: { min: "", max: "", bits: "", sphereVersion: "" }
    };
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

/** Whether the index has a field of the kind: the tabs Text and Geo apply only then. */
export function hasKind(form: IndexForm, ...kinds: IndexKind[]): boolean {
    return form.fields.some(row => row.field.trim() !== "" && kinds.includes(row.kind));
}

const isNumber = (text: string) => text.trim() !== "" && Number.isFinite(Number(text));

/** The weights as a document, braces optional (`title: 10, body: 1`); throws when the text is none. */
function weightsOf(text: string): Doc | undefined {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    const value = parseValue(trimmed.startsWith("{") ? trimmed : `{ ${trimmed} }`);
    if (!isDoc(value)) throw new Error("weights");
    return value;
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
    if (hasKind(form, "text")) {
        try {
            weightsOf(form.text.weights);
        } catch {
            errors.push("indexDialog.error.weights");
        }
    }
    if (hasKind(form, "2d")) {
        const { min, max, bits } = form.geo;
        if ([min, max].some(text => text.trim() !== "" && !isNumber(text))) errors.push("indexDialog.error.bounds");
        else if (isNumber(min) && isNumber(max) && Number(min) >= Number(max)) errors.push("indexDialog.error.bounds");
        if (bits.trim() !== "" && !(Number.isInteger(Number(bits)) && Number(bits) >= 1 && Number(bits) <= 32)) errors.push("indexDialog.error.bits");
    }
    return errors;
}

/** The index specification for `createIndexes`. */
export function indexSpec(form: IndexForm): Doc {
    const key = indexKey(form.fields);
    const spec: Doc = { key, name: form.name.trim() || defaultIndexName(key), ...form.kept };
    if (form.unique) spec.unique = true;
    if (form.sparse) spec.sparse = true;
    if (form.hidden) spec.hidden = true;
    if (form.ttl.trim() !== "") spec.expireAfterSeconds = Number(form.ttl);
    if (form.partialFilter && Object.keys(form.partialFilter).length > 0) spec.partialFilterExpression = form.partialFilter;
    if (hasKind(form, "text")) {
        const { defaultLanguage, languageOverride, version, weights } = form.text;
        const parsed = weightsOf(weights);
        if (parsed) spec.weights = parsed;
        if (defaultLanguage.trim()) spec.default_language = defaultLanguage.trim();
        if (languageOverride.trim()) spec.language_override = languageOverride.trim();
        if (version.trim()) spec.textIndexVersion = Number(version);
    }
    if (hasKind(form, "2d")) {
        const { min, max, bits } = form.geo;
        if (isNumber(min)) spec.min = Number(min);
        if (isNumber(max)) spec.max = Number(max);
        if (bits.trim()) spec.bits = Number(bits);
    }
    if (hasKind(form, "2dsphere") && form.geo.sphereVersion.trim()) spec["2dsphereIndexVersion"] = Number(form.geo.sphereVersion);
    const collation = collationDoc(form.collation);
    if (collation) spec.collation = collation;
    return spec;
}

function kindOf(value: Json): IndexKind {
    if (typeof value === "string") return INDEX_KINDS.find(kind => kind === value) ?? "1";
    const number = isDoc(value) ? Number(value.$numberInt ?? value.$numberLong ?? value.$numberDouble ?? 1) : Number(value);
    return number < 0 ? "-1" : "1";
}

/** A number of a stored index as text; empty when it has none. */
function numberText(value: Json | undefined): string {
    if (value === undefined || value === null) return "";
    return String(toNumber(value) ?? "");
}

/** An index as `listIndexes` gives it, as a specification to create it again. */
export function storedSpec(index: Doc): Doc {
    const spec = { ...index };
    delete spec.v;
    delete spec.ns;
    return spec;
}

/** What the form has a field for; the rest of a stored index is `kept`. */
const FORM_OPTIONS = new Set([
    "v", "ns", "key", "name", "unique", "sparse", "hidden", "expireAfterSeconds", "partialFilterExpression", "collation",
    "weights", "default_language", "language_override", "textIndexVersion", "min", "max", "bits", "2dsphereIndexVersion"
]);

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
    const kept = Object.fromEntries(Object.entries(index).filter(([option]) => !FORM_OPTIONS.has(option)));
    return {
        kept,
        fields: keyFields(key, index.weights),
        name: typeof index.name === "string" ? index.name : "",
        unique: index.unique === true,
        sparse: index.sparse === true,
        hidden: index.hidden === true,
        ttl: numberText(index.expireAfterSeconds),
        partialFilter: isDoc(index.partialFilterExpression) ? index.partialFilterExpression : undefined,
        collation: collationFormOf(index.collation),
        text: {
            defaultLanguage: typeof index.default_language === "string" ? index.default_language : "",
            languageOverride: typeof index.language_override === "string" ? index.language_override : "",
            version: numberText(index.textIndexVersion),
            weights: isDoc(index.weights) ? toShell(index.weights) : ""
        },
        geo: { min: numberText(index.min), max: numberText(index.max), bits: numberText(index.bits), sphereVersion: numberText(index["2dsphereIndexVersion"]) }
    };
}
