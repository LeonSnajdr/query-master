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
    /** A click on a document: Ctrl adds or takes it away, Shift marks the range, else it alone. */
    choose: (index: number, event?: MouseEvent) => void;
    /** Counts up to unfold (`open`) or fold all documents, or the one at `index`. */
    fold: Ref<{ version: number; open: boolean; index?: number }>;
    /** Writes a value typed in place; the text is in shell notation. */
    commit: (target: ResultTarget, text: string) => void;
    /** Opens the context menu of a value; a view adds its own entries with `extra`. */
    menu: (event: MouseEvent, target: ResultTarget, extra?: MenuEntry[]) => void;
    /** Opens the document to view or edit (double click on a row). */
    open: (index: number) => void;
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
