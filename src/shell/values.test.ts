import { describe, expect, it } from "vitest";
import { suggest, valueDetail, valuePlace } from "./complete";
import type { Environment } from "./complete";
import type { Json } from "./ejson";
import {
    SEARCH_LIMIT, addToFilter, collectValues, combineSearches, filterField, filterPath, mergeValues, preferValues, searchCommand, searchHints, validatorValues, valueAtPath, valueCondition
} from "./values";
import type { ValueSearch, ValueSource } from "./values";

describe("collectValues", () => {
    it("counts the values of each field, the most frequent first", () => {
        const index = collectValues([
            { status: "open", n: 1, customer: { tier: "gold" } },
            { status: "done", n: 2, customer: { tier: "gold" } },
            { status: "open", tags: ["a", "b"], items: [{ sku: "x" }, { sku: "y" }] }
        ]);
        expect(index.get("status")).toEqual([{ value: "open", count: 2 }, { value: "done", count: 1 }]);
        expect(index.get("customer.tier")).toEqual([{ value: "gold", count: 2 }]);
        expect(index.get("tags")?.map(hint => hint.value)).toEqual(["a", "b"]);
        expect(index.get("items.sku")?.map(hint => hint.value)).toEqual(["x", "y"]);
        expect(index.get("n")?.map(hint => hint.value)).toEqual([1, 2]);
    });

    it("leaves out ids, dates, long texts and fields with too many values", () => {
        const many = Array.from({ length: 150 }, (_, index) => ({ name: `user ${index}` }));
        const index = collectValues([
            ...many,
            { _id: { $oid: "64b7f0c2a1b2c3d4e5f60718" }, at: { $date: { $numberLong: "0" } }, text: "x".repeat(200), n: { $numberLong: "5" } }
        ]);
        expect(index.has("_id")).toBe(false);
        expect(index.has("at")).toBe(false);
        expect(index.has("text")).toBe(false);
        expect(index.has("name")).toBe(false);
        expect(index.get("n")).toEqual([{ value: { $numberLong: "5" }, count: 1 }]);
    });
});

describe("mergeValues", () => {
    it("counts the values of all sources together", () => {
        const a: ValueSource = () => [{ value: "open", count: 1 }, { value: "done", count: 1 }];
        const b: ValueSource = field => (field === "orders" ? [{ value: "done", count: 3 }] : undefined);
        expect(mergeValues([a, b])("orders", "status")).toEqual([{ value: "done", count: 4 }, { value: "open", count: 1 }]);
    });
});

describe("filterField", () => {
    it("finds the field a value in a filter belongs to", () => {
        expect(filterField(["status"])).toBe("status");
        expect(filterField(["customer", "tier"])).toBe("customer.tier");
        expect(filterField(["status", "$in", "[]"])).toBe("status");
        expect(filterField(["status", "$ne"])).toBe("status");
        expect(filterField(["$or", "[]", "status"])).toBe("status");
        expect(filterField(["n", "$gt"])).toBeUndefined();
        expect(filterField(["$expr", "$eq", "[]"])).toBeUndefined();
    });
});

describe("filter by value", () => {
    it("adds the value to the filter, on one line", () => {
        expect(addToFilter("{ }", "status", "open")).toBe("{ status: \"open\" }");
        expect(addToFilter("", "customer.tier", "gold")).toBe("{ \"customer.tier\": \"gold\" }");
        expect(addToFilter("{ n: { $gt: 1 }, status: \"done\" }", "status", "open")).toBe("{ n: { $gt: 1 }, status: \"open\" }");
        expect(addToFilter("{}", "_id", { $oid: "64b7f0c2a1b2c3d4e5f60718" })).toBe("{ _id: ObjectId(\"64b7f0c2a1b2c3d4e5f60718\") }");
        expect(() => addToFilter("[1]", "a", 1)).toThrow();
    });

    it("takes the places in arrays out of a path", () => {
        expect(filterPath("items.0.sku")).toBe("items.sku");
        expect(filterPath("status")).toBe("status");
    });
});

