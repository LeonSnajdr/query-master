import { describe, expect, it } from "vitest";
import { DEFAULT_CSV, exportJob, exportProblems, filterValue, rowsFor, splitPath, switchFormat } from "./export";
import type { ExportState } from "./export";

function state(change: Partial<ExportState> = {}): ExportState {
    return {
        connectionId: "c1",
        format: "json",
        target: "directory",
        path: "C:\\exports",
        rows: rowsFor("json", [{ database: "shop", collection: "orders" }, { database: "shop", collection: "people" }]),
        json: { notation: "shell", layout: "lines" },
        csv: DEFAULT_CSV,
        columns: {},
        database: { connectionId: "", database: "", insertMode: "overwrite", copyIndexes: true },
        ...change
    };
}

describe("rows of the export", () => {
    it("names outputs and follows a new format", () => {
        const rows = rowsFor("json", [{ database: "shop", collection: "orders" }]);
        expect(rows[0]!.output).toBe("shop.orders.json");
        const typed = [{ ...rows[0]!, output: "mine.txt" }, ...rowsFor("json", [{ database: "shop", collection: "people" }])];
        expect(switchFormat(typed, "json", "csv").map(row => row.output)).toEqual(["mine.txt", "shop.people.csv"]);
        expect(switchFormat(rows, "json", "database")[0]!.output).toBe("orders");
    });

    it("takes a filter document or a pipeline in shell notation", () => {
        expect(filterValue("")).toBeUndefined();
        expect(filterValue("{ }")).toBeUndefined();
        expect(filterValue("{ n: { $gt: 1 } }")).toEqual({ n: { $gt: 1 } });
        expect(filterValue("[{ $match: { a: 1 } }]")).toEqual([{ $match: { a: 1 } }]);
        expect(() => filterValue("[1]")).toThrow();
        expect(() => filterValue("5")).toThrow();
    });
});

describe("exportProblems", () => {
    it("asks for a path, an output each, distinct outputs and readable filters", () => {
        expect(exportProblems(state())).toEqual([]);
        expect(exportProblems(state({ path: " " }))).toEqual([{ key: "export.problem.noPath" }]);
        const rows = state().rows;
        rows[1] = { ...rows[1]!, output: "SHOP.orders.JSON", filter: "{ broken" };
        expect(exportProblems(state({ rows }))).toEqual([{ key: "export.problem.sameOutput", row: 1 }, { key: "export.problem.filter", row: 1 }]);
        expect(exportProblems(state({ format: "csv", target: "clipboard" }))).toEqual([]);
        expect(exportProblems(state({ format: "database" }))).toEqual([{ key: "export.problem.noServer" }, { key: "export.problem.noDatabase" }]);
    });
});

describe("exportJob", () => {
    it("sends a folder, one file, the clipboard or a database", () => {
        expect(exportJob(state()).destination).toEqual({ kind: "directory", path: "C:\\exports" });
        const one = exportJob(state({ target: "file", path: "C:\\out\\orders.json", rows: state().rows.slice(0, 1) }));
        expect(one.destination).toEqual({ kind: "directory", path: "C:\\out" });
        expect((one.items as { output: string }[])[0]!.output).toBe("orders.json");
        expect(exportJob(state({ target: "clipboard" })).destination).toEqual({ kind: "clipboard" });
        const copy = exportJob(state({ format: "database", database: { connectionId: "c2", database: "backup", insertMode: "newId", copyIndexes: false } }));
        expect(copy.destination).toEqual({ kind: "database", connectionId: "c2", database: "backup", insertMode: "newId", copyIndexes: false });
        expect(copy.items).toEqual([
            { database: "shop", collection: "orders", output: "shop.orders.json", filter: null, columns: null },
            { database: "shop", collection: "people", output: "shop.people.json", filter: null, columns: null }
        ]);
    });

    it("sends the CSV settings and the columns chosen for a collection", () => {
        const job = exportJob(state({ format: "csv", csv: { ...DEFAULT_CSV, delimiter: ";" }, columns: { "shop.orders": ["total", "customer.city"] } }));
        expect(job.format).toEqual({ kind: "csv", options: { delimiter: ";", quote: "\"", header: true, nullEmpty: true, escapeStrings: false } });
        expect((job.items as { columns: string[] | null }[]).map(item => item.columns)).toEqual([["total", "customer.city"], null]);
    });

    it("splits paths of either kind", () => {
        expect(splitPath("/home/a/b.json")).toEqual({ folder: "/home/a", name: "b.json" });
        expect(splitPath("b.json")).toEqual({ folder: "", name: "b.json" });
    });
});
