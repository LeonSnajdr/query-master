import { isDoc, newObjectId, toNumber } from "./ejson";
import type { Doc, Json } from "./ejson";
import { ShellError } from "./message";
import type { Message } from "./message";
import type { Call, Statement } from "./parse";

/**
 * How a statement is run: as one database command. The commands are written out here instead of
 * going through the typed methods of a driver, so every option the server takes can be given
 * (`let`, `hint`, `collation`, stages and operators of new server versions …).
 */
export interface Plan {
    database: string;
    command: Doc;
    /** The command opens a cursor; its documents are the result. */
    cursor: boolean;
    /** The result can be read page by page, by changing the command this way. */
    paging?: "find" | "aggregate";
    /** Makes what the shell shows out of the reply (or out of the documents of the cursor). */
    shape?: (reply: Json) => Json;
}

/** A cursor a script ended with but did not read: the call the window runs itself, to page it. */
export interface ScriptCursor {
    database: string;
    collection?: string;
    method: string;
    args: Json[];
    modifiers: Call[];
}

type Args = (Json | undefined)[];

function doc(value: Json | undefined, what: string): Doc {
    if (value === undefined) return {};
    if (!isDoc(value)) throw new ShellError("error.plan.document", { what });
    return value;
}

function array(value: Json | undefined, what: string): Json[] {
    if (!Array.isArray(value)) throw new ShellError("error.plan.array", { what });
    return value;
}

function string(value: Json | undefined, what: string): string {
    if (typeof value !== "string") throw new ShellError("error.plan.string", { what });
    return value;
}

function number(value: Json | undefined, what: string): number {
    const result = toNumber(value);
    if (result === undefined) throw new ShellError("error.plan.number", { what });
    return result;
}

/** A copy without the keys whose value is `undefined`. */
function compact(source: Record<string, Json | undefined>): Doc {
    return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined)) as Doc;
}

function pick(source: Doc, keys: readonly string[]): Doc {
    return Object.fromEntries(Object.entries(source).filter(([key]) => keys.includes(key)));
}

function omit(source: Doc, keys: readonly string[]): Doc {
    return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
}

function field(reply: Json, key: string): Json {
    return isDoc(reply) ? reply[key] ?? null : null;
}

function first(documents: Json): Json {
    return Array.isArray(documents) ? documents[0] ?? null : null;
}

/** `{ a: 1, b: -1 }` becomes `a_1_b_-1`, the name drivers give an index. */
function indexName(keys: Doc): string {
    return Object.entries(keys).map(([key, direction]) => `${key}_${toNumber(direction) ?? String(direction)}`).join("_");
}

function withId(document: Json): Doc {
    const value = doc(document, "document");
    return "_id" in value ? value : { _id: newObjectId(), ...value };
}

/** Options that belong to the single update or delete, not to the command around it. */
const UPDATE_STATEMENT_OPTIONS = ["upsert", "arrayFilters", "collation", "hint", "sort"] as const;
const DELETE_STATEMENT_OPTIONS = ["collation", "hint"] as const;

function updateCommand(collection: string, args: Args, multi: boolean): Plan["command"] {
    const options = doc(args[2], "options");
    const update = args[1];
    if (!isDoc(update) && !Array.isArray(update)) throw new ShellError("error.plan.update");
    return {
        update: collection,
        updates: [{ q: doc(args[0], "filter"), u: update, multi, ...pick(options, UPDATE_STATEMENT_OPTIONS) }],
        ...omit(options, [...UPDATE_STATEMENT_OPTIONS, "multi"])
    };
}

function updateResult(reply: Json): Json {
    const upserted = first(field(reply, "upserted"));
    return {
        acknowledged: true,
        matchedCount: upserted ? 0 : field(reply, "n"),
        modifiedCount: field(reply, "nModified"),
        upsertedCount: upserted ? 1 : 0,
        upsertedId: field(upserted, "_id")
    };
}

function deleteCommand(collection: string, args: Args, limit: 0 | 1): Doc {
    const options = doc(args[1], "options");
    return {
        delete: collection,
        deletes: [{ q: doc(args[0], "filter"), limit, ...pick(options, DELETE_STATEMENT_OPTIONS) }],
        ...omit(options, DELETE_STATEMENT_OPTIONS)
    };
}

