import type { Doc } from "@/shell/ejson";
import { isSystemCollection, oneOf, splitPath } from "./export";
import type { InsertMode } from "./export";

/** The two kinds of import, as the tiles of the wizard. */
export const IMPORT_FORMATS = ["json", "csv"] as const;
export type ImportFormat = typeof IMPORT_FORMATS[number];

export type EmptyFields = "null" | "emptyString" | "omit";

/** The settings of the CSV page of the import. */
export interface CsvReadSettings {
    delimiter: "," | ";" | "\t" | " ";
    quote: "\"" | "'";
    /** Rows before the data or the row of names, 0 to 10. */
    skipRows: number;
    empty: EmptyFields;
    header: boolean;
    unescape: boolean;
}

export const DEFAULT_CSV_READ: CsvReadSettings = { delimiter: ",", quote: "\"", skipRows: 0, empty: "null", header: true, unescape: false };

/** The types a CSV column can be read as; the names as the Rust side takes them. */
export const COLUMN_TYPES = ["auto", "string", "int", "long", "double", "decimal", "bool", "date", "objectId"] as const;
export type ColumnType = typeof COLUMN_TYPES[number];

/** A column of a CSV file: the field it becomes (dotted paths make sub documents), its type, and whether it is read. */
export interface CsvColumn {
    name: string;
    type: ColumnType;
    include: boolean;
}

/** A row of the wizard: a file and the collection it goes into. */
export interface ImportRow {
    path: string;
    database: string;
    collection: string;
    /** What happens to a document whose `_id` is in the collection already. */
    mode: InsertMode;
}

export interface ImportState {
    connectionId: string;
    format: ImportFormat;
    rows: ImportRow[];
    csv: CsvReadSettings;
    /** The columns of each file as the schema page left them, by path; none: names of the first row, typed as they come. */
    columns: Record<string, CsvColumn[]>;
}

const EXTENSIONS: Record<ImportFormat, string[]> = { json: ["json", "jsonl", "ndjson", "txt"], csv: ["csv", "tsv", "txt"] };

/** The format a file looks like by its extension. */
export function formatOf(path: string): ImportFormat | undefined {
    const extension = splitPath(path).name.split(".").pop()?.toLowerCase() ?? "";
    return IMPORT_FORMATS.find(format => EXTENSIONS[format].includes(extension));
}

/**
 * Where a file goes by default. A name as the export writes it, `database.collection.json`, gives
 * both: a database name holds no dot, so the first dot ends it, and the collection keeps the rest
 * (`shop.orders.archive.json` → `shop`, `orders.archive`). A name without one goes into the
 * given database, as a collection of the name without extension.
 */
export function rowFor(path: string, fallbackDatabase: string): ImportRow {
    const name = splitPath(path).name;
    const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
    const dot = stem.indexOf(".");
    if (dot > 0 && dot < stem.length - 1) return { path, database: stem.slice(0, dot), collection: stem.slice(dot + 1), mode: "overwrite" };
    return { path, database: fallbackDatabase, collection: stem, mode: "overwrite" };
}

/** Problems that keep the wizard from starting, as i18n keys with the row they belong to. */
export function importProblems(state: ImportState): { key: string; row?: number }[] {
    const problems: { key: string; row?: number }[] = [];
    if (!state.connectionId) problems.push({ key: "import.problem.noServer" });
    if (state.rows.length === 0) problems.push({ key: "import.problem.noRows" });
    state.rows.forEach((row, index) => {
        if (!row.database.trim()) problems.push({ key: "import.problem.noDatabase", row: index });
        if (!row.collection.trim()) problems.push({ key: "import.problem.noCollection", row: index });
        else if (isSystemCollection(row.collection) || row.collection.includes("$")) problems.push({ key: "import.problem.badCollection", row: index });
    });
    return problems;
}

/** The job as the Rust side takes it (`src-tauri/src/transfer/import_job.rs`). */
export function importJob(state: ImportState): Doc {
    return {
        connectionId: state.connectionId,
        format: state.format === "csv" ? { kind: "csv", options: csvOptions(state.csv) } : { kind: "json" },
        items: state.rows.map(row => ({
            path: row.path,
            database: row.database.trim(),
            collection: row.collection.trim(),
            mode: row.mode,
            columns: state.format === "csv" ? (state.columns[row.path] as unknown as Doc[] | undefined) ?? null : null
        }))
    };
}

/** What the wizard keeps between runs (`transfer_preset`): the CSV settings. */
export interface ImportPreset {
    csv: CsvReadSettings;
}

/** The preset as stored; anything missing or unknown takes the default. */
export function readImportPreset(value: unknown): ImportPreset {
    const csv = typeof value === "object" && value !== null ? (value as { csv?: unknown }).csv : undefined;
    const field = (key: string) => (typeof csv === "object" && csv !== null ? (csv as Record<string, unknown>)[key] : undefined);
    const flag = (key: string, fallback: boolean) => (typeof field(key) === "boolean" ? field(key) as boolean : fallback);
    const skipRows = field("skipRows");
    return {
        csv: {
            delimiter: oneOf(field("delimiter"), [",", ";", "\t", " "] as const, DEFAULT_CSV_READ.delimiter),
            quote: oneOf(field("quote"), ["\"", "'"] as const, DEFAULT_CSV_READ.quote),
            skipRows: typeof skipRows === "number" && Number.isInteger(skipRows) && skipRows >= 0 && skipRows <= 10 ? skipRows : 0,
            empty: oneOf(field("empty"), ["null", "emptyString", "omit"] as const, DEFAULT_CSV_READ.empty),
            header: flag("header", DEFAULT_CSV_READ.header),
            unescape: flag("unescape", DEFAULT_CSV_READ.unescape)
        }
    };
}

/** The settings as the Rust side takes them; the rows to skip as a whole number from 0 to 10. */
export function csvOptions(settings: CsvReadSettings): Doc {
    return { ...settings, skipRows: Math.min(10, Math.max(0, Math.trunc(Number(settings.skipRows) || 0))) };
}
