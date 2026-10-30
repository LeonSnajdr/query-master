/** Where typing starts in a dialog or a tab: a field, a text area, an editor. Buttons never. */
const FIELDS = [
    "input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not(:disabled):not([readonly])",
    "textarea:not(:disabled):not([readonly])",
    ".cm-content[contenteditable=true]"
].join(", ");

/**
 * Puts the focus where work starts in `root`: the element marked `data-autofocus`, else the first
 * field. A text that is there already is selected, so typing replaces it. Nothing to type in:
 * the focus stays where it is.
 */
export function focusStart(root: ParentNode | null | undefined): boolean {
    // Hidden fields (a closed part, a picker's input) are passed over.
    const shown = (selector: string) => [...(root?.querySelectorAll<HTMLElement>(selector) ?? [])].find(element => element.offsetParent !== null);
    const target = shown("[data-autofocus]") ?? shown(FIELDS);
    if (!target) return false;
    target.focus();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) target.select();
    return true;
}

/**
 * Every modal dialog of the app starts with the focus in its first field, unless the dialog put
 * it somewhere itself (a confirmation on Cancel, the palette in its search). Without this the
 * browser focuses the dialog itself, and typing goes nowhere.
 */
export function watchDialogFocus(): () => void {
    const observer = new MutationObserver((changes) => {
        for (const change of changes) {
            const dialog = change.target;
            if (!(dialog instanceof HTMLDialogElement) || !dialog.open) continue;
            setTimeout(() => {
                const active = document.activeElement;
                if (active && active !== dialog && dialog.contains(active)) return;
                focusStart(dialog);
            });
        }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
}
