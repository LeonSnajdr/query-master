import { describe, expect, it } from "vitest";
import { all, click, keyOf, kindOf, rowOf, together } from "./selection";

const connection = (id: string) => ({ connectionId: id });
const database = (name: string, id = "a") => ({ connectionId: id, database: name });
const collection = (name: string, db = "shop", id = "a") => ({ connectionId: id, database: db, collection: name });

// The tree as shown: a connection, its databases, the collections of an open one, another connection.
const ROWS = [
    connection("a"), database("logs"), database("shop"), collection("customers"), collection("orders"), collection("items"),
    connection("b"), database("crm", "b")
];

describe("tree selection", () => {
    it("knows the kind of a row and what may go together", () => {
        expect(kindOf(collection("orders"))).toBe("collection");
        expect(kindOf({ ...collection("orders"), index: "_id_" })).toBe("index");
        expect(together(connection("a"), connection("b"))).toBe(true);
        expect(together(database("shop"), database("crm", "b"))).toBe(false);
        expect(together(collection("orders"), collection("events", "logs"))).toBe(true);
        expect(together(collection("orders"), database("shop"))).toBe(false);
        expect(together({ ...collection("orders"), index: "a" }, { ...collection("items"), index: "b" })).toBe(false);
    });

    it("selects one, adds and takes away with Ctrl, a range with Shift", () => {
        let state = click({ rows: [] }, collection("customers"), "single", ROWS);
        expect(state.rows).toEqual([collection("customers")]);
        state = click(state, collection("items"), "toggle", ROWS);
        expect(state.rows).toEqual([collection("customers"), collection("items")]);
        state = click(state, collection("customers"), "toggle", ROWS);
        expect(state.rows).toEqual([collection("items")]);
        // The last row can not be taken away: the selection is never empty.
        expect(click(state, collection("items"), "toggle", ROWS).rows).toEqual([collection("items")]);

        state = click({ rows: [] }, collection("customers"), "single", ROWS);
        state = click(state, collection("items"), "range", ROWS);
        expect(state.rows).toEqual([collection("customers"), collection("orders"), collection("items")]);
        // Upwards from the same anchor.
        expect(click(state, collection("orders"), "range", ROWS).rows).toEqual([collection("customers"), collection("orders")]);
    });

    it("starts anew on a row that can not go with the others", () => {
        const state = click({ rows: [database("shop")], anchor: database("shop") }, collection("orders"), "toggle", ROWS);
        expect(state.rows).toEqual([collection("orders")]);
        // A range over other kinds keeps only rows of the anchor's kind.
        const range = click({ rows: [database("logs")], anchor: database("logs") }, database("shop"), "range", ROWS);
        expect(range.rows).toEqual([database("logs"), database("shop")]);
        expect(click({ rows: [connection("a")], anchor: connection("a") }, connection("b"), "range", ROWS).rows).toEqual([connection("a"), connection("b")]);
    });

    it("gets a row back from its key", () => {
        for (const row of [...ROWS, { ...collection("orders"), index: "n_1" }]) expect(rowOf(keyOf(row))).toEqual(row);
    });

    it("selects all rows shown that go with one", () => {
        expect(all(collection("orders"), [...ROWS, collection("events", "logs")])).toHaveLength(3);
        expect(all(database("shop"), ROWS)).toEqual([database("logs"), database("shop")]);
    });
});
