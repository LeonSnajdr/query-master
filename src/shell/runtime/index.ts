/**
 * What a script sees: `db`, the BSON helpers, `print`. This file is bundled into
 * `src-tauri/script/runtime.js` (`bun run build:runtime`) and runs inside the JavaScript engine of
 * the Rust side, not in the web view. Database access goes through the same planning as a single
 * statement (`../plan.ts`), so both ways build the same commands.
 */
import { isDoc, newObjectId, toShell } from "../ejson";
import type { Doc, Json } from "../ejson";
import type { Call } from "../parse";
import { aggregateModifierNames, collectionMethodNames, databaseMethodNames, findModifierNames, planStatement, replyError } from "../plan";
import { BinData, MaxKey, MinKey, NumberDecimal, NumberInt, NumberLong, ObjectId, Timestamp, fromEjson, isoDate, toEjson, uuid } from "./bson";

// Provided by the Rust side (`src-tauri/src/script`). Documents cross the border as extended JSON text.
declare const __command: (database: string, command: string) => string;
declare const __cursorOpen: (database: string, command: string) => number;
declare const __cursorNext: (handle: number, count: number) => string;
declare const __cursorClose: (handle: number) => void;
declare const __print: (text: string) => void;

/** Documents fetched from an open cursor at a time. */
const BATCH = 200;
/** Documents of a cursor shown when it is the result of the script. */
const SHOWN = 1000;

let currentDatabase = "";

function fail(message: string | { key: string }): never {
    throw new Error(typeof message === "string" ? message : message.key);
}

function runCommand(database: string, command: Doc): Doc {
    const reply = JSON.parse(__command(database, JSON.stringify(command))) as Doc;
    const failure = replyError(reply);
    if (failure) fail(failure);
    return reply;
}

/** A cursor as the shell knows it: set up with `sort`, `limit` …, read with `forEach`, `toArray` … */
class Cursor {
    private readonly modifiers: Call[] = [];
    private handle: number | undefined;
    private buffer: Json[] = [];
    private finished = false;

    constructor(
        private readonly database: string,
        private readonly collection: string | undefined,
        private readonly method: string,
        private readonly args: Json[],
        modifiers: Call[] = []
    ) {
        this.modifiers.push(...modifiers);
        // `cursor.sort(…)`, `cursor.limit(…)`: every method that changes the command before it is sent.
        for (const name of new Set([...findModifierNames, ...aggregateModifierNames])) {
            if (name in this) continue;
            Object.defineProperty(this, name, {
                value: (...values: unknown[]) => {
                    if (this.handle !== undefined) fail(`.${name}() comes too late: the cursor was already read`);
                    this.modifiers.push({ name, args: values.map(toEjson) });
                    return this;
                }
            });
        }
    }

    private plan(extra: Call[] = []) {
        return planStatement({ collection: this.collection, method: this.method, args: this.args, modifiers: [...this.modifiers, ...extra], start: 0, end: 0 }, this.database);
    }

    private fill(): void {
        if (this.finished || this.buffer.length > 0) return;
        if (this.handle === undefined) {
            const plan = this.plan();
            this.handle = __cursorOpen(plan.database, JSON.stringify(plan.command));
        }
        this.buffer = JSON.parse(__cursorNext(this.handle, BATCH)) as Json[];
        if (this.buffer.length === 0) this.finished = true;
    }

    hasNext(): boolean {
        this.fill();
        return this.buffer.length > 0;
    }

    next(): unknown {
        if (!this.hasNext()) fail("The cursor has no more documents");
        return fromEjson(this.buffer.shift()!);
    }

    forEach(callback: (document: unknown) => void): void {
        while (this.hasNext()) callback(this.next());
    }

    map<T>(callback: (document: unknown) => T): T[] {
        const mapped: T[] = [];
        this.forEach(document => mapped.push(callback(document)));
        return mapped;
    }

    toArray(): unknown[] {
        return this.map(document => document);
    }

    itcount(): number {
        let count = 0;
        this.forEach(() => count++);
        return count;
    }

    /** What the server says the query matches, without reading the documents. */
    count(): unknown {
        return execute(this.plan([{ name: "count", args: [] }]));
    }

