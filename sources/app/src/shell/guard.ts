/**
 * Protection for production (stage 21): a connection carries an environment, and before a write
 * the app asks, as strictly as the environment says. Here only what can be decided without Vue:
 * what a command writes, whether to ask, how many to count, and how documents change.
 */
import { isDoc, preview, scalar, toNumber } from "./ejson";
import type { Doc, Json } from "./ejson";

export const ENVIRONMENTS = ["development", "test", "production"] as const;
export type Environment = typeof ENVIRONMENTS[number];

/** From this many documents on, the name of the collection has to be typed to go on. */
export const NAME_FROM = 100;
/** How long counting the documents a write touches may take, in milliseconds. */
export const COUNT_TIME = 2000;

/** What a command writes, as far as asking before it needs to know. */
export interface WriteInfo {
    /** The command's name: `update`, `delete`, `drop` … */
    command: string;
    /** The collection written to; absent for a whole database. */
    collection?: string;
    /** Which documents an update or a delete touches. */
    filter?: Doc;
    /** The update document (`$set` …), or a whole replacement. */
    update?: Json;
    /** Touches (or may touch) more than one document: `updateMany`, `deleteMany`, several inserts, a pipeline that writes. */
    many: boolean;
    /** Drops a collection or a database. */
    dropping: boolean;
    /** Documents an insert brings, when known. */
    inserted?: number;
}

function first(value: Json | undefined): Doc | undefined {
    return Array.isArray(value) && isDoc(value[0]) ? value[0] : undefined;
}

/** Reads a write command: what it touches and how widely. */
export function writeInfo(command: Doc): WriteInfo {
    const name = Object.keys(command)[0] ?? "";
    const target = command[name];
    const collection = typeof target === "string" ? target : undefined;
    switch (name) {
        case "update": {
            const updates = Array.isArray(command.updates) ? command.updates : [];
            const one = first(command.updates);
            return { command: name, collection, filter: isDoc(one?.q) ? one.q : {}, update: one?.u, many: updates.length > 1 || one?.multi === true, dropping: false };
        }
        case "delete": {
            const deletes = Array.isArray(command.deletes) ? command.deletes : [];
            const one = first(command.deletes);
            return { command: name, collection, filter: isDoc(one?.q) ? one.q : {}, many: deletes.length > 1 || toNumber(one?.limit) === 0, dropping: false };
        }
        case "insert": {
            const documents = Array.isArray(command.documents) ? command.documents.length : 0;
            return { command: name, collection, many: documents > 1, dropping: false, inserted: documents };
        }
        case "findAndModify":
            return { command: name, collection, filter: isDoc(command.query) ? command.query : {}, update: command.remove === true ? undefined : command.update, many: false, dropping: false };
        case "drop":
            return { command: name, collection, many: true, dropping: true };
        case "dropDatabase":
            return { command: name, many: true, dropping: true };
        case "aggregate":
            // A pipeline ending in `$out` or `$merge` writes all it yields.
            return { command: name, collection, many: true, dropping: false };
        case "bulkWrite":
            return { command: name, collection, many: true, dropping: false };
        default:
            return { command: name, collection, many: false, dropping: false };
    }
}

/**
 * Whether to ask before the write. Development and no environment: never. Test: when it may touch
 * several documents or drops. Production: always. `count` is how many documents it touches, if known.
 */
export function needsConfirm(environment: Environment | null | undefined, info: WriteInfo, count?: number): boolean {
    if (environment === "production") return true;
    if (environment !== "test") return false;
    return info.many || info.dropping || (count ?? 0) > 1;
}

/** The name of the collection (or database) has to be typed: from `NAME_FROM` documents on, and to drop. */
export function needsName(environment: Environment | null | undefined, info: WriteInfo, count?: number): boolean {
    if (environment !== "production" && environment !== "test") return false;
    return info.dropping || (count ?? 0) >= NAME_FROM;
}

/** The command that counts the documents an update or a delete touches, with a time limit. */
export function countCommand(info: WriteInfo): Doc | undefined {
    if (info.collection === undefined || info.filter === undefined) return undefined;
    return { aggregate: info.collection, pipeline: [{ $match: info.filter }, { $count: "n" }], cursor: {}, maxTimeMS: COUNT_TIME };
}

/** Documents a single update or delete touches at most: the count, cut to one for `updateOne`. */
export function touched(info: WriteInfo, matched: number): number {
    return info.many ? matched : Math.min(1, matched);
}

/** One changed field of a document, as the confirmation shows it. `after` absent: not computed. */
export interface FieldChange {
    field: string;
    before: string;
    after?: string;
}

function at(document: Doc, path: string): Json | undefined {
    let current: Json | undefined = document;
    for (const part of path.split(".")) {
        if (!isDoc(current) || scalar(current)) return undefined;
        current = current[part];
    }
    return current;
}

const shown = (value: Json | undefined) => (value === undefined ? "–" : preview(value, 60));

/**
 * How an update changes a document: for `$set`, `$unset`, `$inc`, `$rename` and a replacement.
 * Other operators (and pipelines) give only the fields with their values before.
 */
export function changesOf(document: Doc, update: Json | undefined): FieldChange[] | undefined {
    if (!isDoc(update) || scalar(update)) return undefined;
    const operators = Object.keys(update).filter(key => key.startsWith("$"));
    if (operators.length === 0) {
        // A replacement: every field that differs, the `_id` stays.
        const fields = [...new Set([...Object.keys(document), ...Object.keys(update)])].filter(field => field !== "_id");
        return fields
            .filter(field => JSON.stringify(document[field]) !== JSON.stringify(update[field]))
            .map(field => ({ field, before: shown(document[field]), after: shown(update[field]) }));
    }
    const changes: FieldChange[] = [];
    for (const operator of operators) {
        const fields = update[operator];
        if (!isDoc(fields)) continue;
        for (const [field, value] of Object.entries(fields)) {
            const before = at(document, field);
            switch (operator) {
                case "$set":
                    changes.push({ field, before: shown(before), after: shown(value) });
                    break;
                case "$unset":
                    changes.push({ field, before: shown(before), after: "–" });
                    break;
                case "$inc": {
                    const by = toNumber(value);
                    const from = before === undefined ? 0 : toNumber(before);
                    changes.push({ field, before: shown(before), after: by === undefined || from === undefined ? undefined : String(from + by) });
                    break;
                }
                case "$rename":
                    changes.push({ field, before: shown(before), after: "–" });
                    if (typeof value === "string") changes.push({ field: value, before: shown(at(document, value)), after: shown(before) });
                    break;
                default:
                    changes.push({ field, before: shown(before) });
            }
        }
    }
    return changes;
}

/** Whether script text may write, and how widely, to ask before it runs: `many`, `one` or not at all. */
export function scriptWrites(source: string): "many" | "one" | undefined {
    if (/\b(updateMany|deleteMany|drop|dropDatabase|bulkWrite|insertMany|remove)\s*\(|\$out\b|\$merge\b/.test(source)) return "many";
    if (/\b(insertOne|insert|updateOne|update|replaceOne|deleteOne|findOneAndUpdate|findOneAndReplace|findOneAndDelete|findAndModify|save|createIndex|createIndexes|dropIndex|dropIndexes|renameCollection|createCollection|createView|runCommand|adminCommand)\s*\(/.test(source)) return "one";
    return undefined;
}