function deleteResult(reply: Json): Json {
    return { acknowledged: true, deletedCount: field(reply, "n") };
}

function findAndModify(collection: string, args: Args, change: Doc, optionsAt: number): Plan["command"] {
    const options = doc(args[optionsAt], "options");
    const after = options.returnDocument === "after" || options.returnNewDocument === true;
    return compact({
        findAndModify: collection,
        query: doc(args[0], "filter"),
        ...change,
        new: "remove" in change ? undefined : after,
        fields: options.projection,
        ...omit(options, ["returnDocument", "returnNewDocument", "projection"])
    });
}

type CollectionMethod = (collection: string, args: Args, database: string) => Omit<Plan, "database"> & { database?: string };

const COLLECTION_METHODS: Record<string, CollectionMethod> = {
    find: (collection, args) => ({
        command: compact({
            find: collection,
            filter: doc(args[0], "filter"),
            projection: args[1] === undefined ? undefined : doc(args[1], "projection"),
            ...doc(args[2], "options")
        }),
        cursor: true,
        paging: "find"
    }),
    findOne: (collection, args) => ({
        command: compact({
            find: collection,
            filter: doc(args[0], "filter"),
            projection: args[1] === undefined ? undefined : doc(args[1], "projection"),
            ...doc(args[2], "options"),
            limit: 1,
            singleBatch: true
        }),
        cursor: true,
        shape: first
    }),
    aggregate: (collection, args) => ({
        command: { aggregate: collection, pipeline: args[0] === undefined ? [] : array(args[0], "pipeline"), cursor: {}, ...doc(args[1], "options") },
        cursor: true,
        paging: "aggregate"
    }),
    countDocuments: (collection, args) => {
        const options = doc(args[1], "options");
        const pipeline: Json[] = [{ $match: doc(args[0], "filter") }];
        if (options.skip !== undefined) pipeline.push({ $skip: options.skip });
        if (options.limit !== undefined) pipeline.push({ $limit: options.limit });
        pipeline.push({ $group: { _id: 1, n: { $sum: 1 } } });
        return {
            command: { aggregate: collection, pipeline, cursor: {}, ...omit(options, ["skip", "limit"]) },
            cursor: true,
            shape: documents => field(first(documents), "n") ?? 0
        };
    },
    estimatedDocumentCount: (collection, args) => ({
        command: { count: collection, ...doc(args[0], "options") },
        cursor: false,
        shape: reply => field(reply, "n")
    }),
    count: (collection, args) => ({
        command: { count: collection, query: doc(args[0], "filter"), ...doc(args[1], "options") },
        cursor: false,
        shape: reply => field(reply, "n")
    }),
    distinct: (collection, args) => ({
        command: { distinct: collection, key: string(args[0], "field"), query: doc(args[1], "filter"), ...doc(args[2], "options") },
        cursor: false,
        shape: reply => field(reply, "values")
    }),
    insertOne: (collection, args) => {
        const document = withId(args[0] ?? {});
        return {
            command: { insert: collection, documents: [document], ...doc(args[1], "options") },
            cursor: false,
            shape: () => ({ acknowledged: true, insertedId: document._id! })
        };
    },
    insertMany: (collection, args) => {
        const documents = array(args[0], "documents").map(withId);
        return {
            command: { insert: collection, documents, ...doc(args[1], "options") },
            cursor: false,
            shape: reply => ({ acknowledged: true, insertedCount: field(reply, "n"), insertedIds: documents.map(document => document._id!) })
        };
    },
    insert: (collection, args, database) => (Array.isArray(args[0]) ? COLLECTION_METHODS.insertMany! : COLLECTION_METHODS.insertOne!)(collection, args, database),
    updateOne: (collection, args) => ({ command: updateCommand(collection, args, false), cursor: false, shape: updateResult }),
    updateMany: (collection, args) => ({ command: updateCommand(collection, args, true), cursor: false, shape: updateResult }),
    update: (collection, args) => ({
        command: updateCommand(collection, args, doc(args[2], "options").multi === true),
        cursor: false,
        shape: updateResult
    }),
    replaceOne: (collection, args) => {
        const replacement = doc(args[1], "replacement");
        if (Object.keys(replacement).some(key => key.startsWith("$"))) throw new ShellError("error.plan.replacement");
        return { command: updateCommand(collection, args, false), cursor: false, shape: updateResult };
    },
    deleteOne: (collection, args) => ({ command: deleteCommand(collection, args, 1), cursor: false, shape: deleteResult }),
    deleteMany: (collection, args) => ({ command: deleteCommand(collection, args, 0), cursor: false, shape: deleteResult }),
    remove: (collection, args) => {
        const justOne = args[1] === true || (isDoc(args[1]) && args[1].justOne === true);
        return { command: deleteCommand(collection, [args[0]], justOne ? 1 : 0), cursor: false, shape: deleteResult };
    },
    findOneAndUpdate: (collection, args) => ({
        command: findAndModify(collection, args, { update: args[1] ?? {} }, 2),
        cursor: false,
        shape: reply => field(reply, "value")
    }),
    findOneAndReplace: (collection, args) => ({
        command: findAndModify(collection, args, { update: doc(args[1], "replacement") }, 2),
        cursor: false,
        shape: reply => field(reply, "value")
    }),
    findOneAndDelete: (collection, args) => ({
        command: findAndModify(collection, args, { remove: true }, 1),
        cursor: false,
        shape: reply => field(reply, "value")
    }),
    findAndModify: (collection, args) => ({
        command: { findAndModify: collection, ...doc(args[0], "argument") },
        cursor: false,
        shape: reply => field(reply, "value")
    }),
    createIndex: (collection, args) => {
        const key = doc(args[0], "keys");
        const options = doc(args[1], "options");
        return {
            command: { createIndexes: collection, indexes: [{ key, name: indexName(key), ...options }] },
            cursor: false
        };
    },
    createIndexes: (collection, args) => {
        const options = doc(args[1], "options");
        const indexes = array(args[0], "keys").map((keys) => {
            const key = doc(keys, "keys");
            return { key, name: indexName(key), ...options };
        });
        return { command: { createIndexes: collection, indexes }, cursor: false };
    },
    getIndexes: collection => ({ command: { listIndexes: collection }, cursor: true }),
    dropIndex: (collection, args) => ({ command: { dropIndexes: collection, index: args[0] ?? "*" }, cursor: false }),
    dropIndexes: (collection, args) => ({ command: { dropIndexes: collection, index: args[0] ?? "*" }, cursor: false }),
    hideIndex: (collection, args) => ({ command: { collMod: collection, index: indexSelector(args[0], true) }, cursor: false }),
    unhideIndex: (collection, args) => ({ command: { collMod: collection, index: indexSelector(args[0], false) }, cursor: false }),
    getSearchIndexes: (collection, args) => ({
        command: { aggregate: collection, pipeline: [{ $listSearchIndexes: compact({ name: typeof args[0] === "string" ? args[0] : undefined }) }], cursor: {} },
        cursor: true
    }),
    createSearchIndex: (collection, args) => {
        // Either (name, definition), (name, type, definition), or one document { name, type, definition }.
        const description = isDoc(args[0]) && args.length === 1
            ? args[0]
            : compact({ name: string(args[0], "name"), type: args.length > 2 ? args[1] : undefined, definition: doc(args.at(-1), "definition") });
        return { command: { createSearchIndexes: collection, indexes: [description] }, cursor: false };
    },
    updateSearchIndex: (collection, args) => ({
        command: { updateSearchIndex: collection, name: string(args[0], "name"), definition: doc(args[1], "definition") },
        cursor: false
    }),
    dropSearchIndex: (collection, args) => ({
        command: { dropSearchIndex: collection, name: string(args[0], "name") },
        cursor: false
    }),
    drop: collection => ({ command: { drop: collection }, cursor: false, shape: () => true }),
    renameCollection: (collection, args, database) => ({
        database: "admin",
        command: { renameCollection: `${database}.${collection}`, to: `${database}.${string(args[0], "name")}`, dropTarget: args[1] === true },
        cursor: false
    }),
    stats: (collection, args) => ({
        command: { aggregate: collection, pipeline: [{ $collStats: { storageStats: doc(args[0], "options") } }], cursor: {} },
        cursor: true,
        shape: documents => field(first(documents), "storageStats")
    }),
    validate: (collection, args) => ({ command: { validate: collection, ...doc(args[0], "options") }, cursor: false })
};
COLLECTION_METHODS.ensureIndex = COLLECTION_METHODS.createIndex!;
COLLECTION_METHODS.indexes = COLLECTION_METHODS.getIndexes!;

