import { describe, expect, it } from "vitest";
import { DEFAULT_CSV_READ, formatOf, importJob, importProblems, readImportPreset, rowFor } from "./import";
import type { ImportState } from "./import";

function state(change: Partial<ImportState> = {}): ImportState {
    return {
        connectionId: "c1",
        format: "json",
        rows: [rowFor("C:\\in\\shop.orders.json", "test")],
        csv: DEFAULT_CSV_READ,
        columns: {},
        ...change
    };
}

describe("rows of the import", () => {
    it("takes database and collection from a name the export wrote", () => {
        expect(rowFor("C:\\in\\shop.orders.json", "test")).toEqual({ path: "C:\\in\\shop.orders.json", database: "shop", collection: "orders", mode: "overwrite" });
        expect(rowFor("/in/shop.orders.archive.csv", "test")).toMatchObject({ database: "shop", collection: "orders.archive" });
        // A database the server does not have yet: still only the collection name, as before the export.
        expect(rowFor("C:\\in\\vuetrack-dev-core-api.oAuthTransaction.json", "test")).toMatchObject({ database: "vuetrack-dev-core-api", collection: "oAuthTransaction" });
        expect(rowFor("/in/people.json", "test")).toMatchObject({ database: "test", collection: "people" });
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
        const rows = [{ path: "a.json", database: " ", collection: "system.users", mode: "overwrite" as const }];
        expect(importProblems(state({ rows }))).toEqual([{ key: "import.problem.noDatabase", row: 0 }, { key: "import.problem.badCollection", row: 0 }]);
    });

    it("refuses a file of the other format, as after switching the tile", () => {
        expect(importProblems(state({ format: "csv" }))).toEqual([{ key: "import.problem.otherFormat", row: 0 }]);
        const unknown = [{ path: "C:\\in\\shop.orders.txt", database: "shop", collection: "orders", mode: "overwrite" as const }];
        expect(importProblems(state({ format: "csv", rows: unknown }))).toEqual([]);
    });
});

describe("readImportPreset", () => {
    it("takes stored CSV settings and replaces what it does not know", () => {
        const csv = { ...DEFAULT_CSV_READ, delimiter: "\t" as const, skipRows: 2, empty: "omit" as const };
        expect(readImportPreset({ csv })).toEqual({ csv });
        expect(readImportPreset({ csv: { delimiter: "|", skipRows: 99, empty: "zero", header: 1 } })).toEqual({ csv: DEFAULT_CSV_READ });
        expect(readImportPreset("broken")).toEqual({ csv: DEFAULT_CSV_READ });
    });
});

describe("importJob", () => {
    it("sends the files, and for CSV the settings and the columns of each file", () => {
        expect(importJob(state())).toEqual({
            connectionId: "c1",
            format: { kind: "json" },
            items: [{ path: "C:\\in\\shop.orders.json", database: "shop", collection: "orders", mode: "overwrite", columns: null }]
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
