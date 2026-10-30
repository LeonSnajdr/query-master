import { describe, expect, it } from "vitest";
import { filterChoices, highlight, matchRange, namesAsChoices } from "./choice";

const labels = (names: string[], query: string) => filterChoices(namesAsChoices(names), query).map(choice => choice.label);

describe("choice fields", () => {
    it("keeps entries containing the text, ignoring case", () => {
        expect(labels(["orders", "Customers", "ORDER_items", "logs"], "order")).toEqual(["orders", "ORDER_items"]);
        expect(labels(["orders", "customers"], "STOM")).toEqual(["customers"]);
        expect(labels(["orders"], "invoices")).toEqual([]);
    });

    it("keeps all for an empty or blank text", () => {
        expect(labels(["b", "a"], "")).toEqual(["b", "a"]);
        expect(labels(["b", "a"], "  ")).toEqual(["b", "a"]);
    });

    it("ignores accents and umlauts on both sides", () => {
        expect(labels(["Bestellungen_Österreich", "Kunden"], "osterr")).toEqual(["Bestellungen_Österreich"]);
        expect(labels(["Cafe", "Kunden"], "café")).toEqual(["Cafe"]);
    });

    it("puts entries starting with the text first, otherwise keeps the order", () => {
        expect(labels(["all_orders", "orders_2025", "old_orders", "orders"], "orders")).toEqual(["orders_2025", "orders", "all_orders", "old_orders"]);
    });

    it("marks the match in the label", () => {
        expect(highlight("all_Orders", "order")).toEqual([
            { text: "all_", match: false },
            { text: "Order", match: true },
            { text: "s", match: false }
        ]);
        expect(highlight("orders", "")).toEqual([{ text: "orders", match: false }]);
        expect(highlight("orders", "xyz")).toEqual([{ text: "orders", match: false }]);
        expect(highlight("Größe", "grosse")).toEqual([{ text: "Größe", match: false }]);
        expect(highlight("Österreich", "oster")).toEqual([
            { text: "Öster", match: true },
            { text: "reich", match: false }
        ]);
    });

    it("finds the range across characters of two code units", () => {
        expect(matchRange("a😀b", "😀b")).toEqual([1, 4]);
    });

    it("turns names into entries with hints", () => {
        expect(namesAsChoices(["a", "v"], { v: "view" })).toEqual([
            { value: "a", label: "a", hint: undefined },
            { value: "v", label: "v", hint: "view" }
        ]);
    });
});
