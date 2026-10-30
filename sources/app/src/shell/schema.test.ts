import { describe, expect, it } from "vitest";
import type { Json } from "./ejson";
import { analyze, filterOf, gaps, mainType, mixedTypes, sampleCommand, typeFilter, unique, validatorOf } from "./schema";

const documents: Json[] = [
    { _id: { $oid: "64b7f0c2a1b2c3d4e5f60701" }, status: "open", total: 10, at: { $date: "2024-05-01T00:00:00Z" }, customer: { name: "A", vip: true }, items: [{ sku: "x" }, { sku: "y" }], note: null },
    { _id: { $oid: "64b7f0c2a1b2c3d4e5f60702" }, status: "paid", total: 20.5, at: { $date: "2024-05-03T00:00:00Z" }, customer: { name: "B", vip: false }, items: [{ sku: "x" }] },
    { _id: { $oid: "64b7f0c2a1b2c3d4e5f60703" }, status: "open", total: "30", at: { $date: "2024-05-05T00:00:00Z" }, customer: { name: "C", vip: false }, items: [], note: "late" }
];

describe("analyze", () => {
    const schema = analyze(documents);
    const of = (path: string) => schema.fields.find(field => field.path === path)!;

    it("counts types, values and gaps per field, also in sub documents and arrays", () => {
        expect(schema.sampled).toBe(3);
        expect(of("status").values).toEqual([{ value: "open", count: 2 }, { value: "paid", count: 1 }]);
        expect(of("total").types).toEqual([{ type: "int", count: 1 }, { type: "double", count: 1 }, { type: "string", count: 1 }]);
        expect(mixedTypes(of("total"))).toBe(true);
        expect(mainType(of("note"))).toBe("string");
        expect(gaps(of("note"), 3)).toBe(2);
        expect(of("customer.vip")).toMatchObject({ depth: 1, present: 3 });
        expect(of("customer").children).toEqual(["customer.name", "customer.vip"]);
        // A field in the documents of an array counts once per document.
        expect(of("items.sku")).toMatchObject({ present: 2, values: [{ value: "x", count: 2 }, { value: "y", count: 1 }] });
        expect(of("items").lengths).toEqual([{ value: 0, count: 1 }, { value: 1, count: 1 }, { value: 2, count: 1 }]);
        // Three different names are no key yet; twelve are.
        expect(unique(of("customer.name"))).toBe(false);
        expect(unique(analyze(Array.from({ length: 12 }, (_, index) => ({ code: `c${index}` }))).fields[0]!)).toBe(true);
    });

    it("puts numbers and dates into ten classes", () => {
        const total = of("total").numbers!;
        expect(total).toHaveLength(10);
        expect(total[0]).toMatchObject({ from: 10, count: 1 });
        expect(total.at(-1)).toMatchObject({ to: 20.5, count: 1 });
        expect(of("at").dates!.reduce((sum, bin) => sum + bin.count, 0)).toBe(3);
    });

    it("stops counting values past 100 different ones", () => {
        const many = analyze(Array.from({ length: 150 }, (_, index) => ({ code: `c${index}` })));
        expect(many.fields[0]).toMatchObject({ values: undefined, distinct: 101 });
    });
});

describe("validatorOf", () => {
    it("proposes types, required fields and enums of few strings", () => {
        const validator = validatorOf(analyze(documents)) as { $jsonSchema: { required: string[]; properties: Record<string, Record<string, unknown>> } };
        const schema = validator.$jsonSchema;
        expect(schema.required).toEqual(["_id", "status", "total", "at", "customer", "items"]);
        expect(schema.properties.status).toEqual({ bsonType: "string", enum: ["open", "paid"] });
        expect(schema.properties.total!.bsonType).toEqual(["int", "double", "string"]);
        expect(schema.properties.customer).toMatchObject({ bsonType: "object", required: ["name", "vip"], properties: { vip: { bsonType: "bool" } } });
        expect(schema.properties.note!.bsonType).toEqual(["null", "string"]);
    });
});

describe("filters from the charts", () => {
    it("takes a value, several values, a class, and fields together", () => {
        expect(filterOf([{ field: "status", value: "open" }])).toEqual({ status: "open" });
        expect(filterOf([{ field: "status", value: "open" }, { field: "status", value: "paid" }])).toEqual({ status: { $in: ["open", "paid"] } });
        expect(filterOf([{ field: "total", range: { from: 10, to: 20, count: 3 }, last: false, date: false }])).toEqual({ total: { $gte: 10, $lt: 20 } });
        expect(filterOf([{ field: "at", range: { from: 0, to: 86400000, count: 1 }, last: true, date: true }]))
            .toEqual({ at: { $gte: { $date: "1970-01-01T00:00:00.000Z" }, $lte: { $date: "1970-01-02T00:00:00.000Z" } } });
        expect(filterOf([{ field: "status", value: "open" }, { field: "vip", value: true }])).toEqual({ $and: [{ status: "open" }, { vip: true }] });
        expect(filterOf([])).toEqual({});
        expect(typeFilter("total", "string")).toEqual({ total: { $type: "string" } });
        expect(sampleCommand("orders", 0)).toEqual({ aggregate: "orders", pipeline: [], cursor: {}, maxTimeMS: 5000 });
    });
});
