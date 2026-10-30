import { describe, expect, it } from "vitest";
import { fieldCommand, hasCondition, joinPath, nameProblem, scopesFor } from "./fields";
import type { FieldTarget } from "./fields";

const target: FieldTarget = { id: 1, selected: [1, 2], query: { status: "open" } };

describe("field changes in many documents", () => {
    it("offers the query only with its filter, and many only when several are selected", () => {
        expect(scopesFor(target, "set")).toEqual(["single", "selected", "query", "collection"]);
        expect(scopesFor({ id: 1, selected: [1] }, "unset")).toEqual(["single", "collection"]);
        expect(scopesFor(target, "push")).toEqual(["single"]);
    });

    it("sets a value in one, the selected, the query's or all documents", () => {
        const set = { kind: "set" as const, path: "a.b", value: 5 };
        expect(fieldCommand("c", set, target, "single")).toEqual({ update: "c", updates: [{ q: { _id: 1 }, u: { $set: { "a.b": 5 } }, multi: false }] });
        expect(fieldCommand("c", set, target, "selected").updates).toEqual([{ q: { _id: { $in: [1, 2] } }, u: { $set: { "a.b": 5 } }, multi: true }]);
        expect(fieldCommand("c", set, target, "query").updates).toEqual([{ q: { status: "open" }, u: { $set: { "a.b": 5 } }, multi: true }]);
        expect(fieldCommand("c", set, target, "collection").updates).toEqual([{ q: {}, u: { $set: { "a.b": 5 } }, multi: true }]);
    });

    it("narrows setting in many documents to those with or without the field", () => {
        const set = { kind: "set" as const, path: "n", value: 0 };
        expect(hasCondition("set", "query")).toBe(true);
        expect(hasCondition("set", "selected")).toBe(false);
        expect(hasCondition("rename", "collection")).toBe(false);
        expect(fieldCommand("c", set, target, "query", "missing").updates).toEqual([{ q: { $and: [{ status: "open" }, { n: { $exists: false } }] }, u: { $set: { n: 0 } }, multi: true }]);
        expect(fieldCommand("c", set, target, "collection", "exists").updates).toEqual([{ q: { n: { $exists: true } }, u: { $set: { n: 0 } }, multi: true }]);
        // Where the dialog shows no condition, none is used.
        expect(fieldCommand("c", set, target, "single", "missing").updates).toEqual([{ q: { _id: 1 }, u: { $set: { n: 0 } }, multi: false }]);
    });

    it("renames, removes and appends", () => {
        expect(fieldCommand("c", { kind: "rename", path: "a.b", to: "a.c" }, target, "collection").updates).toEqual([{ q: {}, u: { $rename: { "a.b": "a.c" } }, multi: true }]);
        expect(fieldCommand("c", { kind: "unset", path: "x" }, target, "selected").updates).toEqual([{ q: { _id: { $in: [1, 2] } }, u: { $unset: { x: "" } }, multi: true }]);
        expect(fieldCommand("c", { kind: "push", path: "tags", value: "new" }, target, "single").updates).toEqual([{ q: { _id: 1 }, u: { $push: { tags: "new" } }, multi: false }]);
    });

    it("joins paths and checks names", () => {
        expect(joinPath("", "a")).toBe("a");
        expect(joinPath("a.b", "c")).toBe("a.b.c");
        expect(nameProblem(" ")).toBe("field.error.noName");
        expect(nameProblem("a.b")).toBe("field.error.badName");
        expect(nameProblem("$x")).toBe("field.error.badName");
        expect(nameProblem("ok")).toBeUndefined();
    });
});
