import { describe, expect, it } from "vitest";
import { folderLabel, folderWithin, parentFolder } from "@/tree/folders";
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
            { kind: "folder", name: "empty", label: "empty", count: 0, depth: 0 },
            { kind: "folder", name: "old", label: "old", count: 2, depth: 0 },
            { kind: "collection", name: "a", folder: "old", depth: 1 },
            { kind: "collection", name: "b", folder: "old", depth: 1 },
            // A folder that no longer exists does not hide its collection.
            { kind: "collection", name: "c", depth: 0 },
            { kind: "collection", name: "d", depth: 0 }
        ]);
        expect(collectionRows(["a"], "shop", notes, ["old"], () => false)).toEqual([{ kind: "folder", name: "old", label: "old", count: 1, depth: 0 }]);
    });

    it("puts folders in folders, counting what lies below", () => {
        const notes = { "shop/a": note("shop/a", false, "r/2024/q1"), "shop/b": note("shop/b", false, "r") };
        // `r/2024` is not kept itself, but `r/2024/q1` lies in it.
        const rows = collectionRows(["a", "b", "c"], "shop", notes, ["r", "r/2024/q1", "x"], folder => folder !== "x");
        expect(rows).toEqual([
            { kind: "folder", name: "r", label: "r", count: 2, depth: 0 },
            { kind: "folder", name: "r/2024", label: "2024", count: 1, depth: 1 },
            { kind: "folder", name: "r/2024/q1", label: "q1", count: 1, depth: 2 },
            { kind: "collection", name: "a", folder: "r/2024/q1", depth: 3 },
            { kind: "collection", name: "b", folder: "r", depth: 1 },
            { kind: "folder", name: "x", label: "x", count: 0, depth: 0 },
            { kind: "collection", name: "c", depth: 0 }
        ]);
    });

    it("tells where folders lie", () => {
        expect(parentFolder("a/b/c")).toBe("a/b");
        expect(parentFolder("a")).toBeUndefined();
        expect(folderLabel("a/b")).toBe("b");
        expect(folderWithin("a/b", "a")).toBe(true);
        expect(folderWithin("ab", "a")).toBe(false);
    });
});

describe("databaseRows", () => {
    it("groups the databases of a connection, apart from the folders of a database", () => {
        // `shop/old` is a collection in a folder of `shop`, not a database in a folder.
        const notes = { "shop": note("shop", false, "work"), "crm": note("crm", false, "work"), "shop/old": note("shop/old", false, "work") };
        expect(databaseRows(["crm", "logs", "shop"], notes, ["work"], () => true)).toEqual([
            { kind: "folder", name: "work", label: "work", count: 2, depth: 0 },
            { kind: "database", name: "crm", folder: "work", depth: 1 },
            { kind: "database", name: "shop", folder: "work", depth: 1 },
            { kind: "database", name: "logs", depth: 0 }
        ]);
        expect(databaseRows(["shop"], notes, [], () => true)).toEqual([{ kind: "database", name: "shop", depth: 0 }]);
    });
});
