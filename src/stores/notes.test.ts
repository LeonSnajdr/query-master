import { describe, expect, it } from "vitest";
import { collectionRows, databaseRows, notePath, pathsAbove, readonlyIn } from "./notes";

const note = (path: string, readonly: boolean, folder: string | null = null) => ({ path, color: null, comment: null, readonly, folder });

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

describe("collectionRows", () => {
    it("puts folders first, their collections below when open, then the rest", () => {
        const notes = { "shop/a": note("shop/a", false, "old"), "shop/b": note("shop/b", false, "old"), "shop/c": note("shop/c", false, "gone") };
        const rows = collectionRows(["a", "b", "c", "d"], "shop", notes, ["old", "empty"], folder => folder === "old");
        expect(rows).toEqual([
            { kind: "folder", name: "empty", count: 0 },
            { kind: "folder", name: "old", count: 2 },
            { kind: "collection", name: "a", folder: "old" },
            { kind: "collection", name: "b", folder: "old" },
            // A folder that no longer exists does not hide its collection.
            { kind: "collection", name: "c" },
            { kind: "collection", name: "d" }
        ]);
        expect(collectionRows(["a"], "shop", notes, ["old"], () => false)).toEqual([{ kind: "folder", name: "old", count: 1 }]);
    });
});

describe("databaseRows", () => {
    it("groups the databases of a connection, apart from the folders of a database", () => {
        // `shop/old` is a collection in a folder of `shop`, not a database in a folder.
        const notes = { "shop": note("shop", false, "work"), "crm": note("crm", false, "work"), "shop/old": note("shop/old", false, "work") };
        expect(databaseRows(["crm", "logs", "shop"], notes, ["work"], () => true)).toEqual([
            { kind: "folder", name: "work", count: 2 },
            { kind: "database", name: "crm", folder: "work" },
            { kind: "database", name: "shop", folder: "work" },
            { kind: "database", name: "logs" }
        ]);
        expect(databaseRows(["shop"], notes, [], () => true)).toEqual([{ kind: "database", name: "shop" }]);
    });
});
