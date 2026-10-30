import type { ExportProgress } from "@/api";

/** A row's progress while an export or import runs. */
export interface RowProgress {
    state: "waiting" | "running" | "done" | "failed" | "stopped";
    done: number;
    /** The documents there are to do, when the server counted them. */
    total?: number;
    /** How much is done, from 0 to 1, when that is known. */
    share?: number;
    /** The message of a failure, ready to show. */
    error?: string;
}

export function waitingRows(count: number): RowProgress[] {
    return Array.from({ length: count }, () => ({ state: "waiting", done: 0 }));
}

/** An update of the Rust side into the row; `message` turns its error into text. */
export function applyProgress(rows: RowProgress[], update: ExportProgress, message: (error: unknown) => string) {
    const row = rows[update.item];
    if (!row) return;
    row.state = update.state;
    row.done = update.done;
    row.total = update.total ?? undefined;
    row.share = update.share ?? undefined;
    row.error = update.error ? message(update.error) : undefined;
}

/** How far a row is, from 0 to 1: a row that ended counts as whole, one at work by its share. */
export function rowShare(row: RowProgress): number {
    if (row.state === "waiting") return 0;
    if (row.state === "running") return row.share ?? 0;
    return 1;
}

/** How far the whole run is, the rows weighed alike; with the rows that ended and the documents so far. */
export function overall(rows: RowProgress[]): { share: number; finished: number; documents: number } {
    const finished = rows.filter(row => row.state !== "waiting" && row.state !== "running").length;
    const share = rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + rowShare(row), 0) / rows.length;
    return { share, finished, documents: rows.reduce((sum, row) => sum + row.done, 0) };
}
