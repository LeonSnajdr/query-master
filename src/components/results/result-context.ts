import { createContext } from "@vuetify/v0";
import type { Ref } from "vue";
import { isDoc, scalar } from "@/shell/ejson";
import type { Json } from "@/shell/ejson";
import type { MenuEntry } from "@/menu";

/** A value in a result: the document it belongs to and the dotted path to it (empty for the document). */
export interface ResultTarget {
    /** Index of the document on the page. */
    index: number;
    path: string;
    value: Json;
}

/** What the views of a result share with the panel around them. */
export interface ResultContext {
    /** Values can be changed in place. */
    editable: Ref<boolean>;
    /** Index of the selected document on the page. */
    selected: Ref<number | undefined>;
    /** Indexes of the documents marked together (Ctrl or Shift click); the selected one among them. */
    marked: Ref<Set<number>>;
    /**
     * A click on a document or a field in it (`path`, empty for the document): Ctrl adds the
     * document or takes it away, Shift marks the range, else it alone.
     */
    choose: (index: number, event?: MouseEvent, path?: string) => void;
    /** Counts up to unfold (`open`) or fold; see `Fold`. */
    fold: Ref<Fold>;
    /** Dotted paths of the fields the tree shows first in their document ("Pin field", Ctrl+P). */
    pinned: Ref<string[]>;
    /** Writes a value typed in place; the text is in shell notation. */
    commit: (target: ResultTarget, text: string) => void;
    /** Opens the context menu of a value; a view adds its own entries with `extra`. */
    menu: (event: MouseEvent, target: ResultTarget, extra?: MenuEntry[]) => void;
    /** Opens the document to view or edit (double click on a row). */
    open: (index: number) => void;
}

/**
 * What to unfold or fold: every document (no `index`), one document (`index`), or with `path` the
 * node there and everything below it, also what unfolds only then ("Expand node recursively").
 */
export interface Fold {
    version: number;
    open: boolean;
    index?: number;
    path?: string;
}

/** The fold reaches the line at `path` of the document at `index`. */
export function foldReaches(fold: Fold, index: number, path: string): boolean {
    if (fold.index !== undefined && fold.index !== index) return false;
    return fold.path === undefined || fold.path === "" || path === fold.path || path.startsWith(`${fold.path}.`);
}

/** A fold that reaches no line: taken after a new result, so that it unfolds nothing of it. */
export function noFold(version: number): Fold {
    return { version, open: false, index: -1 };
}

export const [useResultContext, provideResultContext] = createContext<ResultContext>("querymaster:result");

/** A value as results show it: strings without quotes, ids and dates without their wrapper. */
export function displayText(value: Json): string {
    if (typeof value === "string") return value;
    if (isDoc(value)) {
        if (typeof value.$oid === "string") return value.$oid;
        const leaf = scalar(value);
        if (leaf?.type === "date") return leaf.text.slice(9, -2);
    }
    return scalar(value)?.text ?? "";
}

/** Date and time as the language of the app writes them; the tree and the table show dates so. */
export function dateFormat(locale: string): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * A date as `format` writes it: date and time side by side, without the comma
 * some locales put between. `undefined` for a value that is no date, or one out of range.
 */
export function dateText(value: Json, format: Intl.DateTimeFormat): string | undefined {
    if (!isDoc(value) || scalar(value)?.type !== "date") return undefined;
    const milliseconds = Number((value.$date as { $numberLong?: string } | undefined)?.$numberLong ?? value.$date);
    return Number.isNaN(milliseconds) ? undefined : format.format(milliseconds).replace(", ", " ");
}
