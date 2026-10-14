import { describe, expect, it } from "vitest";
import { scriptPlace, suggest } from "./complete";
import type { Environment } from "./complete";
import { preview, toShell } from "./ejson";
import { ShellError } from "./message";
import { parseStatements, statementAt } from "./parse";
import { pageCommand, planStatement, replyError } from "./plan";

function plan(source: string, database = "shop") {
    return planStatement(parseStatements(source)[0]!, database);
}

describe("parseStatements", () => {
    it("reads collection, method, arguments and what is chained", () => {
        const [statement] = parseStatements("db.orders.find({ status: 'open' }).sort({ at: -1 }).limit(5)");
        expect(statement).toMatchObject({
            collection: "orders",
            method: "find",
            args: [{ status: "open" }],
            modifiers: [{ name: "sort", args: [{ at: -1 }] }, { name: "limit", args: [5] }]
        });
    });

    it("takes collections by name, in brackets, with dots, and other databases", () => {
        expect(parseStatements("db.getCollection('my-coll').findOne()")[0]).toMatchObject({ collection: "my-coll", method: "findOne" });
        expect(parseStatements("db['a b'].drop()")[0]).toMatchObject({ collection: "a b", method: "drop" });
        expect(parseStatements("db.system.profile.find()")[0]).toMatchObject({ collection: "system.profile", method: "find" });
        expect(parseStatements("db.getSiblingDB('logs').events.countDocuments()")[0]).toMatchObject({ database: "logs", collection: "events" });
        const [stats] = parseStatements("db.stats()");
        expect(stats!.method).toBe("stats");
        expect(stats!.collection).toBeUndefined();
    });

    it("turns BSON helpers into extended JSON", () => {
        const [statement] = parseStatements(`db.c.find({
            _id: ObjectId("64B7F0C2A1B2C3D4E5F60718"),
            at: { $gte: ISODate("2024-05-01"), $lt: new Date(86400000) },
            n: NumberLong("9007199254740993"),
            price: NumberDecimal("9.99"),
            name: /^a/i,
            day: 24 * 60 * 60,
            neg: -1,
            id: UUID("00112233-4455-6677-8899-aabbccddeeff")
        })`);
        expect(statement!.args[0]).toEqual({
            _id: { $oid: "64b7f0c2a1b2c3d4e5f60718" },
            at: { $gte: { $date: { $numberLong: "1714521600000" } }, $lt: { $date: { $numberLong: "86400000" } } },
            n: { $numberLong: "9007199254740993" },
            price: { $numberDecimal: "9.99" },
            name: { $regularExpression: { pattern: "^a", options: "i" } },
            day: 86400,
            neg: -1,
            id: { $binary: { base64: "ABEiM0RVZneImaq7zN3u/w==", subType: "04" } }
        });
    });

    it("does not run code", () => {
        expect(() => parseStatements("db.c.find({ a: process.exit() })")).toThrow(ShellError);
        expect(() => parseStatements("db.c.find({ a: (() => 1)() })")).toThrow(ShellError);
        expect(() => parseStatements("fetch('http://example.com')")).toThrow("error.shell.start");
        expect(() => parseStatements("db.c.find({ a: x })")).toThrow("error.shell.undefined");
    });

    it("reports syntax errors with their place", () => {
        expect(() => parseStatements("db.c.find({ a: })")).toThrow(ShellError);
        try {
            parseStatements("db.c.find({ a: })");
        } catch (error) {
            expect((error as ShellError).position).toBe(15);
        }
    });

    it("finds the statement at the cursor", () => {
        const source = "db.a.find()\n\ndb.b.find();\ndb.c.find()";
        const statements = parseStatements(source);
        expect(statementAt(statements, 3)?.collection).toBe("a");
        expect(statementAt(statements, 12)?.collection).toBe("a");
        expect(statementAt(statements, source.indexOf("db.b") + 2)?.collection).toBe("b");
        expect(statementAt(statements, source.length)?.collection).toBe("c");
    });
});

