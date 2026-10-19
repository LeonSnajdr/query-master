/** What counts as a row: the items of a tree, a list box or a table. */
export const ROWS = "[role=treeitem], [role=option], [role=row]";

/** Whether a click hit the free space of a list, outside every row (an element matching `rows`). */
export function isFreeSpace(event: Pick<MouseEvent, "target">, rows = ROWS): boolean {
    const target = event.target as { closest?: (selector: string) => unknown } | null;
    return !target?.closest?.(rows);
}

/**
 * Clicks on the free space of a list or tree, handled as Windows Explorer does: a left or a right
 * click outside every row takes the selection away, and the right click then opens the menu of
 * the space, not that of the row chosen before. Bind `onClick` and `onContextMenu` on the element
 * that holds the rows; a click on a row is left to the row.
 */
export function useFreeSpace(clear: () => void, options: { menu?: (event: MouseEvent) => void; rows?: string } = {}) {
    const rows = options.rows ?? ROWS;
    return {
        onClick(event: MouseEvent) {
            if (isFreeSpace(event, rows)) clear();
        },
        onContextMenu(event: MouseEvent) {
            if (!isFreeSpace(event, rows)) return;
            event.preventDefault();
            clear();
            options.menu?.(event);
        }
    };
}
