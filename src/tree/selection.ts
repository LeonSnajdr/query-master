import type { TreeSelection } from "@/stores/connections";

/**
 * The rows of a multiple selection in the tree, as in Explorer, VS Code or DataGrip: a click
 * selects one row, Ctrl adds or takes away one, Shift takes the rows between the anchor and the
 * clicked one. All rows of a selection are of one kind (connections, databases, collections or
 * indexes) and, below the connection, of one connection (indexes: of one collection), so that
 * every action in its menu can act on all of them.
 */
export type RowKind = "connection" | "database" | "collection" | "index";

export function kindOf(at: TreeSelection): RowKind {
    if (at.index !== undefined) return "index";
    if (at.collection !== undefined) return "collection";
    return at.database === undefined ? "connection" : "database";
}

export function keyOf(at: TreeSelection): string {
    return JSON.stringify([at.connectionId, at.database ?? null, at.collection ?? null, at.index ?? null]);
}

/** The row a key stands for; the tree carries the keys of its rows in `data-row`. */
export function rowOf(key: string): TreeSelection {
    const [connectionId, database, collection, index] = JSON.parse(key) as [string, string | null, string | null, string | null];
    return {
        connectionId,
        ...(database === null ? {} : { database }),
        ...(collection === null ? {} : { collection }),
        ...(index === null ? {} : { index })
    };
}

export function sameRow(a: TreeSelection | undefined, b: TreeSelection | undefined): boolean {
    return a !== undefined && b !== undefined && keyOf(a) === keyOf(b);
}

/** Whether two rows may be selected together. */
export function together(a: TreeSelection, b: TreeSelection): boolean {
    const kind = kindOf(a);
    if (kind !== kindOf(b)) return false;
    if (kind === "connection") return true;
    if (a.connectionId !== b.connectionId) return false;
    return kind !== "index" || (a.database === b.database && a.collection === b.collection);
}

/** The rows after a click on `at`; `rows` are the rows of the tree as shown, top to bottom. */
export function click(
    current: { rows: TreeSelection[]; anchor?: TreeSelection },
    at: TreeSelection,
    mode: "single" | "toggle" | "range",
    rows: TreeSelection[]
): { rows: TreeSelection[]; anchor: TreeSelection } {
    const anchor = current.anchor;
    if (mode === "toggle" && anchor && together(anchor, at)) {
        const without = current.rows.filter(row => !sameRow(row, at));
        if (without.length < current.rows.length) return { rows: without.length > 0 ? without : [at], anchor: at };
        return { rows: [...current.rows, at], anchor: at };
    }
    if (mode === "range" && anchor && together(anchor, at)) {
        const from = rows.findIndex(row => sameRow(row, anchor));
        const to = rows.findIndex(row => sameRow(row, at));
        if (from >= 0 && to >= 0) {
            const between = rows.slice(Math.min(from, to), Math.max(from, to) + 1).filter(row => together(anchor, row));
            // The anchor stays where it was, so the next Shift click measures from it again.
            return { rows: between, anchor };
        }
    }
    return { rows: [at], anchor: at };
}

/** Ctrl+A: every row shown beside `at`, below the same parent (the collections of its database …). */
export function all(at: TreeSelection, rows: TreeSelection[]): TreeSelection[] {
    return rows.filter(row => together(at, row) && (kindOf(at) !== "collection" || row.database === at.database));
}