describe("value suggestions", () => {
    const seen: Record<string, Json[]> = { "status": ["open", "open", "done"], "qty": [5], "customer.tier": ["gold"] };
    const environment: Environment = {
        databases: [],
        collections: ["orders"],
        fields: () => ["status", "qty", "customer.tier"],
        values: (collection, field) => (collection === "orders" ? collectValues((seen[field] ?? []).map(value => ({ [field]: value }))).get(field) : undefined)
    };
    // Values carry how often they were seen; the BSON helpers are values too, but without a count.
    const labels = (text: string) => suggest(text, environment)?.options
        .filter(option => typeof option.detail === "string" && option.detail.endsWith("×"))
        .map(option => option.label) ?? [];
    const option = (text: string, label: string) => suggest(text, environment)?.options.find(item => item.label === label);

    it("offers the values of the field in a filter", () => {
        expect(labels("db.orders.find({ status: ")).toEqual(expect.arrayContaining(["open", "done"]));
        expect(option("db.orders.find({ status: ", "open")).toMatchObject({ apply: "\"open\"", detail: "2×" });
        expect(option("db.orders.find({ status: \"o", "open")?.apply).toBe("open");
        expect(labels("db.orders.find({ status: { $in: [\"")).toEqual(["open", "done"]);
        expect(labels("db.orders.find({ $or: [{ status: \"")).toEqual(["open", "done"]);
        expect(labels("db.orders.find({ customer: { tier: \"")).toEqual(["gold"]);
        expect(labels("db.orders.find({ qty: ")).toContain("5");
        expect(labels("db.orders.find({ qty: \"")).toEqual([]);
    });

    it("offers them in $match, $set and to scripts, not where a value is no field", () => {
        expect(labels("db.orders.aggregate([{ $match: { status: \"")).toEqual(["open", "done"]);
        expect(labels("db.orders.updateMany({}, { $set: { status: \"")).toEqual(["open", "done"]);
        expect(labels("var c = db.orders;\nc.find({ status: \"")).toEqual(["open", "done"]);
        expect(labels("db.orders.find({}).sort({ status: ")).toEqual([]);
        expect(labels("db.orders.find({ qty: { $gt: ")).toEqual([]);
        expect(labels("db.orders.insertOne({ status: \"")).toEqual([]);
    });
});

describe("search of all data", () => {
    it("groups the values of the field, arrays taken apart, with a time limit", () => {
        expect(searchCommand("orders", "items.sku", "")).toEqual({
            aggregate: "orders",
            pipeline: [
                { $match: { "items.sku": { $exists: true } } },
                { $project: { _id: 0, v: "$items.sku" } },
                { $unwind: "$v" },
                { $group: { _id: "$v", n: { $sum: 1 } } },
                { $sort: { n: -1, _id: 1 } },
                { $limit: SEARCH_LIMIT + 1 }
            ],
            cursor: {},
            maxTimeMS: 2000
        });
    });

    it("searches for the typed text, escaped, and in a sample when asked to", () => {
        const command = searchCommand("orders", "status", "a.b(", true);
        const pipeline = command.pipeline as Json[];
        expect(pipeline[0]).toEqual({ $sample: { size: 5000 } });
        expect(pipeline[1]).toEqual({ $match: { status: { $regex: "^a\\.b\\(" } } });
        expect(pipeline[4]).toEqual({ $match: { v: { $regex: "^a\\.b\\(" } } });
        expect(new RegExp(String(((pipeline[1] as { $match: { status: { $regex: string } } }).$match.status.$regex))).test("a.b(c")).toBe(true);
    });

    it("reads what the server found", () => {
        const found = searchHints([{ _id: "open", n: { $numberInt: "7" } }, { _id: { $oid: "64b7f0c2a1b2c3d4e5f60718" }, n: 1 }, { _id: 3, n: 2 }]);
        expect(found).toEqual({ hints: [{ value: "open", count: 7 }, { value: 3, count: 2 }], truncated: false });
        expect(searchHints(Array.from({ length: SEARCH_LIMIT + 1 }, (_, index) => ({ _id: `v${index}`, n: 1 })))).toMatchObject({ truncated: true });
    });

    it("takes searches with different prefixes together, each value once", () => {
        const search = (hints: [Json, number][]): ValueSearch => ({ running: false, truncated: false, sampled: false, hints: hints.map(([value, count]) => ({ value, count })) });
        expect(combineSearches([search([["paid", 5], ["open", 9]]), search([["paid", 5]])])).toEqual([{ value: "open", count: 9 }, { value: "paid", count: 5 }]);
    });

    it("puts the server's values before those known otherwise", () => {
        const server: ValueSource = () => [{ value: "paid", count: 500 }];
        const sample: ValueSource = () => [{ value: "open", count: 3 }, { value: "paid", count: 1 }];
        expect(preferValues(server, sample)("orders", "status")).toEqual([{ value: "paid", count: 500 }, { value: "open", count: 3 }]);
    });

    it("knows where a search fits", () => {
        expect(valuePlace("db.orders.find({ status: \"pa")).toEqual({ collection: "orders", field: "status", prefix: "pa", inString: true });
        expect(valuePlace("db.orders.find({ status: ")).toEqual({ collection: "orders", field: "status", prefix: "", inString: false });
        expect(valuePlace("db.getCollection(\"order-items\").aggregate([{ $match: { sku: \"")).toMatchObject({ collection: "order-items", field: "sku" });
        expect(valuePlace("db.orders.find({ sta")).toBeUndefined();
        expect(valuePlace("db.orders.find({}).sort({ status: ")).toBeUndefined();
        expect(valuePlace("db.getCollection(\"\").find({ status: \"")).toBeUndefined();
    });
});

