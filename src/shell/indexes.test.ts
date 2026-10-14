import { describe, expect, it } from "vitest";
import { emptyIndexForm, indexFormErrors, indexFormOf, indexSpec } from "./indexes";
import type { IndexForm } from "./indexes";

function form(change: Partial<IndexForm>): IndexForm {
    return { ...emptyIndexForm(), ...change };
}

describe("indexSpec", () => {
    it("keeps the order of the fields and names the index like MongoDB", () => {
        const spec = indexSpec(form({ fields: [{ field: "status", kind: "1" }, { field: "at", kind: "-1" }, { field: " ", kind: "1" }] }));
        expect(Object.keys(spec.key as object)).toEqual(["status", "at"]);
        expect(spec).toEqual({ key: { status: 1, at: -1 }, name: "status_1_at_-1" });
    });

    it("writes only the options that are set", () => {
        const spec = indexSpec(form({
            fields: [{ field: "at", kind: "1" }],
            name: "expiry",
            unique: true,
            hidden: true,
            ttl: "3600",
            partialFilter: { done: true },
            locale: "de"
        }));
        expect(spec).toEqual({
            key: { at: 1 },
            name: "expiry",
            unique: true,
            hidden: true,
            expireAfterSeconds: 3600,
            partialFilterExpression: { done: true },
            collation: { locale: "de" }
        });
    });

    it("takes special kinds as strings", () => {
        expect(indexSpec(form({ fields: [{ field: "body", kind: "text" }, { field: "place", kind: "2dsphere" }] })).key).toEqual({ body: "text", place: "2dsphere" });
    });
});

describe("indexFormErrors", () => {
    it("asks for a field, distinct fields and a sound TTL", () => {
        expect(indexFormErrors(emptyIndexForm())).toEqual(["indexDialog.error.noField"]);
        expect(indexFormErrors(form({ fields: [{ field: "a", kind: "1" }, { field: "a", kind: "-1" }] }))).toContain("indexDialog.error.duplicateField");
        expect(indexFormErrors(form({ fields: [{ field: "a", kind: "1" }], ttl: "-5" }))).toEqual(["indexDialog.error.ttl"]);
        expect(indexFormErrors(form({ fields: [{ field: "a", kind: "1" }, { field: "b", kind: "1" }], ttl: "60" }))).toEqual(["indexDialog.error.ttlCompound"]);
        expect(indexFormErrors(form({ fields: [{ field: "a", kind: "hashed" }], unique: true }))).toEqual(["indexDialog.error.hashedUnique"]);
        expect(indexFormErrors(form({ fields: [{ field: "a", kind: "1" }], ttl: "60" }))).toEqual([]);
    });
});

describe("indexFormOf", () => {
    it("reads an index as listIndexes gives it in canonical Extended JSON", () => {
        const index = {
            v: { $numberInt: "2" },
            key: { at: { $numberInt: "-1" }, body: "text" },
            name: "at_-1_body_text",
            unique: true,
            expireAfterSeconds: { $numberInt: "60" },
            collation: { locale: "de", strength: { $numberInt: "3" } }
        };
        expect(indexFormOf(index)).toEqual({
            fields: [{ field: "at", kind: "-1" }, { field: "body", kind: "text" }],
            name: "at_-1_body_text",
            unique: true,
            sparse: false,
            hidden: false,
            ttl: "60",
            partialFilter: undefined,
            locale: "de"
        });
    });
});
