import type { Doc, Json } from "./ejson";

/**
 * Changing a field in more than one document, as the field dialogs do: where the change
 * goes (`scope`), and for setting a value in many documents, in which of them (`condition`).
 */
export const FIELD_SCOPES = ["single", "selected", "query", "collection"] as const;
export type FieldScope = typeof FIELD_SCOPES[number];

export const FIELD_CONDITIONS = ["always", "exists", "missing"] as const;
export type FieldCondition = typeof FIELD_CONDITIONS[number];

/** `push` appends an element to an array (*Add element to array*). */
export type FieldChange = { kind: "set"; path: string; value: Json } | { kind: "rename"; path: string; to: string } | { kind: "unset"; path: string } | { kind: "push"; path: string; value: Json };

/** The documents a scope stands for: the one, the selected ones, the query's filter, or all. */
export interface FieldTarget {
    /** `_id` of the document the dialog was opened on. */
    id: Json;
    /** `_id`s of the selected documents. */
    selected: Json[];
    /** Filter of the query in the tab; absent when the result does not come from a `find`. */
    query?: Doc;
}

/** The scopes the dialog offers: the query only with a filter it can use, many only with a selection. */
export function scopesFor(target: FieldTarget, change: FieldChange["kind"]): FieldScope[] {
    if (change === "push") return ["single"];
    return FIELD_SCOPES.filter(scope => (scope !== "query" || target.query !== undefined) && (scope !== "selected" || target.selected.length > 1));
}

/** The condition applies to setting a value in documents the dialog does not show one by one. */
export function hasCondition(change: FieldChange["kind"], scope: FieldScope): boolean {
    return change === "set" && (scope === "query" || scope === "collection");
}

function scopeFilter(target: FieldTarget, scope: FieldScope): Doc {
    switch (scope) {
        case "single": return { _id: target.id };
        case "selected": return { _id: { $in: target.selected } };
        case "query": return target.query ?? {};
        case "collection": return {};
    }
}

/** The filter, narrowed by the condition on the field. */
export function fieldFilter(target: FieldTarget, scope: FieldScope, path: string, condition: FieldCondition = "always"): Doc {
    const filter = scopeFilter(target, scope);
    if (condition === "always") return filter;
    const exists = { [path]: { $exists: condition === "exists" } };
    return Object.keys(filter).length === 0 ? exists : { $and: [filter, exists] };
}

function updateOf(change: FieldChange): Doc {
    switch (change.kind) {
        case "set": return { $set: { [change.path]: change.value } };
        case "rename": return { $rename: { [change.path]: change.to } };
        case "unset": return { $unset: { [change.path]: "" } };
        case "push": return { $push: { [change.path]: change.value } };
    }
}

/** The `update` command of the change for the documents of the scope. */
export function fieldCommand(collection: string, change: FieldChange, target: FieldTarget, scope: FieldScope, condition: FieldCondition = "always"): Doc {
    const q = fieldFilter(target, scope, change.path, hasCondition(change.kind, scope) ? condition : "always");
    return { update: collection, updates: [{ q, u: updateOf(change), multi: scope !== "single" }] };
}

/** A path from the parent's path and a name; the name may not hold a dot or start with `$`. */
export function joinPath(parent: string, name: string): string {
    return parent ? `${parent}.${name}` : name;
}

/** Why a field name can not be used, as an i18n key; undefined when it can. */
export function nameProblem(name: string): string | undefined {
    if (!name.trim()) return "field.error.noName";
    if (name.includes(".") || name.startsWith("$")) return "field.error.badName";
    return undefined;
}
