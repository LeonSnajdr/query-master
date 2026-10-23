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
/** How documents go into a collection; paste: overwrite, always a new `_id`, a new one only when taken, or leave out what is taken. */
export const INSERT_MODES = ["overwrite", "newId", "newIdOnConflict", "skipExisting"] as const;
export type InsertMode = typeof INSERT_MODES[number];

/** The settings of the CSV page. */
export interface CsvSettings {
    delimiter: "," | ";" | "\t" | " ";
    quote: "\"" | "'";
    header: boolean;
    nullEmpty: boolean;
    escapeStrings: boolean;
}

export const DEFAULT_CSV: CsvSettings = { delimiter: ",", quote: "\"", header: true, nullEmpty: true, escapeStrings: false };

/** The SQL dialects of the SQL page; the names as the Rust side takes them. */
export const SQL_DIALECTS = ["mySql", "msSql", "oracle", "postgreSql"] as const;
export type SqlDialect = typeof SQL_DIALECTS[number];

/** The settings of the SQL page. */
export interface SqlSettings {
    dialect: SqlDialect;
    /** *Target schema or db*, put before the table name; empty for none. */
    schema: string;
    createTable: boolean;
    dropTable: boolean;
}

//: CREATE and DROP TABLE both on.
export const DEFAULT_SQL: SqlSettings = { dialect: "mySql", schema: "", createTable: true, dropTable: true };

/** The formats whose columns are chosen on the schema page. */
export function hasColumns(format: ExportFormat): boolean {
    return format === "csv" || format === "sql";
}

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
    /** Into a database: the target collection is replaced instead of added to. */
    replace?: boolean;
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
    sql: SqlSettings;
    /** CSV and SQL columns (dotted paths) per collection, as `database.collection`; none: the fields of the first level. */
    columns: Record<string, string[]>;
    /** Names of renamed columns per collection (`database.collection` → path → name). */
    names: Record<string, Record<string, string>>;
    database: { connectionId: string; database: string; insertMode: InsertMode; copyIndexes: boolean };
}

const EXTENSIONS: Record<Exclude<ExportFormat, "database">, string> = { json: "json", csv: "csv", sql: "sql" };

/** A name as a file name: characters Windows forbids become `_`. */
export function fileName(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, "_");
}

/** The output a row gets by default: `db.collection.json`, or the collection's own name. */
export function defaultOutput(format: ExportFormat, database: string, collection: string): string {
    return format === "database" ? collection : fileName(`${database}.${collection}.${EXTENSIONS[format]}`);
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

/** What the wizard keeps between runs (`transfer_preset`): the folder and the options of each format. */
export interface ExportPreset {
    folder: string;
    json: ExportState["json"];
    csv: CsvSettings;
    sql: SqlSettings;
    insertMode: InsertMode;
    copyIndexes: boolean;
}

/**
 * A collection of the server itself, as `system.profile` or `system.views`: written by the server,
 * no target of an import.
 */
export function isSystemCollection(name: string): boolean {
    return name.trim().startsWith("system.");
}

/** One of the allowed values, or the fallback. */
export function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}

function field(value: unknown, key: string): unknown {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function flag(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

/** The preset as stored; anything missing or unknown (an older version wrote it) takes the default. */
export function readExportPreset(value: unknown): ExportPreset {
    const json = field(value, "json");
    const csv = field(value, "csv");
    const sql = field(value, "sql");
    const folder = field(value, "folder");
    const schema = field(sql, "schema");
    return {
        folder: typeof folder === "string" ? folder : "",
        json: {
            notation: oneOf(field(json, "notation"), ["shell", "relaxed", "canonical"] as const, "shell"),
            layout: oneOf(field(json, "layout"), ["lines", "comma", "array"] as const, "lines")
        },
        csv: {
            delimiter: oneOf(field(csv, "delimiter"), [",", ";", "\t", " "] as const, DEFAULT_CSV.delimiter),
            quote: oneOf(field(csv, "quote"), ["\"", "'"] as const, DEFAULT_CSV.quote),
            header: flag(field(csv, "header"), DEFAULT_CSV.header),
            nullEmpty: flag(field(csv, "nullEmpty"), DEFAULT_CSV.nullEmpty),
            escapeStrings: flag(field(csv, "escapeStrings"), DEFAULT_CSV.escapeStrings)
        },
        sql: {
            dialect: oneOf(field(sql, "dialect"), SQL_DIALECTS, DEFAULT_SQL.dialect),
            schema: typeof schema === "string" ? schema : "",
            createTable: flag(field(sql, "createTable"), DEFAULT_SQL.createTable),
            dropTable: flag(field(sql, "dropTable"), DEFAULT_SQL.dropTable)
        },
        insertMode: oneOf(field(value, "insertMode"), INSERT_MODES, "overwrite"),
        copyIndexes: flag(field(value, "copyIndexes"), true)
    };
}

/** The preset after a run; the folder stays the one before when the run wrote none. */
export function exportPreset(state: ExportState, before: ExportPreset): ExportPreset {
    let folder = before.folder;
    if (state.format !== "database" && state.target === "directory") folder = state.path.trim();
    else if (state.format !== "database" && state.target === "file") folder = splitPath(state.path.trim()).folder || folder;
    return {
        folder,
        json: { ...state.json },
        csv: { ...state.csv },
        sql: { ...state.sql },
        insertMode: state.database.insertMode,
        copyIndexes: state.database.copyIndexes
    };
}

/** The folder of a file path, and its name. */
export function splitPath(path: string): { folder: string; name: string } {
    const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
    return cut === -1 ? { folder: "", name: path } : { folder: path.slice(0, cut), name: path.slice(cut + 1) };
}

/** The names of the chosen columns of a row's collection, when one of them was renamed; else none. */
export function columnNames(state: ExportState, row: { database: string; collection: string }): string[] | null {
    const key = columnsKey(row);
    const columns = state.columns[key];
    const renamed = state.names[key] ?? {};
    if (!columns || !columns.some(path => renamed[path]?.trim())) return null;
    return columns.map(path => renamed[path]?.trim() || (state.format === "sql" ? path.replaceAll(".", "_") : path));
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
    let format: Doc;
    if (state.format === "csv") format = { kind: "csv", options: { ...state.csv } };
    else if (state.format === "sql") format = { kind: "sql", options: { ...state.sql, schema: state.sql.schema.trim() } };
    else format = { kind: "json", notation: state.json.notation, layout: state.json.layout };
    return {
        connectionId: state.connectionId,
        destination,
        format,
        items: rows.map(row => ({
            database: row.database,
            collection: row.collection,
            output: row.output.trim(),
            filter: filterValue(row.filter) ?? null,
            columns: hasColumns(state.format) ? state.columns[columnsKey(row)] ?? null : null,
            names: hasColumns(state.format) ? columnNames(state, row) : null,
            replace: state.format === "database" && row.replace === true
        }))
    };
}
