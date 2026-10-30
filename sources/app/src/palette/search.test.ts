import { describe, expect, it } from "vitest";
import { paletteItems, rank, readQuery, remember } from "./search";
import type { PaletteItem } from "./search";

describe("rank", () => {
    it("puts the start of the name before a word start, a word start before inside, inside before spread", () => {
        expect(rank("ord", "orders")?.rank).toBe(0);
        expect(rank("items", "order-items")).toEqual({ rank: 1, hits: [6, 7, 8, 9, 10] });
        expect(rank("ders", "orders")?.rank).toBe(2);
        expect(rank("oi", "order-items")).toEqual({ rank: 3, hits: [0, 6] });
        expect(rank("xyz", "orders")).toBeUndefined();
    });

    it("ignores case and knows dots, slashes and capitals as word starts", () => {
        expect(rank("ORD", "Orders")?.rank).toBe(0);
        expect(rank("log", "system.log")?.rank).toBe(1);
        expect(rank("view", "createView")?.rank).toBe(1);
    });
});

describe("paletteItems", () => {
    const items: PaletteItem[] = [
        { key: "c:orders", group: "collection", label: "orders" },
        { key: "c:order-items", group: "collection", label: "order-items" },
        { key: "c:customers", group: "collection", label: "customers" },
        { key: "q:open", group: "query", label: "open orders" },
        { key: "k:browse", group: "command", label: "Browse documents" },
        { key: "k:shell", group: "command", label: "Open shell" },
        { key: "n:local", group: "connection", label: "Local" }
    ];
    const labels = (text: string, recent: string[] = []) => paletteItems(items, text, recent).map(entry => entry.item.label);

    it("groups in a fixed order, best match first", () => {
        expect(labels("ord")).toEqual(["order-items", "orders", "open orders"]);
        expect(labels("open")).toEqual(["open orders", "Open shell"]);
    });

    it("narrows to a group by prefix", () => {
        expect(labels(">sh")).toEqual(["Open shell"]);
        expect(labels("@")).toEqual(["customers", "order-items", "orders"]);
        expect(readQuery("  # late")).toEqual({ group: "query", query: "late" });
    });

    it("shows the recent ones without text, then the commands; recent wins a tie", () => {
        expect(labels("", ["c:customers"])).toEqual(["customers", "Browse documents", "Open shell"]);
        expect(labels("ord", ["c:orders"])).toEqual(["orders", "order-items", "open orders"]);
        expect(remember(["a", "b"], "b")).toEqual(["b", "a"]);
    });
});