    size(): unknown {
        return execute(this.plan([{ name: "size", args: [] }]));
    }

    explain(verbosity?: string): unknown {
        return execute(this.plan([{ name: "explain", args: verbosity === undefined ? [] : [verbosity] }]));
    }

    close(): void {
        if (this.handle !== undefined && !this.finished) __cursorClose(this.handle);
        this.finished = true;
        this.buffer = [];
    }

    pretty(): this {
        return this;
    }

    [Symbol.iterator](): Iterator<unknown> {
        return { next: () => (this.hasNext() ? { value: this.next(), done: false } : { value: undefined, done: true }) };
    }

    /** For the result of a script: the first documents as extended JSON, and whether there were more. */
    preview(): { items: Json[]; truncated: boolean } {
        const items: Json[] = [];
        while (items.length < SHOWN && this.hasNext()) items.push(this.buffer.shift()!);
        const truncated = this.hasNext();
        this.close();
        return { items, truncated };
    }
}

/** Runs a plan to its end and gives back what the shell would show, as script values. */
function execute(plan: ReturnType<typeof planStatement>): unknown {
    let result: Json;
    if (plan.cursor) {
        const handle = __cursorOpen(plan.database, JSON.stringify(plan.command));
        const documents: Json[] = [];
        for (;;) {
            const batch = JSON.parse(__cursorNext(handle, BATCH)) as Json[];
            if (batch.length === 0) break;
            documents.push(...batch);
        }
        result = plan.shape ? plan.shape(documents) : documents;
    } else {
        const reply = runCommand(plan.database, plan.command);
        result = plan.shape ? plan.shape(reply) : reply;
    }
    return fromEjson(result);
}

function call(database: string, collection: string | undefined, method: string, values: unknown[], modifiers: Call[] = []): unknown {
    const args = values.map(toEjson);
    // Reading methods give a cursor that is sent when it is first read, so `.sort()` can still follow.
    const lazy = (method === "find" && collection !== undefined) || method === "aggregate";
    if (lazy && modifiers.length === 0) return new Cursor(database, collection, method, args);
    return execute(planStatement({ collection, method, args, modifiers, start: 0, end: 0 }, database));
}

/** Options of a bulk operation that belong to the single write. */
const WRITE_OPTIONS = ["upsert", "arrayFilters", "collation", "hint"] as const;

/**
 * `bulkWrite`: the operations one after the other, counted together as drivers report them.
 * With `ordered: false` a failing operation is noted and the rest still runs.
 */
function bulkWrite(database: string, collection: string, operations: unknown, options: { ordered?: boolean } = {}): unknown {
    if (!Array.isArray(operations)) fail("bulkWrite takes an array of operations");
    const result = { acknowledged: true, insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0, insertedIds: {} as Record<number, unknown>, upsertedIds: {} as Record<number, unknown> };
    const errors: { index: number; errmsg: string }[] = [];
    (operations as Record<string, Record<string, unknown>>[]).forEach((operation, index) => {
        const [kind] = Object.keys(operation);
        const detail = kind === undefined ? undefined : operation[kind];
        if (kind === undefined || detail === undefined) fail(`Operation ${index} of bulkWrite is empty`);
        const pick = Object.fromEntries(WRITE_OPTIONS.filter(name => detail[name] !== undefined).map(name => [name, detail[name]]));
        try {
            switch (kind) {
                case "insertOne": {
                    const done = call(database, collection, "insertOne", [detail.document]) as { insertedId: unknown };
                    result.insertedCount++;
                    result.insertedIds[index] = done.insertedId;
                    break;
                }
                case "updateOne":
                case "updateMany":
                case "replaceOne": {
                    const done = call(database, collection, kind, [detail.filter, kind === "replaceOne" ? detail.replacement : detail.update, pick]) as { matchedCount: number; modifiedCount: number; upsertedCount: number; upsertedId: unknown };
                    result.matchedCount += Number(done.matchedCount);
                    result.modifiedCount += Number(done.modifiedCount);
                    if (done.upsertedCount) {
                        result.upsertedCount++;
                        result.upsertedIds[index] = done.upsertedId;
                    }
                    break;
                }
                case "deleteOne":
                case "deleteMany":
                    result.deletedCount += Number((call(database, collection, kind, [detail.filter, pick]) as { deletedCount: number }).deletedCount);
                    break;
                default:
                    fail(`bulkWrite does not know the operation ${kind}`);
            }
        } catch (error) {
            if (options.ordered !== false) throw error;
            errors.push({ index, errmsg: String((error as Error).message) });
        }
    });
    return errors.length > 0 ? { ...result, writeErrors: errors } : result;
}

