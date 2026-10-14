import { isDoc, toNumber } from "@/shell/ejson";
import type { Doc, Json } from "@/shell/ejson";
import type { Plan } from "@/shell/plan";

/**
 * "Query Code": the query in the code of a driver. Values go in as canonical Extended JSON that
 * the driver parses itself (`EJSON.parse`, `json_util.loads`, `Document.parse`,
 * `BsonDocument.Parse`), so every BSON type arrives as it was typed.
 */
export const CODE_LANGUAGES = ["shell", "node", "python", "java", "csharp"] as const;
export type CodeLanguage = typeof CODE_LANGUAGES[number];

/** What a query is, as far as the code cares. */
type Query
    = | { kind: "find"; collection: string; filter: Doc; projection?: Doc; sort?: Doc; skip?: number; limit?: number }
        | { kind: "aggregate"; collection: string; pipeline: Json[]; allowDiskUse: boolean }
        | { kind: "command"; command: Doc };

const FIND_KEYS = ["find", "filter", "projection", "sort", "skip", "limit", "batchSize"];
const AGGREGATE_KEYS = ["aggregate", "pipeline", "cursor", "allowDiskUse"];

function only(command: Doc, keys: string[]): boolean {
    return Object.keys(command).every(key => keys.includes(key));
}

function nonEmpty(value: Json | undefined): Doc | undefined {
    return isDoc(value) && Object.keys(value).length > 0 ? value : undefined;
}

/** Find and aggregate with their common options become driver calls; anything else a command. */
function queryOf(plan: Plan): Query {
    const command = plan.command;
    if (typeof command.find === "string" && only(command, FIND_KEYS)) {
        return {
            kind: "find",
            collection: command.find,
            filter: isDoc(command.filter) ? command.filter : {},
            projection: nonEmpty(command.projection),
            sort: nonEmpty(command.sort),
            skip: toNumber(command.skip) || undefined,
            limit: toNumber(command.limit) || undefined
        };
    }
    if (typeof command.aggregate === "string" && Array.isArray(command.pipeline) && only(command, AGGREGATE_KEYS)) {
        return { kind: "aggregate", collection: command.aggregate, pipeline: command.pipeline, allowDiskUse: command.allowDiskUse === true };
    }
    return { kind: "command", command };
}

/** A value as a string literal of Extended JSON; the quoting of JSON suits all four languages. */
function literal(value: Json): string {
    return JSON.stringify(JSON.stringify(value));
}

function node(database: string, query: Query): string {
    const head = `const { MongoClient, EJSON } = require("mongodb");\n\nconst client = new MongoClient(uri);\nconst db = client.db(${JSON.stringify(database)});\n`;
    if (query.kind === "command") return `${head}const reply = await db.command(EJSON.parse(${literal(query.command)}));`;
    const collection = `db.collection(${JSON.stringify(query.collection)})`;
    if (query.kind === "aggregate") {
        const options = query.allowDiskUse ? ", { allowDiskUse: true }" : "";
        return `${head}const documents = await ${collection}\n    .aggregate(EJSON.parse(${literal(query.pipeline)})${options})\n    .toArray();`;
    }
    let call = `${collection}\n    .find(EJSON.parse(${literal(query.filter)}))`;
    if (query.projection) call += `\n    .project(EJSON.parse(${literal(query.projection)}))`;
    if (query.sort) call += `\n    .sort(EJSON.parse(${literal(query.sort)}))`;
    if (query.skip) call += `\n    .skip(${query.skip})`;
    if (query.limit) call += `\n    .limit(${query.limit})`;
    return `${head}const documents = await ${call}\n    .toArray();`;
}

