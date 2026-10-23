import { describe, expect, it } from "vitest";
import { emptyIndexForm, indexFormErrors, indexFormOf, indexSpec, storedSpec } from "./indexes";
import type { IndexForm } from "./indexes";
import { emptyCollation } from "./collation";

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
            collation: { ...emptyCollation(), locale: "de" }
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

describe("storedSpec", () => {
    it("drops what the server sets itself", () => {
        expect(storedSpec({ v: 2, key: { a: 1 }, name: "a_1", ns: "shop.orders", sparse: true })).toEqual({ key: { a: 1 }, name: "a_1", sparse: true });
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
        expect(indexFormOf(index)).toMatchObject({
            fields: [{ field: "at", kind: "-1" }, { field: "body", kind: "text" }],
            name: "at_-1_body_text",
            unique: true,
            sparse: false,
            hidden: false,
            ttl: "60",
            partialFilter: undefined,
            collation: { locale: "de", strength: "3" },
            kept: {}
        });
    });

    it("keeps what the dialog has no field for, so re-creating loses nothing", () => {
        const index = {
            v: 2,
            key: { shop: 1, _fts: "text", _ftsx: 1 },
            name: "text",
            weights: { title: 10, body: 1 },
            default_language: "german",
            language_override: "lang",
            textIndexVersion: 3,
            collation: { locale: "de", strength: 2, numericOrdering: true }
        };
        const form = indexFormOf(index);
        expect(form.fields).toEqual([{ field: "shop", kind: "1" }, { field: "title", kind: "text" }, { field: "body", kind: "text" }]);
        expect(indexSpec(form)).toEqual({
            key: { shop: 1, title: "text", body: "text" },
            name: "text",
            weights: { title: 10, body: 1 },
            default_language: "german",
            language_override: "lang",
            textIndexVersion: 3,
            collation: { locale: "de", strength: 2, numericOrdering: true }
        });
        // Another locale keeps the other settings; none drops the collation.
        expect(indexSpec({ ...form, collation: { ...form.collation, locale: "fr" } }).collation).toEqual({ locale: "fr", strength: 2, numericOrdering: true });
        expect(indexSpec({ ...form, collation: { ...form.collation, locale: "" } }).collation).toBeUndefined();
        // What only the dialog has no field for stays as it was.
        expect(indexSpec(indexFormOf({ key: { a: 1 }, name: "a_1", wildcardProjection: { b: 0 } }))).toEqual({ key: { a: 1 }, name: "a_1", wildcardProjection: { b: 0 } });
    });

    it("writes the options of text and geo only for such fields, and checks them", () => {
        const text = form({ fields: [{ field: "body", kind: "text" }], text: { defaultLanguage: "german", languageOverride: "", version: "3", weights: "{ body: 5 }" } });
        expect(indexSpec(text)).toEqual({ key: { body: "text" }, name: "body_text", weights: { body: 5 }, default_language: "german", textIndexVersion: 3 });
        expect(indexSpec({ ...text, fields: [{ field: "body", kind: "1" }] })).toEqual({ key: { body: 1 }, name: "body_1" });
        expect(indexFormErrors({ ...text, text: { ...text.text, weights: "[1]" } })).toEqual(["indexDialog.error.weights"]);
        expect(indexSpec({ ...text, text: { ...text.text, weights: "body: 5, title: 2" } }).weights).toEqual({ body: 5, title: 2 });
        const flat = form({ fields: [{ field: "at", kind: "2d" }], geo: { min: "-10", max: "10", bits: "20", sphereVersion: "3" } });
        expect(indexSpec(flat)).toEqual({ key: { at: "2d" }, name: "at_2d", min: -10, max: 10, bits: 20 });
        expect(indexFormErrors({ ...flat, geo: { ...flat.geo, min: "10" } })).toEqual(["indexDialog.error.bounds"]);
        expect(indexFormErrors({ ...flat, geo: { ...flat.geo, bits: "40" } })).toEqual(["indexDialog.error.bits"]);
        expect(indexSpec(form({ fields: [{ field: "at", kind: "2dsphere" }], geo: flat.geo }))).toEqual({ "key": { at: "2dsphere" }, "name": "at_2dsphere", "2dsphereIndexVersion": 3 });
    });
});
