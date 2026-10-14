import { describe, expect, it } from "vitest";
import { notePath, pathsAbove, readonlyIn } from "./notes";

const note = (path: string, readonly: boolean) => ({ path, color: null, comment: null, readonly });

describe("notes of the tree", () => {
    it("keeps a note per connection, database and collection", () => {
        expect(notePath({ connectionId: "c" })).toBe("");
        expect(notePath({ connectionId: "c", database: "shop" })).toBe("shop");
        expect(notePath({ connectionId: "c", database: "shop", collection: "a/b" })).toBe("shop/a/b");
        expect(pathsAbove({ connectionId: "c", database: "shop", collection: "orders" })).toEqual(["", "shop", "shop/orders"]);
    });

    it("passes read-only down, never up or sideways", () => {
        const notes = { "shop": note("shop", true), "crm/people": note("crm/people", true) };
        expect(readonlyIn(notes, { connectionId: "c", database: "shop", collection: "orders" })).toBe(true);
        expect(readonlyIn(notes, { connectionId: "c", database: "crm" })).toBe(false);
        expect(readonlyIn(notes, { connectionId: "c", database: "crm", collection: "people" })).toBe(true);
        expect(readonlyIn(notes, { connectionId: "c", database: "crm", collection: "deals" })).toBe(false);
        expect(readonlyIn({ "": note("", true) }, { connectionId: "c", database: "any", collection: "thing" })).toBe(true);
        expect(readonlyIn(undefined, { connectionId: "c" })).toBe(false);
    });
});
