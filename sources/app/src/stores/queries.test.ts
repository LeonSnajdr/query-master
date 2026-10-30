import { describe, expect, it } from "vitest";
import type { SavedQuery } from "@/api";
import { belongsTo, draftOf, matchesQuery, queryContent, sameContent, scopeOf, suggestedName } from "./queries";
import type { WorkTab } from "./tabs";

function tab(fields: Partial<WorkTab>): WorkTab {
    return { id: "t", kind: "browse", connectionId: "c", database: "shop", text: "", view: "tree", pageSize: 20, readonly: false, search: "", running: false, ...fields };
}

const browse = tab({ collection: "orders", pipeline: [{ id: 1, operator: "$match", text: "{ status: \"open\" }", enabled: true }, { id: 2, operator: "$sort", text: "{ }", enabled: true, json: true }] });

describe("saved queries", () => {
    it("takes what a tab needs to run its query again", () => {
        expect(queryContent(browse)).toEqual({ pipeline: [{ operator: "$match", text: "{ status: \"open\" }", enabled: true }, { operator: "$sort", text: "{ }", enabled: true, json: true }], options: "" });
        expect(queryContent(tab({ kind: "shell", text: "db.a.find()" }))).toEqual({ text: "db.a.find()" });
        expect(queryContent(tab({ kind: "aggregate", collection: "orders", pipeline: [{ id: 7, operator: "$match", text: "{}", enabled: false }], aggregateOptions: "{ allowDiskUse: true }" })))
            .toEqual({ pipeline: [{ operator: "$match", text: "{}", enabled: false }], options: "{ allowDiskUse: true }" });
    });

    it("knows a saved query again, whatever the white space", () => {
        expect(sameContent({ text: "db.a.find({ x: 1 })" }, { text: "db.a.find({x:1})" })).toBe(true);
        expect(sameContent({ text: "db.a.find({ x: 1 })" }, { text: "db.a.find({ x: 2 })" })).toBe(false);
    });

    it("drafts a name and a scope", () => {
        expect(suggestedName(browse)).toBe("status: \"open\"");
        expect(suggestedName(tab({ kind: "shell", text: "\n  db.orders.countDocuments()\nmore" }))).toBe("db.orders.countDocuments()");
        expect(draftOf(browse)).toMatchObject({ collection: "orders", kind: "browse" });
        expect(draftOf(tab({ kind: "sql", collection: "orders", text: "SELECT 1" }))?.collection).toBeNull();
        expect(draftOf(tab({ kind: "start" }))).toBeUndefined();
    });

    it("tells where a query belongs and filters by text", () => {
        const query: SavedQuery = { id: 1, connectionId: "c", database: "shop", collection: "orders", kind: "browse", name: "Open orders", folder: "checks", content: { stages: [] } };
        expect(belongsTo(query, browse)).toBe(true);
        expect(belongsTo(query, tab({ collection: "customers" }))).toBe(false);
        expect(scopeOf({ ...query, collection: null, kind: "shell" }, tab({ collection: "customers" }))).toBe(true);
        expect(scopeOf(query, tab({ database: "crm", collection: "orders" }))).toBe(false);
        expect(matchesQuery(query, "OPEN")).toBe(true);
        expect(matchesQuery(query, "checks")).toBe(true);
        expect(matchesQuery(query, "nothing")).toBe(false);
    });
});
