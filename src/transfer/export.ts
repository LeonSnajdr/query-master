import type { Doc, Json } from "@/shell/ejson";
import { isDoc } from "@/shell/ejson";
import { ShellError } from "@/shell/message";
import { parseValue } from "@/shell/parse";

/** The four kinds of export, as the tiles of the wizard. */
export const EXPORT_FORMATS = ["json", "csv", "sql", "database"] as const;
export type ExportFormat = typeof EXPORT_FORMATS[number];

/** Where files go: a folder (one file per collection), one file, or the clipboard. */
export const FILE_TARGETS = ["directory", "file", "clipboard"] as const;
export type FileTarget = typeof FILE_TARGETS[number];

export type JsonNotation = "shell" | "relaxed" | "canonical";
export type JsonLayout = "lines" | "comma" | "array";
export type InsertMode = "overwrite" | "newId";

/** The settings of the CSV page. */
export interface CsvSettings {
    delimiter: "," | ";" | "\t" | " ";
    quote: "\"" | "'";
    header: boolean;
    nullEmpty: boolean;
    escapeStrings: boolean;
}

export const DEFAULT_CSV: CsvSettings = { delimiter: ",", quote: "\"", header: true, nullEmpty: true, escapeStrings: false };

/** The key of a collection in `ExportState.columns`. */
export function columnsKey(row: { database: string; collection: string }): string {
    return `${row.database}.${row.collection}`;
}

/** A row of the wizard. */
export interface ExportRow {
    database: string;
    collection: string;
    /** File name, or the name of the collection in the target database. */
    output: string;
    /** Shell text: a `find` filter or a pipeline; empty for all documents. */
    filter: string;
}

/** What the wizard holds. */
export interface ExportState {
    connectionId: string;
    format: ExportFormat;
    target: FileTarget;
    /** Folder, or file for a single row. */
    path: string;
    rows: ExportRow[];
    json: { notation: JsonNotation; layout: JsonLayout };
    csv: CsvSettings;
    /** CSV columns (dotted paths) per collection, as `database.collection`; none: the fields of the first level. */
    columns: Record<string, string[]>;
    database: { connectionId: string; database: string; insertMode: InsertMode; copyIndexes: boolean };
}

const EXTENSIONS: Record<Exclude<ExportFormat, "database">, string> = { json: "json", csv: "csv", sql: "sql" };

/** The output a row gets by default: `db.collection.json`, or the collection's own name. */
export function defaultOutput(format: ExportFormat, database: string, collection: string): string {
    return format === "database" ? collection : `${database}.${collection}.${EXTENSIONS[format]}`;
}

/** The rows for collections (each with its database), with default outputs and no filter. */
export function rowsFor(format: ExportFormat, collections: { database: string; collection: string; filter?: string }[]): ExportRow[] {
    return collections.map(({ database, collection, filter }) => ({ database, collection, output: defaultOutput(format, database, collection), filter: filter ?? "" }));
}

/** Another format: outputs that were still the default follow it; ones typed by hand stay. */
export function switchFormat(rows: ExportRow[], from: ExportFormat, to: ExportFormat): ExportRow[] {
    return rows.map(row => (row.output === defaultOutput(from, row.database, row.collection) ? { ...row, output: defaultOutput(to, row.database, row.collection) } : row));
}

/** The filter of a row as the server takes it: a document or a pipeline; `undefined` for all. */
export function filterValue(text: string): Doc | Json[] | undefined {
    const trimmed = text.trim();
    if (trimmed === "" || trimmed.replace(/\s/g, "") === "{}") return undefined;
    const value = parseValue(trimmed);
    if (Array.isArray(value)) {
        if (!value.every(stage => isDoc(stage))) throw new ShellError("error.export.filter");
        return value;
    }
    if (!isDoc(value)) throw new ShellError("error.export.filter");
    return value;
}

/** Problems that keep the wizard from starting, as i18n keys with the row they belong to. */
export function exportProblems(state: ExportState): { key: string; row?: number }[] {
    const problems: { key: string; row?: number }[] = [];
    if (state.rows.length === 0) problems.push({ key: "export.problem.noRows" });
    if (state.format === "database") {
        if (!state.database.connectionId) problems.push({ key: "export.problem.noServer" });
        if (!state.database.database.trim()) problems.push({ key: "export.problem.noDatabase" });
    } else if (state.target !== "clipboard" && !state.path.trim()) {
        problems.push({ key: "export.problem.noPath" });
    }
    const seen = new Set<string>();
    state.rows.forEach((row, index) => {
        const output = row.output.trim();
        if (!output) problems.push({ key: "export.problem.noOutput", row: index });
        else if (state.format !== "database" && state.target !== "clipboard" && /[/\\:*?"<>|]/.test(output)) problems.push({ key: "export.problem.badOutput", row: index });
        const key = state.format === "database" ? output : output.toLowerCase();
        if (output && seen.has(key)) problems.push({ key: "export.problem.sameOutput", row: index });
        seen.add(key);
        try {
            filterValue(row.filter);
        } catch {
            problems.push({ key: "export.problem.filter", row: index });
        }
    });
    return problems;
}

/** The folder of a file path, and its name. */
export function splitPath(path: string): { folder: string; name: string } {
    const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
    return cut === -1 ? { folder: "", name: path } : { folder: path.slice(0, cut), name: path.slice(cut + 1) };
}

/** The job as the Rust side takes it (`src-tauri/src/transfer/job.rs`). */
export function exportJob(state: ExportState): Doc {
    let rows = state.rows;
    let destination: Doc;
    if (state.format === "database") {
        destination = { kind: "database", ...state.database };
    } else if (state.target === "clipboard") {
        destination = { kind: "clipboard" };
    } else if (state.target === "file" && rows.length === 1) {
        // One file: its folder, and its name as the output of the one row.
        const { folder, name } = splitPath(state.path.trim());
        destination = { kind: "directory", path: folder };
        rows = [{ ...rows[0]!, output: name }];
    } else {
        // A folder; with several rows "File" also means one file per collection.
        destination = { kind: "directory", path: state.target === "file" ? splitPath(state.path.trim()).folder : state.path.trim() };
    }
    const format: Doc = state.format === "csv"
        ? { kind: "csv", options: { ...state.csv } }
        : { kind: "json", notation: state.json.notation, layout: state.json.layout };
    return {
        connectionId: state.connectionId,
        destination,
        format,
        items: rows.map(row => ({
            database: row.database,
            collection: row.collection,
            output: row.output.trim(),
            filter: filterValue(row.filter) ?? null,
            columns: state.format === "csv" ? state.columns[columnsKey(row)] ?? null : null
        }))
    };
}