describe("planStatement", () => {
    it("writes find with its cursor methods as one command", () => {
        expect(plan("db.orders.find({ a: 1 }, { b: 1 }).sort({ z: 1, a: -1 }).skip(10).limit(5).hint('a_1')")).toMatchObject({
            database: "shop",
            cursor: true,
            paging: "find",
            command: { find: "orders", filter: { a: 1 }, projection: { b: 1 }, sort: { z: 1, a: -1 }, skip: 10, limit: 5, hint: "a_1" }
        });
        expect(Object.keys(plan("db.orders.find()").command)[0]).toBe("find");
    });

    it("pages find within the statement's own skip and limit", () => {
        const find = plan("db.orders.find().skip(10).limit(120)");
        expect(pageCommand(find, 0, 50)).toMatchObject({ skip: 10, limit: 120, batchSize: 51 });
        expect(pageCommand(find, 100, 50)).toMatchObject({ skip: 110, limit: 20, batchSize: 20 });
        expect(pageCommand(find, 150, 50)).toBeUndefined();
        expect(pageCommand(plan("db.orders.find()"), 0, 50)).toEqual({ find: "orders", filter: {}, batchSize: 51 });
    });

    it("pages aggregate, but not a pipeline that writes", () => {
        const aggregate = plan("db.orders.aggregate([{ $match: { a: 1 } }], { allowDiskUse: true })");
        expect(pageCommand(aggregate, 50, 50)).toEqual({
            aggregate: "orders",
            pipeline: [{ $match: { a: 1 } }, { $skip: 50 }],
            cursor: { batchSize: 51 },
            allowDiskUse: true
        });
        const writes = plan("db.orders.aggregate([{ $out: 'copy' }])");
        expect(pageCommand(writes, 0, 50)).toEqual(writes.command);
        expect(pageCommand(writes, 50, 50)).toBeUndefined();
    });

    it("counts with an aggregation, as drivers do", () => {
        const count = plan("db.orders.countDocuments({ a: 1 }, { limit: 10 })");
        expect(count.command.pipeline).toEqual([{ $match: { a: 1 } }, { $limit: 10 }, { $group: { _id: 1, n: { $sum: 1 } } }]);
        expect(count.shape!([{ _id: 1, n: { $numberInt: "7" } }])).toEqual({ $numberInt: "7" });
        expect(count.shape!([])).toBe(0);
    });

    it("splits update options between the statement and the command", () => {
        const update = plan("db.orders.updateMany({ a: 1 }, { $set: { b: 2 } }, { upsert: true, arrayFilters: [{ 'x.y': 1 }], let: { v: 1 } })");
        expect(update.command).toEqual({
            update: "orders",
            updates: [{ q: { a: 1 }, u: { $set: { b: 2 } }, multi: true, upsert: true, arrayFilters: [{ "x.y": 1 }] }],
            let: { v: 1 }
        });
        expect(update.shape!({ n: 3, nModified: 2, ok: 1 })).toEqual({ acknowledged: true, matchedCount: 3, modifiedCount: 2, upsertedCount: 0, upsertedId: null });
    });

    it("gives inserted documents an _id and reports it", () => {
        const insert = plan("db.orders.insertOne({ a: 1 })");
        const [document] = insert.command.documents as [{ _id: { $oid: string }; a: number }];
        expect(document._id.$oid).toMatch(/^[0-9a-f]{24}$/);
        expect(Object.keys(document)).toEqual(["_id", "a"]);
        expect(insert.shape!({ n: 1, ok: 1 })).toEqual({ acknowledged: true, insertedId: document._id });
    });

    it("maps the other writes", () => {
        expect(plan("db.orders.deleteOne({ a: 1 })").command).toEqual({ delete: "orders", deletes: [{ q: { a: 1 }, limit: 1 }] });
        expect(plan("db.orders.deleteMany({})").command).toEqual({ delete: "orders", deletes: [{ q: {}, limit: 0 }] });
        expect(plan("db.orders.findOneAndUpdate({ a: 1 }, { $inc: { n: 1 } }, { returnDocument: 'after', projection: { n: 1 } })").command).toEqual({
            findAndModify: "orders",
            query: { a: 1 },
            update: { $inc: { n: 1 } },
            new: true,
            fields: { n: 1 }
        });
        expect(plan("db.orders.createIndex({ a: 1, b: -1 }, { unique: true })").command).toEqual({
            createIndexes: "orders",
            indexes: [{ key: { a: 1, b: -1 }, name: "a_1_b_-1", unique: true }]
        });
        expect(plan("db.orders.renameCollection('old')")).toMatchObject({ database: "admin", command: { renameCollection: "shop.orders", to: "shop.old" } });
    });

    it("explains in both notations", () => {
        const expected = { explain: { find: "orders", filter: { a: 1 } }, verbosity: "executionStats" };
        expect(plan("db.orders.find({ a: 1 }).explain('executionStats')").command).toEqual(expected);
        expect(plan("db.orders.explain('executionStats').find({ a: 1 })").command).toEqual(expected);
        expect(plan("db.orders.aggregate([]).explain()").command).toEqual({ explain: { aggregate: "orders", pipeline: [], cursor: {} }, verbosity: "queryPlanner" });
    });

    it("knows the search index helpers of new servers", () => {
        expect(plan("db.docs.createSearchIndex('vec', 'vectorSearch', { fields: [] })").command).toEqual({
            createSearchIndexes: "docs",
            indexes: [{ name: "vec", type: "vectorSearch", definition: { fields: [] } }]
        });
        expect(plan("db.docs.getSearchIndexes()").command.pipeline).toEqual([{ $listSearchIndexes: {} }]);
    });

    it("runs database methods and other databases", () => {
        expect(plan("db.runCommand({ ping: 1 })")).toMatchObject({ database: "shop", command: { ping: 1 }, cursor: false });
        expect(plan("db.adminCommand('listDatabases')")).toMatchObject({ database: "admin", command: { listDatabases: 1 } });
        expect(plan("db.getSiblingDB('logs').events.find()")).toMatchObject({ database: "logs", command: { find: "events" } });
        expect(() => plan("db.orders.find()", "")).toThrow("error.plan.database");
        expect(() => plan("db.orders.nope()")).toThrow("error.plan.collectionMethod");
        expect(() => plan("db.orders.insertOne({}).limit(1)")).toThrow("error.plan.modifier");
    });

    it("finds failed writes in replies that are ok", () => {
        expect(replyError({ ok: 1, n: 0, writeErrors: [{ index: 0, code: 11000, errmsg: "E11000 duplicate key" }] })).toBe("E11000 duplicate key");
        expect(replyError({ ok: 1, n: 1 })).toBeUndefined();
    });
});

