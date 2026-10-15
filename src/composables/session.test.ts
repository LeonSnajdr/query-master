import { describe, expect, it } from "vitest";
import type { WorkTab } from "@/stores/tabs";
import { sessionContent, sessionOf, worthRestoring } from "./session";

function tab(fields: Partial<WorkTab>): WorkTab {
    return { id: "t", kind: "shell", connectionId: "c", database: "shop", text: "", view: "tree", pageSize: 20, readonly: false, search: "", running: false, ...fields };
}

describe("session", () => {
    it("keeps what a tab needs, not its result", () => {
        const shell = tab({ text: "db.orders.find({})", result: { items: [1], offset: 0, hasMore: false, statement: "", milliseconds: 1 }, file: "C:\a.js" });
        expect(sessionContent(shell)).toEqual({ kind: "shell", database: "shop", text: "db.orders.find({})", file: "C:\a.js", view: "tree", pageSize: 20 });
        const aggregate = tab({ kind: "aggregate", collection: "orders", pipeline: [{ id: 3, operator: "$match", text: "{}", enabled: true }] });
        expect(sessionContent(aggregate)).toMatchObject({ kind: "aggregate", collection: "orders", pipeline: [{ operator: "$match", text: "{}", enabled: true }], options: "" });
    });

    it("leaves out tabs of connections that are not saved and marks the active one", () => {
        const tabs = [tab({ id: "a", kind: "start", connectionId: "" }), tab({ id: "b" }), tab({ id: "c", connectionId: "typed" })];
        const kept = sessionOf(tabs, "b", id => id === "c");
        expect(kept.map(entry => [entry.connectionId, entry.active])).toEqual([[null, false], ["c", true]]);
    });

    it("offers a session only with more than the start page", () => {
        expect(worthRestoring([{ active: true, connectionId: null, content: { kind: "start" } }])).toBe(false);
        expect(worthRestoring([{ active: true, connectionId: "c", content: { kind: "shell" } }])).toBe(true);
    });
});
