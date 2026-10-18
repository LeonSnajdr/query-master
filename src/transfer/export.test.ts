import { describe, expect, it } from "vitest";
import { DEFAULT_CSV, DEFAULT_SQL, exportJob, exportPreset, exportProblems, filterValue, readExportPreset, rowsFor, splitPath, switchFormat } from "./export";
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
        sql: DEFAULT_SQL,
        columns: {},
        names: {},
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
        // Collection names may hold what Windows does not take in a file name.
        expect(rowsFor("csv", [{ database: "shop", collection: "a/b:c*d?\"e\"<f>|g\\h" }])[0]!.output).toBe("shop.a_b_c_d__e__f__g_h.csv");
        expect(rowsFor("database", [{ database: "shop", collection: "a:b" }])[0]!.output).toBe("a:b");
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
            { database: "shop", collection: "orders", output: "shop.orders.json", filter: null, columns: null, names: null },
            { database: "shop", collection: "people", output: "shop.people.json", filter: null, columns: null, names: null }
        ]);
    });

    it("sends the CSV settings and the columns chosen for a collection", () => {
        const job = exportJob(state({ format: "csv", csv: { ...DEFAULT_CSV, delimiter: ";" }, columns: { "shop.orders": ["total", "customer.city"] } }));
        expect(job.format).toEqual({ kind: "csv", options: { delimiter: ";", quote: "\"", header: true, nullEmpty: true, escapeStrings: false } });
        expect((job.items as { columns: string[] | null }[]).map(item => item.columns)).toEqual([["total", "customer.city"], null]);
    });

    it("sends the names of renamed columns, the others as the file or table names them", () => {
        const renamed = { columns: { "shop.orders": ["_id", "customer.city"] }, names: { "shop.orders": { "customer.city": "Stadt" } } };
        const names = (format: "csv" | "sql") => (exportJob(state({ format, ...renamed })).items as { names: string[] | null }[]).map(item => item.names);
        expect(names("csv")).toEqual([["_id", "Stadt"], null]);
        expect(names("sql")).toEqual([["_id", "Stadt"], null]);
        expect((exportJob(state({ format: "sql", columns: { "shop.orders": ["customer.city"] }, names: { "shop.orders": { "customer.city": " " } } })).items as { names: unknown }[])[0]!.names).toBeNull();
    });

    it("sends the SQL settings and its columns as for CSV", () => {
        const job = exportJob(state({ format: "sql", sql: { ...DEFAULT_SQL, dialect: "oracle", schema: " sales ", dropTable: true }, columns: { "shop.people": ["name"] } }));
        expect(job.format).toEqual({ kind: "sql", options: { dialect: "oracle", schema: "sales", createTable: true, dropTable: true } });
        expect((job.items as { columns: string[] | null }[]).map(item => item.columns)).toEqual([null, ["name"]]);
        expect(rowsFor("sql", [{ database: "shop", collection: "orders" }])[0]!.output).toBe("shop.orders.sql");
    });

    it("keeps folder and options between runs, and reads an old or broken preset with defaults", () => {
        const empty = readExportPreset(null);
        expect(empty).toEqual({ folder: "", json: { notation: "shell", layout: "lines" }, csv: DEFAULT_CSV, sql: DEFAULT_SQL, insertMode: "overwrite", copyIndexes: true });
        const after = exportPreset(state({ csv: { ...DEFAULT_CSV, delimiter: ";" } }), empty);
        expect(after.folder).toBe("C:\\exports");
        expect(readExportPreset(JSON.parse(JSON.stringify(after)))).toEqual(after);
        // The clipboard and a database write no folder: the one before stays.
        expect(exportPreset(state({ target: "clipboard" }), after).folder).toBe("C:\\exports");
        expect(exportPreset(state({ target: "file", path: "D:\\out\\a.json" }), after).folder).toBe("D:\\out");
        expect(readExportPreset({ csv: { delimiter: "|", header: "yes" }, sql: { dialect: "db2" }, insertMode: 3 })).toEqual(empty);
    });

    it("splits paths of either kind", () => {
        expect(splitPath("/home/a/b.json")).toEqual({ folder: "/home/a", name: "b.json" });
        expect(splitPath("b.json")).toEqual({ folder: "", name: "b.json" });
    });
});