describe("suggest", () => {
    const environment: Environment = {
        serverVersion: "6.0.12",
        databases: ["shop", "logs"],
        collections: ["orders", "order-items"],
        fields: collection => (collection === "orders" ? ["_id", "status", "customer.name", "items"] : [])
    };
    const labels = (text: string, env = environment) => suggest(text, env)?.options.map(option => option.label) ?? [];
    const option = (text: string, label: string, env = environment) => suggest(text, env)?.options.find(item => item.label === label);

    it("offers collections and database methods behind db.", () => {
        expect(labels("db.")).toEqual(expect.arrayContaining(["orders", "order-items", "runCommand", "getCollection"]));
        expect(option("db.", "order-items")?.apply).toBe("getCollection(\"order-items\")");
        expect(suggest("db.ord", environment)?.from).toBe(3);
    });

    it("offers methods behind a collection, also on later lines", () => {
        expect(labels("db.orders.")).toEqual(expect.arrayContaining(["find", "aggregate", "countDocuments", "createSearchIndex"]));
        expect(labels("db.getCollection(\"order-items\").")).toContain("findOneAndUpdate");
        expect(labels("db.a.find({})\ndb.orders.fi")).toContain("find");
        expect(option("db.orders.", "count")?.detail).toEqual({ key: "complete.deprecated" });
    });

    it("offers cursor methods behind find and aggregate", () => {
        expect(labels("db.orders.find({ a: 1 }).")).toEqual(expect.arrayContaining(["sort", "limit", "explain"]));
        expect(labels("db.orders.find({ a: 1 }).")).not.toContain("find");
        expect(labels("db.orders.aggregate([]).")).toContain("allowDiskUse");
        expect(labels("db.orders.explain().")).toContain("aggregate");
    });

    it("offers fields and query operators in a filter", () => {
        expect(labels("db.orders.find({ ")).toEqual(expect.arrayContaining(["status", "customer.name", "$or", "$expr"]));
        expect(labels("db.orders.find({ ")).not.toContain("$gt");
        expect(option("db.orders.find({ ", "customer.name")?.apply).toBe("\"customer.name\": ");
        expect(labels("db.orders.find({ status: { $")).toEqual(expect.arrayContaining(["$in", "$gte", "$exists"]));
        expect(labels("db.orders.find({ $or: [{ sta")).toContain("status");
        expect(option("db.orders.find({ \"cust", "customer.name")?.apply).toBe("customer.name");
    });

    it("offers stages in a pipeline, with what they need", () => {
        expect(labels("db.orders.aggregate([{ $")).toEqual(expect.arrayContaining(["$match", "$group", "$vectorSearch", "$rankFusion"]));
        expect(option("db.orders.aggregate([{ $", "$densify")?.detail).toBe("5.1+");
        expect(option("db.orders.aggregate([{ $", "$rankFusion")?.detail).toEqual({ key: "complete.needs", params: { version: "8.1" } });
        expect(option("db.orders.aggregate([{ $", "$rankFusion", { ...environment, serverVersion: "8.2.0" })?.detail).toBe("8.1+");
        expect(option("db.orders.aggregate([{ $", "$lookup")?.snippet).toContain("${1:collection}");
        expect(labels("db.orders.aggregate([{ $match: { a: 1 } }, { ")).toContain("$sort");
    });

    it("knows what belongs inside the stages", () => {
        expect(labels("db.orders.aggregate([{ $match: { ")).toEqual(expect.arrayContaining(["status", "$and"]));
        expect(labels("db.orders.aggregate([{ $group: { _id: \"$status\", total: { $")).toEqual(expect.arrayContaining(["$sum", "$percentile", "$topN"]));
        expect(labels("db.orders.aggregate([{ $project: { total: { $")).toEqual(expect.arrayContaining(["$dateDiff", "$cond", "$bitAnd"]));
        expect(labels("db.orders.aggregate([{ $lookup: { ")).toEqual(["from", "localField", "foreignField", "let", "pipeline", "as"]);
        expect(labels("db.orders.aggregate([{ $lookup: { from: \"x\", pipeline: [{ $")).toContain("$match");
        expect(labels("db.orders.aggregate([{ $facet: { byStatus: [{ $")).toContain("$sortByCount");
        expect(labels("db.orders.aggregate([{ $setWindowFields: { output: { rank: { $")).toEqual(expect.arrayContaining(["$denseRank", "$sum"]));
        expect(labels("db.orders.aggregate([{ $vectorSearch: { ")).toContain("numCandidates");
    });

    it("offers update operators, then fields", () => {
        expect(labels("db.orders.updateOne({ _id: 1 }, { $")).toEqual(expect.arrayContaining(["$set", "$inc", "$push"]));
        expect(labels("db.orders.updateOne({ _id: 1 }, { $set: { ")).toContain("status");
        expect(labels("db.orders.updateOne({ _id: 1 }, [{ $")).toEqual(["$project", "$addFields", "$set", "$unset", "$replaceRoot", "$replaceWith"]);
        expect(labels("db.orders.updateOne({}, {}, { ")).toContain("arrayFilters");
    });

    it("completes inside strings", () => {
        expect(labels("db.getCollection(\"or")).toEqual(["orders", "order-items"]);
        expect(labels("db.getSiblingDB(\"")).toEqual(["shop", "logs"]);
        expect(labels("db.orders.aggregate([{ $group: { _id: \"$sta")).toContain("$status");
        expect(labels("db.orders.aggregate([{ $project: { now: \"$$")).toContain("$$NOW");
        expect(labels("db.orders.aggregate([{ $lookup: { from: \"")).toContain("order-items");
        expect(labels("db.orders.distinct(\"")).toContain("customer.name");
        expect(labels("db.orders.find({ a: { $type: \"")).toContain("objectId");
    });

    it("offers BSON helpers as values and fields in sort", () => {
        expect(labels("db.orders.find({ _id: Obj")).toContain("ObjectId");
        expect(labels("db.orders.find({}).sort({ ")).toContain("status");
        expect(labels("db.orders.find({}, {}, { ")).toContain("collation");
    });

    it("is not confused by strings, comments and regular expressions", () => {
        expect(labels("db.orders.find({ a: \"}) { [\", b: /[{(]/, // })\n ")).toContain("status");
        expect(labels("/* db.x.find({ */ db.orders.")).toContain("find");
    });

    it("reads blocks of a script as statements, not documents", () => {
        expect(labels("db.orders.find().forEach(function (o) {\n    db.")).toContain("orders");
        expect(labels("if (x > 1) {\n    db.orders.")).toContain("find");
        expect(labels("for (var i = 0; i < 3; i++) {\n    var a = 1; db.orders.find({ sta")).toContain("status");
        expect(labels("[1, 2].forEach(n => {\n    db.orders.updateOne({ _id: n }, { $")).toContain("$set");
        expect(labels("function f() { return 1; }\ndb.orders.")).toContain("find");
        expect(labels("var q = { sta")).toEqual([]);
    });

    it("knows variables that hold a collection or a cursor", () => {
        expect(labels("var c = db.orders;\nc.")).toContain("find");
        expect(labels("const c = db.getCollection(\"order-items\")\nc.")).toContain("updateMany");
        expect(labels("var cur = db.orders.find({});\ncur.")).toEqual(expect.arrayContaining(["sort", "forEach", "hasNext"]));
        expect(labels("let c = db.orders;\nc.find({ sta")).toContain("status");
        expect(labels("var c = db.orders;\nc = 5;\nc.")).toEqual([]);
        expect(labels("var c = db.orders, n = 1;\nn.")).toEqual([]);
    });

    it("offers the fields of the documents a script reads", () => {
        expect(labels("db.orders.find().forEach(function (o) {\n    o.")).toEqual(["_id", "status", "customer", "items"]);
        expect(labels("db.orders.find().forEach(function (o) { print(o.customer.")).toEqual(["name"]);
        expect(labels("db.orders.find({}).map(o => o.")).toContain("status");
        expect(labels("db.orders.find().forEach((o) => { o.")).toContain("status");
        expect(labels("for (const o of db.orders.find()) {\n    o.")).toContain("status");
        expect(labels("var o = db.orders.findOne();\no.")).toContain("status");
        expect(labels("var c = db.orders.find();\nwhile (c.hasNext()) { var o = c.next(); o.")).toContain("status");
    });

    it("offers what a script has besides db", () => {
        expect(labels("pr")).toEqual(expect.arrayContaining(["db", "print", "printjson", "ObjectId"]));
        expect(suggest("pr", environment)?.auto).toBe(true);
        expect(option("", "print")?.snippet).toBe("print(${1:})");
        expect(labels("console.")).toEqual(["log", "error", "warn"]);
        expect(labels("db.orders.find({ a: pr")).not.toContain("print");
    });

    it("tells where JavaScript completes by itself", () => {
        expect(scriptPlace("var total = 0;\nto")).toBe("statement");
        expect(scriptPlace("print(to")).toBe("value");
        expect(scriptPlace("db.orders.find({ to")).toBeUndefined();
        expect(scriptPlace("db.orders.")).toBeUndefined();
        expect(scriptPlace("print(\"to")).toBeUndefined();
    });
});

describe("toShell", () => {
    it("writes values as the shell does", () => {
        const value = { "_id": { $oid: "64b7f0c2a1b2c3d4e5f60718" }, "n": { $numberLong: "5" }, "d": { $numberDouble: "2" }, "a-b": [{ $date: { $numberLong: "0" } }], "e": {} };
        expect(toShell(value)).toBe([
            "{",
            "    _id: ObjectId(\"64b7f0c2a1b2c3d4e5f60718\"),",
            "    n: NumberLong(5),",
            "    d: 2.0,",
            "    \"a-b\": [",
            "        ISODate(\"1970-01-01T00:00:00.000Z\")",
            "    ],",
            "    e: {}",
            "}"
        ].join("\n"));
        expect(preview({ a: { $numberInt: "1" }, b: ["x"] })).toBe("{ a: 1, b: [ \"x\" ] }");
    });
});