describe("validatorValues", () => {
    it("reads enum of a JSON schema, also nested, in arrays and alternatives", () => {
        const index = validatorValues({
            $jsonSchema: {
                bsonType: "object",
                properties: {
                    status: { enum: ["new", "paid", "shipped"] },
                    address: { properties: { country: { anyOf: [{ enum: ["DE", "AT"] }, { enum: ["CH", "DE"] }] } } },
                    tags: { bsonType: "array", items: { enum: ["a", "b"] } },
                    note: { bsonType: "string" }
                }
            }
        });
        expect(index.get("status")?.map(hint => hint.value)).toEqual(["new", "paid", "shipped"]);
        expect(index.get("address.country")?.map(hint => hint.value)).toEqual(["DE", "AT", "CH"]);
        expect(index.get("tags")?.map(hint => hint.value)).toEqual(["a", "b"]);
        expect(index.has("note")).toBe(false);
        expect(index.get("status")?.[0]).toEqual({ value: "new", count: 0, allowed: true });
    });

    it("reads $in and $eq of a validator written as a query", () => {
        const index = validatorValues({ $and: [{ kind: { $in: ["x", "y"] } }, { $or: [{ level: { $eq: 3 } }] }], $jsonSchema: { properties: { s: { enum: [true] } } } });
        expect(index.get("kind")?.map(hint => hint.value)).toEqual(["x", "y"]);
        expect(index.get("level")?.map(hint => hint.value)).toEqual([3]);
        expect(index.get("s")?.map(hint => hint.value)).toEqual([true]);
        expect(validatorValues(undefined).size).toBe(0);
    });
});

describe("valueCondition", () => {
    it("is the value, $in, $ne or $nin, each value once", () => {
        expect(valueCondition(["a"])).toBe("a");
        expect(valueCondition(["a", "b", "a"])).toEqual({ $in: ["a", "b"] });
        expect(valueCondition(["a", "a"], true)).toEqual({ $ne: "a" });
        expect(valueCondition([1, 2], true)).toEqual({ $nin: [1, 2] });
    });

    it("reads the value at a path of a result", () => {
        const document = { items: [{ name: "x" }, { name: "y" }], at: { $date: "2024-01-01T00:00:00Z" } };
        expect(valueAtPath(document, "items.1.name")).toBe("y");
        expect(valueAtPath(document, "at")).toEqual({ $date: "2024-01-01T00:00:00Z" });
        expect(valueAtPath(document, "at.$date")).toBeUndefined();
        expect(valueAtPath(document, "missing.x")).toBeUndefined();
    });
});

describe("valueDetail", () => {
    it("says how often a value was seen and marks what the validator allows", () => {
        expect(valueDetail({ value: "open", count: 12 })).toBe("12×");
        expect(valueDetail({ value: "open", count: 3, allowed: true })).toBe("✓ 3×");
        expect(valueDetail({ value: "refunded", count: 0, allowed: true })).toBe("✓");
    });
});