function python(database: string, query: Query): string {
    const head = `from bson import json_util\nfrom pymongo import MongoClient\n\nclient = MongoClient(uri)\ndb = client[${JSON.stringify(database)}]\n`;
    if (query.kind === "command") return `${head}reply = db.command(json_util.loads(${literal(query.command)}))`;
    const collection = `db[${JSON.stringify(query.collection)}]`;
    if (query.kind === "aggregate") {
        const options = query.allowDiskUse ? ", allowDiskUse=True" : "";
        return `${head}documents = list(${collection}.aggregate(json_util.loads(${literal(query.pipeline)})${options}))`;
    }
    const projection = query.projection ? `, json_util.loads(${literal(query.projection)})` : "";
    let call = `${collection}.find(json_util.loads(${literal(query.filter)})${projection})`;
    // The order of the sort keys counts: a list of pairs keeps it.
    if (query.sort) call += `\n    .sort(list(json_util.loads(${literal(query.sort)}).items()))`;
    if (query.skip) call += `\n    .skip(${query.skip})`;
    if (query.limit) call += `\n    .limit(${query.limit})`;
    return `${head}documents = list(\n    ${call}\n)`;
}

function java(database: string, query: Query): string {
    const head = `MongoClient client = MongoClients.create(uri);\nMongoDatabase db = client.getDatabase(${JSON.stringify(database)});\n`;
    if (query.kind === "command") return `${head}Document reply = db.runCommand(Document.parse(${literal(query.command)}));`;
    const collection = `db.getCollection(${JSON.stringify(query.collection)})`;
    if (query.kind === "aggregate") {
        const stages = query.pipeline.map(stage => `        Document.parse(${literal(stage)})`).join(",\n");
        const options = query.allowDiskUse ? "\n    .allowDiskUse(true)" : "";
        return `${head}List<Document> documents = ${collection}\n    .aggregate(List.of(\n${stages}\n    ))${options}\n    .into(new ArrayList<>());`;
    }
    let call = `${collection}\n    .find(Document.parse(${literal(query.filter)}))`;
    if (query.projection) call += `\n    .projection(Document.parse(${literal(query.projection)}))`;
    if (query.sort) call += `\n    .sort(Document.parse(${literal(query.sort)}))`;
    if (query.skip) call += `\n    .skip(${query.skip})`;
    if (query.limit) call += `\n    .limit(${query.limit})`;
    return `${head}List<Document> documents = ${call}\n    .into(new ArrayList<>());`;
}

function csharp(database: string, query: Query): string {
    const head = `var client = new MongoClient(uri);\nvar db = client.GetDatabase(${JSON.stringify(database)});\n`;
    if (query.kind === "command") {
        return `${head}var reply = db.RunCommand<BsonDocument>(new BsonDocumentCommand<BsonDocument>(BsonDocument.Parse(${literal(query.command)})));`;
    }
    const collection = `db.GetCollection<BsonDocument>(${JSON.stringify(query.collection)})`;
    if (query.kind === "aggregate") {
        const stages = query.pipeline.map(stage => `    BsonDocument.Parse(${literal(stage)})`).join(",\n");
        const options = query.allowDiskUse ? ", new AggregateOptions { AllowDiskUse = true }" : "";
        return `${head}PipelineDefinition<BsonDocument, BsonDocument> pipeline = new[]\n{\n${stages}\n};\nvar documents = ${collection}.Aggregate(pipeline${options}).ToList();`;
    }
    let call = `${collection}\n    .Find(BsonDocument.Parse(${literal(query.filter)}))`;
    if (query.projection) call += `\n    .Project(BsonDocument.Parse(${literal(query.projection)}))`;
    if (query.sort) call += `\n    .Sort(BsonDocument.Parse(${literal(query.sort)}))`;
    if (query.skip) call += `\n    .Skip(${query.skip})`;
    if (query.limit) call += `\n    .Limit(${query.limit})`;
    return `${head}var documents = ${call}\n    .ToList();`;
}

/** The query of `plan` in `language`; the shell gets the statement as it was typed. */
export function queryCode(language: CodeLanguage, plan: Plan, statement: string): string {
    const query = queryOf(plan);
    switch (language) {
        case "shell": return statement;
        case "node": return node(plan.database, query);
        case "python": return python(plan.database, query);
        case "java": return java(plan.database, query);
        case "csharp": return csharp(plan.database, query);
    }
}
