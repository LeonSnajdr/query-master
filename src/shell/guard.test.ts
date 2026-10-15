import { describe, expect, it } from "vitest";
import { changesOf, countCommand, needsConfirm, needsName, scriptWrites, touched, writeInfo } from "./guard";

describe("writeInfo", () => {
    it("reads updates, deletes, inserts and drops", () => {
        const many = writeInfo({ update: "orders", updates: [{ q: { status: "open" }, u: { $set: { status: "x" } }, multi: true }] });
        expect(many).toMatchObject({ command: "update", collection: "orders", filter: { status: "open" }, many: true, dropping: false });
        expect(writeInfo({ update: "orders", updates: [{ q: {}, u: {}, multi: false }] }).many).toBe(false);
        expect(writeInfo({ delete: "orders", deletes: [{ q: { a: 1 }, limit: 0 }] }).many).toBe(true);
        expect(writeInfo({ delete: "orders", deletes: [{ q: { a: 1 }, limit: 1 }] }).many).toBe(false);
        expect(writeInfo({ insert: "orders", documents: [{}, {}] })).toMatchObject({ many: true, inserted: 2 });
        expect(writeInfo({ drop: "orders" })).toMatchObject({ collection: "orders", dropping: true });
        expect(writeInfo({ dropDatabase: 1 })).toEqual({ command: "dropDatabase", many: true, dropping: true });
        expect(writeInfo({ createIndexes: "orders", indexes: [] })).toMatchObject({ many: false, dropping: false });
    });
});

describe("needsConfirm", () => {
    const one = writeInfo({ update: "o", updates: [{ q: {}, u: {}, multi: false }] });
    const many = writeInfo({ update: "o", updates: [{ q: {}, u: {}, multi: true }] });
    const drop = writeInfo({ drop: "o" });

    it("never asks without an environment or in development", () => {
        for (const environment of [undefined, null, "development"] as const) {
            expect(needsConfirm(environment, many, 500)).toBe(false);
            expect(needsName(environment, drop, 500)).toBe(false);
        }
    });

    it("asks on test for several documents and drops only", () => {
        expect(needsConfirm("test", one, 1)).toBe(false);
        expect(needsConfirm("test", one, 2)).toBe(true);
        expect(needsConfirm("test", many, 0)).toBe(true);
        expect(needsConfirm("test", drop)).toBe(true);
    });

    it("always asks on production; the name is typed from 100 documents and to drop", () => {
        expect(needsConfirm("production", one, 1)).toBe(true);
        expect(needsName("production", one, 99)).toBe(false);
        expect(needsName("production", many, 100)).toBe(true);
        expect(needsName("production", drop)).toBe(true);
    });
});

describe("counting", () => {
    it("counts with the filter and a time limit; updateOne touches at most one", () => {
        const info = writeInfo({ delete: "orders", deletes: [{ q: { a: 1 }, limit: 1 }] });
        expect(countCommand(info)).toEqual({ aggregate: "orders", pipeline: [{ $match: { a: 1 } }, { $count: "n" }], cursor: {}, maxTimeMS: 2000 });
        expect(touched(info, 7)).toBe(1);
        expect(touched(writeInfo({ delete: "orders", deletes: [{ q: {}, limit: 0 }] }), 7)).toBe(7);
        expect(countCommand(writeInfo({ drop: "orders" }))).toBeUndefined();
    });
});

describe("changesOf", () => {
    const document = { _id: 1, status: "open", total: 10, address: { city: "Bonn" } };

    it("shows $set, $unset, $inc and $rename before and after", () => {
        expect(changesOf(document, { $set: { "status": "paid", "address.city": "Köln" }, $inc: { total: 5 }, $unset: { note: "" } })).toEqual([
            { field: "status", before: "\"open\"", after: "\"paid\"" },
            { field: "address.city", before: "\"Bonn\"", after: "\"Köln\"" },
            { field: "total", before: "10", after: "15" },
            { field: "note", before: "–", after: "–" }
        ]);
        expect(changesOf(document, { $rename: { status: "state" } })).toEqual([
            { field: "status", before: "\"open\"", after: "–" },
            { field: "state", before: "–", after: "\"open\"" }
        ]);
    });

    it("compares a replacement field by field and leaves unknown operators without after", () => {
        expect(changesOf(document, { status: "paid", total: 10, address: { city: "Bonn" } })).toEqual([{ field: "status", before: "\"open\"", after: "\"paid\"" }]);
        expect(changesOf(document, { $push: { tags: "a" } })).toEqual([{ field: "tags", before: "–" }]);
        expect(changesOf(document, [{ $set: { a: 1 } }])).toBeUndefined();
    });
});

describe("scriptWrites", () => {
    it("tells scripts that may write widely, once, or not at all", () => {
        expect(scriptWrites("db.orders.find({}).forEach(d => print(d))")).toBeUndefined();
        expect(scriptWrites("db.orders.updateOne({}, {})")).toBe("one");
        expect(scriptWrites("for (;;) db.orders.deleteMany({})")).toBe("many");
        expect(scriptWrites("db.a.aggregate([{ $out: \"b\" }])")).toBe("many");
    });
});
