import { describe, expect, it } from "vitest";
import { queryCode } from "./code";
import { parseStatements } from "./parse";
import { planStatement } from "./plan";

function plan(source: string) {
    return planStatement(parseStatements(source)[0]!, "shop");
}

const FIND = "db.orders.find({ _id: ObjectId(\"64b7f0c2a1b2c3d4e5f60718\") }, { total: 1 }).sort({ at: -1, total: 1 }).skip(10).limit(5)";

describe("queryCode", () => {
    it("keeps the statement for the shell", () => {
        expect(queryCode("shell", plan(FIND), FIND)).toBe(FIND);
    });

    it("writes a find with its options for Node.js, with the types as Extended JSON", () => {
        expect(queryCode("node", plan(FIND), FIND)).toBe([
            "const { MongoClient, EJSON } = require(\"mongodb\");",
            "",
            "const client = new MongoClient(uri);",
            "const db = client.db(\"shop\");",
            "const documents = await db.collection(\"orders\")",
            "    .find(EJSON.parse(\"{\\\"_id\\\":{\\\"$oid\\\":\\\"64b7f0c2a1b2c3d4e5f60718\\\"}}\"))",
            "    .project(EJSON.parse(\"{\\\"total\\\":1}\"))",
            "    .sort(EJSON.parse(\"{\\\"at\\\":-1,\\\"total\\\":1}\"))",
            "    .skip(10)",
            "    .limit(5)",
            "    .toArray();"
        ].join("\n"));
    });

    it("keeps the order of the sort keys in Python", () => {
        expect(queryCode("python", plan(FIND), FIND)).toContain(".sort(list(json_util.loads(\"{\\\"at\\\":-1,\\\"total\\\":1}\").items()))");
    });

    it("writes a pipeline stage by stage for Java and C#", () => {
        const source = "db.orders.aggregate([{ $match: { status: \"open\" } }, { $count: \"n\" }], { allowDiskUse: true })";
        const javaCode = queryCode("java", plan(source), source);
        expect(javaCode).toContain("Document.parse(\"{\\\"$match\\\":{\\\"status\\\":\\\"open\\\"}}\"),");
        expect(javaCode).toContain(".allowDiskUse(true)");
        const csharpCode = queryCode("csharp", plan(source), source);
        expect(csharpCode).toContain("BsonDocument.Parse(\"{\\\"$count\\\":\\\"n\\\"}\")");
        expect(csharpCode).toContain("new AggregateOptions { AllowDiskUse = true }");
    });

    it("sends anything else as a command", () => {
        const source = "db.orders.find({}).collation({ locale: \"de\" })";
        expect(queryCode("node", plan(source), source)).toContain("db.command(EJSON.parse(");
        expect(queryCode("python", plan("db.runCommand({ ping: 1 })"), "")).toContain("db.command(json_util.loads(\"{\\\"ping\\\":1}\"))");
    });
});