function indexSelector(index: Json | undefined, hidden: boolean): Doc {
    if (typeof index === "string") return { name: index, hidden };
    return { keyPattern: doc(index, "index"), hidden };
}

type DatabaseMethod = (args: Args, database: string) => Omit<Plan, "database"> & { database?: string };

const DATABASE_METHODS: Record<string, DatabaseMethod> = {
    runCommand: args => ({
        command: typeof args[0] === "string" ? { [args[0]]: 1 } : doc(args[0], "command"),
        cursor: false
    }),
    adminCommand: args => ({
        database: "admin",
        command: typeof args[0] === "string" ? { [args[0]]: 1 } : doc(args[0], "command"),
        cursor: false
    }),
    aggregate: args => ({
        command: { aggregate: 1, pipeline: array(args[0], "pipeline"), cursor: {}, ...doc(args[1], "options") },
        cursor: true,
        paging: "aggregate"
    }),
    getCollectionNames: () => ({
        command: { listCollections: 1, nameOnly: true },
        cursor: true,
        shape: documents => (documents as Doc[]).map(document => String(document.name)).sort((a, b) => a.localeCompare(b))
    }),
    getCollectionInfos: args => ({
        command: { listCollections: 1, filter: doc(args[0], "filter"), ...doc(args[1], "options") },
        cursor: true
    }),
    createCollection: args => ({
        command: { create: string(args[0], "name"), ...doc(args[1], "options") },
        cursor: false
    }),
    createView: args => ({
        command: {
            create: string(args[0], "name"),
            viewOn: string(args[1], "source"),
            pipeline: array(args[2], "pipeline"),
            ...doc(args[3], "options")
        },
        cursor: false
    }),
    dropDatabase: () => ({ command: { dropDatabase: 1 }, cursor: false }),
    stats: args => ({ command: compact({ dbStats: 1, scale: isDoc(args[0]) ? args[0].scale : args[0] }), cursor: false }),
    version: () => ({ command: { buildInfo: 1 }, cursor: false, shape: reply => field(reply, "version") }),
    serverBuildInfo: () => ({ command: { buildInfo: 1 }, cursor: false }),
    serverStatus: args => ({ command: { serverStatus: 1, ...doc(args[0], "options") }, cursor: false }),
    hostInfo: () => ({ database: "admin", command: { hostInfo: 1 }, cursor: false }),
    hello: () => ({ command: { hello: 1 }, cursor: false }),
    listCommands: () => ({ command: { listCommands: 1 }, cursor: false, shape: reply => field(reply, "commands") }),
    currentOp: args => ({
        database: "admin",
        command: { aggregate: 1, pipeline: [{ $currentOp: {} } as Doc, { $match: isDoc(args[0]) ? args[0] : {} }], cursor: {} },
        cursor: true
    }),
    killOp: args => ({ database: "admin", command: { killOp: 1, op: number(args[0], "opid") }, cursor: false }),
    getUsers: () => ({ command: { usersInfo: 1 }, cursor: false, shape: reply => field(reply, "users") }),
    getRoles: args => ({ command: { rolesInfo: 1, ...doc(args[0], "options") }, cursor: false, shape: reply => field(reply, "roles") }),
    getProfilingStatus: () => ({ command: { profile: -1 }, cursor: false }),
    setProfilingLevel: args => ({
        command: { profile: number(args[0], "level"), ...(isDoc(args[1]) ? args[1] : compact({ slowms: args[1] })) },
        cursor: false
    })
};

