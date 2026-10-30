import { describe, expect, it } from "vitest";
import { convertDraft, fromDraft, oneLine, toDraft } from "./edit";
import type { Json } from "./ejson";
import { parseValue } from "./parse";

describe("toDraft", () => {
    it("shows the text without its type", () => {
        expect(toDraft("abc")).toEqual({ type: "string", text: "abc" });
        expect(toDraft({ $oid: "621cb275a630865f51e3976c" })).toEqual({ type: "objectId", text: "621cb275a630865f51e3976c" });
        expect(toDraft({ $numberLong: "12" })).toEqual({ type: "long", text: "12" });
        expect(toDraft({ $date: { $numberLong: "0" } })).toEqual({ type: "date", text: "1970-01-01T00:00:00.000Z" });
        expect(toDraft({ $timestamp: { t: 5, i: 1 } })).toEqual({ type: "timestamp", text: "5, 1" });
        expect(toDraft(null)).toEqual({ type: "null", text: "" });
        expect(toDraft(["a", 1])).toEqual({ type: "array", text: "[ \"a\", 1 ]" });
    });
});

describe("fromDraft", () => {
    it("gives back the value it came from", () => {
        const values: Json[] = ["a \"b\"", 5, 1.5, true, null, { $oid: "621cb275a630865f51e3976c" }, { $numberLong: "9007199254740993" },
            { $numberDecimal: "1.25" }, { $date: { $numberLong: "1676000000000" } }, { $timestamp: { t: 5, i: 1 } }, ["x", { y: 1 }], { $minKey: 1 }];
        for (const value of values) expect(parseValue(fromDraft(toDraft(value)))).toEqual(value);
    });

    it("lets parsing fail on text that does not fit the type", () => {
        expect(() => parseValue(fromDraft({ type: "int", text: "abc" }))).toThrow();
        expect(() => parseValue(fromDraft({ type: "objectId", text: "nope" }))).toThrow();
    });
});

describe("convertDraft", () => {
    it("keeps what the new type can hold", () => {
        expect(convertDraft({ type: "string", text: "42" }, "int")).toEqual({ type: "int", text: "42" });
        expect(convertDraft({ type: "double", text: "2.7" }, "int")).toEqual({ type: "int", text: "2" });
        expect(convertDraft({ type: "int", text: "1" }, "bool")).toEqual({ type: "bool", text: "true" });
        expect(convertDraft({ type: "string", text: "2023-02-28" }, "date").text).toBe("2023-02-28T00:00:00.000Z");
        expect(convertDraft({ type: "string", text: "a" }, "array")).toEqual({ type: "array", text: "[ \"a\" ]" });
        expect(convertDraft({ type: "array", text: "[ 1 ]" }, "string")).toEqual({ type: "string", text: "[ 1 ]" });
        expect(convertDraft({ type: "string", text: "x" }, "null")).toEqual({ type: "null", text: "" });
    });

    it("makes up a valid value where nothing fits", () => {
        expect(convertDraft({ type: "string", text: "x" }, "objectId").text).toMatch(/^[0-9a-f]{24}$/);
        expect(parseValue(fromDraft(convertDraft({ type: "string", text: "x" }, "uuid")))).toHaveProperty("$binary");
    });
});

describe("oneLine", () => {
    it("writes documents and arrays on one line", () => {
        expect(oneLine({ "a": [1, "b"], "c d": {} })).toBe("{ a: [ 1, \"b\" ], \"c d\": {} }");
    });
});