function collectionOf(database: string, name: string): object {
    return new Proxy({}, {
        get(_, property) {
            if (typeof property !== "string") return undefined;
            if (property === "getName") return () => name;
            if (property === "getFullName") return () => `${database}.${name}`;
            // `db.orders.explain("executionStats").find(…)`
            if (property === "explain") {
                return (verbosity?: string) => new Proxy({}, {
                    get: (__, method) => (typeof method === "string"
                        ? (...values: unknown[]) => call(database, name, method, values, [{ name: "explain", args: verbosity === undefined ? [] : [verbosity] }])
                        : undefined)
                });
            }
            if (property === "bulkWrite") return (operations: unknown, options?: { ordered?: boolean }) => bulkWrite(database, name, operations, options);
            if (collectionMethodNames.includes(property)) return (...values: unknown[]) => call(database, name, property, values);
            // `db.system.profile`: a name with dots.
            return collectionOf(database, `${name}.${property}`);
        }
    });
}

function databaseOf(database: string): object {
    return new Proxy({}, {
        get(_, property) {
            if (typeof property !== "string") return undefined;
            if (property === "getName") return () => database;
            if (property === "getCollection") return (name: string) => collectionOf(database, name);
            if (property === "getSiblingDB") return (name: string) => databaseOf(name);
            if (databaseMethodNames.includes(property)) return (...values: unknown[]) => call(database, undefined, property, values);
            return collectionOf(database, property);
        }
    });
}

function text(value: unknown): string {
    return typeof value === "string" ? value : toShell(toEjson(value));
}

const globals: Record<string, unknown> = {
    ObjectId,
    ObjectID: ObjectId,
    ISODate: isoDate,
    NumberLong,
    Long: NumberLong,
    NumberInt,
    Int32: NumberInt,
    NumberDecimal,
    Decimal128: NumberDecimal,
    UUID: uuid,
    BinData,
    Timestamp,
    MinKey,
    MaxKey,
    print: (...values: unknown[]) => __print(values.map(text).join(" ")),
    printjson: (value: unknown) => __print(toShell(toEjson(value))),
    tojson: (value: unknown) => toShell(toEjson(value)),
    console: {
        log: (...values: unknown[]) => __print(values.map(text).join(" ")),
        error: (...values: unknown[]) => __print(values.map(text).join(" ")),
        warn: (...values: unknown[]) => __print(values.map(text).join(" "))
    }
};
Object.assign(globalThis, globals);

/** Called by the Rust side around a script. */
Object.assign(globalThis, {
    __qm: {
        /** Before the script: `db` is the database of the tab. */
        setup(database: string): void {
            currentDatabase = database;
            Object.assign(globalThis, { db: databaseOf(currentDatabase) });
        },
        /** After the script: its last value as what the result view shows. */
        finish(value: unknown): string {
            if (value instanceof Cursor) return JSON.stringify(value.preview());
            if (value === undefined) return JSON.stringify({ items: [], truncated: false });
            const json = toEjson(value);
            const items = Array.isArray(json) ? json : [json];
            return JSON.stringify({ items: items.slice(0, SHOWN), truncated: items.length > SHOWN });
        }
    }
});

// Used by `../ejson.ts` for new ObjectIds; the engine has no Web Crypto.
if (!("crypto" in globalThis)) {
    Object.assign(globalThis, {
        crypto: {
            getRandomValues<T extends Uint8Array>(bytes: T): T {
                for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
                return bytes;
            }
        }
    });
}

// Keeps the helpers in the bundle even where only scripts use them.
export { isDoc, newObjectId };