export const collectionMethodNames = Object.keys(COLLECTION_METHODS);
export const databaseMethodNames = Object.keys(DATABASE_METHODS);

/** Cursor methods that set a field of the `find` command. */
const FIND_MODIFIERS: Record<string, (args: Json[]) => Doc> = {
    sort: args => ({ sort: doc(args[0], "sort") }),
    limit: args => ({ limit: Math.abs(number(args[0], "limit")) }),
    skip: args => ({ skip: number(args[0], "skip") }),
    project: args => ({ projection: doc(args[0], "projection") }),
    projection: args => ({ projection: doc(args[0], "projection") }),
    hint: args => ({ hint: args[0] ?? {} }),
    collation: args => ({ collation: doc(args[0], "collation") }),
    maxTimeMS: args => ({ maxTimeMS: number(args[0], "maxTimeMS") }),
    batchSize: args => ({ batchSize: number(args[0], "batchSize") }),
    comment: args => ({ comment: args[0] ?? "" }),
    min: args => ({ min: doc(args[0], "min") }),
    max: args => ({ max: doc(args[0], "max") }),
    returnKey: args => ({ returnKey: args[0] ?? true }),
    showRecordId: args => ({ showRecordId: args[0] ?? true }),
    allowDiskUse: args => ({ allowDiskUse: args[0] ?? true }),
    readConcern: args => ({ readConcern: { level: string(args[0], "level") } }),
    noCursorTimeout: () => ({ noCursorTimeout: true })
};

