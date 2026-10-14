import { describe, expect, it } from "vitest";
import { suggest } from "./complete";
import type { Environment } from "./complete";
import type { Json } from "./ejson";
import { addToFilter, collectValues, filterField, filterPath, mergeValues } from "./values";
import type { ValueSource } from "./values";

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
