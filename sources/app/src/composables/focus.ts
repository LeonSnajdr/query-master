/**
 * "Set focus to …" of the View menu (F4, F6, F7): the keyboard goes to the database tree, the
 * editor or the results of the tab in front.
 */
export function useFocusAreas() {
    /** The panel of the tab in front; the others are kept but hidden. */
    function shownPanel(): HTMLElement | undefined {
        return [...document.querySelectorAll<HTMLElement>("[data-testid=tab-panel]")].find(panel => panel.offsetParent !== null);
    }

    /** The selected row of the tree, else its first one. */
    function focusTree(): void {
        const tree = document.querySelector<HTMLElement>("aside [role=tree]");
        const row = tree?.querySelector<HTMLElement>(".tree-row-on, .tree-row-marked") ?? tree?.querySelector<HTMLElement>("[role=treeitem]");
        row?.focus();
    }

    /** The first editor of the tab: the query of a shell, the filter of a browse tab. */
    function focusEditor(): void {
        shownPanel()?.querySelector<HTMLElement>(".cm-content[contenteditable=true]")?.focus();
    }

    function focusResults(): void {
        shownPanel()?.querySelector<HTMLElement>("[data-testid=query-result]")?.focus();
    }

    return { focusTree, focusEditor, focusResults };
}