const AGGREGATE_MODIFIERS: Record<string, (args: Json[]) => Doc> = {
    hint: FIND_MODIFIERS.hint!,
    collation: FIND_MODIFIERS.collation!,
    maxTimeMS: FIND_MODIFIERS.maxTimeMS!,
    comment: FIND_MODIFIERS.comment!,
    allowDiskUse: FIND_MODIFIERS.allowDiskUse!,
    batchSize: args => ({ cursor: { batchSize: number(args[0], "batchSize") } })
};

/** Methods that read the cursor in the shell; here the result is shown anyway. */
const NO_EFFECT = ["toArray", "pretty", "itcount", "forEach", "next", "hasNext"];

export const findModifierNames = [...Object.keys(FIND_MODIFIERS), "count", "explain", "toArray"];
export const aggregateModifierNames = [...Object.keys(AGGREGATE_MODIFIERS), "explain", "toArray"];

function explain(plan: Plan, verbosity: Json | undefined): Plan {
    // The server explains aggregate through its own flag only without a verbosity; the explain command takes both.
    const command = plan.command.aggregate === undefined ? plan.command : omit(plan.command, ["cursor"]);
    return {
        database: plan.database,
        command: { explain: plan.command.aggregate === undefined ? command : { ...command, cursor: {} }, verbosity: typeof verbosity === "string" ? verbosity : "queryPlanner" },
        cursor: false
    };
}

function applyModifier(plan: Plan, modifier: Call): Plan {
    if (NO_EFFECT.includes(modifier.name)) return plan;
    if (modifier.name === "explain") return explain(plan, modifier.args[0]);
    if (plan.command.find !== undefined && plan.paging === "find") {
        if (modifier.name === "count" || modifier.name === "size") {
            // Counts what the cursor would return; `size` honours skip and limit, as in the shell.
            const pipeline: Json[] = [{ $match: plan.command.filter ?? {} }];
            if (modifier.name === "size" && plan.command.skip !== undefined) pipeline.push({ $skip: plan.command.skip });
            if (modifier.name === "size" && plan.command.limit !== undefined) pipeline.push({ $limit: plan.command.limit });
            pipeline.push({ $group: { _id: 1, n: { $sum: 1 } } });
            return {
                database: plan.database,
                command: compact({ aggregate: plan.command.find, pipeline, cursor: {}, hint: plan.command.hint, collation: plan.command.collation }),
                cursor: true,
                shape: documents => field(first(documents), "n") ?? 0
            };
        }
        const change = FIND_MODIFIERS[modifier.name];
        if (change) return { ...plan, command: { ...plan.command, ...change(modifier.args) } };
    }
    if (plan.command.aggregate !== undefined && plan.paging === "aggregate") {
        const change = AGGREGATE_MODIFIERS[modifier.name];
        if (change) return { ...plan, command: { ...plan.command, ...change(modifier.args) } };
    }
    throw new ShellError("error.plan.modifier", { name: modifier.name });
}

