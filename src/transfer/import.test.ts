import { describe, expect, it } from "vitest";
import { DEFAULT_CSV_READ, formatOf, importJob, importProblems, rowFor } from "./import";
import type { ImportState } from "./import";

function state(change: Partial<ImportState> = {}): ImportState {
    return {
        connectionId: "c1",
        format: "json",
        rows: [rowFor("C:\\in\\shop.orders.json", ["shop"], "test")],
        csv: DEFAULT_CSV_READ,
        columns: {},
        ...change
    };
}

describe("rows of the import", () => {
    it("takes database and collection from a name the export wrote", () => {
        expect(rowFor("C:\\in\\shop.orders.json", ["shop"], "test")).toEqual({ path: "C:\\in\\shop.orders.json", database: "shop", collection: "orders" });
        expect(rowFor("/in/shop.orders.archive.csv", ["shop"], "test")).toMatchObject({ database: "shop", collection: "orders.archive" });
        // An unknown database: the name stays the collection's.
        expect(rowFor("/in/other.orders.json", ["shop"], "test")).toMatchObject({ database: "test", collection: "other.orders" });
        expect(rowFor("/in/people", [], "test")).toMatchObject({ database: "test", collection: "people" });
    });

    it("knows the format by the extension", () => {
        expect(formatOf("a/b.JSON")).toBe("json");
        expect(formatOf("a/b.ndjson")).toBe("json");
        expect(formatOf("a/b.csv")).toBe("csv");
        expect(formatOf("a/b.xlsx")).toBeUndefined();
    });
});

describe("importProblems", () => {
    it("asks for a server, files, and a database and collection each", () => {
        expect(importProblems(state())).toEqual([]);
        expect(importProblems(state({ connectionId: "", rows: [] }))).toEqual([{ key: "import.problem.noServer" }, { key: "import.problem.noRows" }]);
        const rows = [{ path: "a.json", database: " ", collection: "system.users" }];
        expect(importProblems(state({ rows }))).toEqual([{ key: "import.problem.noDatabase", row: 0 }, { key: "import.problem.badCollection", row: 0 }]);
    });
});

describe("importJob", () => {
    it("sends the files, and for CSV the settings and the columns of each file", () => {
        expect(importJob(state())).toEqual({
            connectionId: "c1",
            format: { kind: "json" },
            items: [{ path: "C:\\in\\shop.orders.json", database: "shop", collection: "orders", columns: null }]
        });
        const columns = [{ name: "n", type: "int" as const, include: true }];
        const csv = importJob(state({
            format: "csv",
            csv: { ...DEFAULT_CSV_READ, delimiter: ";", skipRows: 42 },
            columns: { "C:\\in\\shop.orders.json": columns }
        }));
        expect(csv.format).toEqual({ kind: "csv", options: { delimiter: ";", quote: "\"", skipRows: 10, empty: "null", header: true, unescape: false } });
        expect((csv.items as { columns: unknown }[])[0]!.columns).toEqual(columns);
    });
});