/** The plan for a statement, with `database` as the one chosen where the statement names none. */
export function planStatement(statement: Statement, database: string): Plan {
    const target = statement.database ?? database;
    if (!target) throw new ShellError("error.plan.database");

    // `db.orders.explain("executionStats").find(…)`: the same as `.find(…).explain("executionStats")`.
    if (statement.collection !== undefined && statement.method === "explain" && statement.modifiers.length > 0) {
        const [method, ...modifiers] = statement.modifiers as [Call, ...Call[]];
        return planStatement({
            ...statement,
            method: method.name,
            args: method.args,
            modifiers: [...modifiers, { name: "explain", args: statement.args }]
        }, database);
    }

    let base;
    if (statement.collection === undefined) {
        const method = DATABASE_METHODS[statement.method];
        if (!method) throw new ShellError("error.plan.databaseMethod", { name: statement.method });
        base = method(statement.args, target);
    } else {
        if (statement.method === "bulkWrite") throw new ShellError("error.plan.bulkWrite");
        const method = COLLECTION_METHODS[statement.method];
        if (!method) throw new ShellError("error.plan.collectionMethod", { name: statement.method });
        base = method(statement.collection, statement.args, target);
    }
    return statement.modifiers.reduce(applyModifier, { database: target, ...base });
}

function lastStage(pipeline: Json[]): string | undefined {
    const last = pipeline.at(-1);
    return isDoc(last) ? Object.keys(last)[0] : undefined;
}

/**
 * The command for one page of the result, or `undefined` when the page lies behind the limit the
 * statement sets itself. One document more than a page is fetched in the first batch, which tells
 * whether another page follows.
 */
export function pageCommand(plan: Plan, offset: number, size: number): Doc | undefined {
    if (plan.paging === "find") {
        const limit = toNumber(plan.command.limit) ?? 0;
        if (limit > 0 && offset >= limit) return undefined;
        const remaining = limit > 0 ? limit - offset : 0;
        return compact({
            ...plan.command,
            skip: (toNumber(plan.command.skip) ?? 0) + offset || undefined,
            limit: remaining || undefined,
            batchSize: remaining > 0 ? Math.min(remaining, size + 1) : size + 1
        });
    }
    if (plan.paging === "aggregate") {
        const pipeline = plan.command.pipeline as Json[];
        const writes = ["$out", "$merge"].includes(lastStage(pipeline) ?? "");
        if (writes) return offset === 0 ? plan.command : undefined;
        const cursor = isDoc(plan.command.cursor) ? plan.command.cursor : {};
        return {
            ...plan.command,
            pipeline: offset > 0 ? [...pipeline, { $skip: offset }] : pipeline,
            cursor: { ...cursor, batchSize: size + 1 }
        };
    }
    return offset === 0 ? plan.command : undefined;
}

/** Commands that change data or structure; a read-only tab does not send them. */
const WRITE_COMMANDS = [
    "insert", "update", "delete", "findAndModify", "create", "drop", "dropDatabase", "createIndexes", "dropIndexes", "renameCollection",
    "collMod", "createSearchIndexes", "updateSearchIndex", "dropSearchIndex", "killOp", "profile", "createUser", "updateUser", "dropUser",
    "createRole", "dropRole", "grantRolesToUser", "revokeRolesFromUser", "compact", "bulkWrite", "setParameter"
];

export function isWrite(plan: Plan): boolean {
    const name = Object.keys(plan.command)[0] ?? "";
    if (WRITE_COMMANDS.includes(name)) return true;
    const pipeline = plan.command.pipeline;
    return Array.isArray(pipeline) && ["$out", "$merge"].includes(lastStage(pipeline) ?? "");
}

/** A write that the server took but that did not go through (`ok: 1` with `writeErrors`). */
export function replyError(reply: Json): string | Message | undefined {
    if (!isDoc(reply)) return undefined;
    const writeError = first(reply.writeErrors ?? null);
    if (isDoc(writeError)) return typeof writeError.errmsg === "string" ? writeError.errmsg : { key: "error.plan.write" };
    if (isDoc(reply.writeConcernError)) return typeof reply.writeConcernError.errmsg === "string" ? reply.writeConcernError.errmsg : { key: "error.plan.writeConcern" };
    return undefined;
}
