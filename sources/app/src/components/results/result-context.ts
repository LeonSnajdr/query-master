import { createContext } from "@vuetify/v0";
import type { Ref } from "vue";
import { preferences } from "@/composables/appearance";
import { formatDate, groupDigits, legacyUuidText } from "@/shell/display";
import { isDoc, scalar, typeOf } from "@/shell/ejson";
import type { Json } from "@/shell/ejson";
import type { MenuEntry } from "@/menu";
import type { ValueField } from "@/shell/values";

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
    /** The field chosen in the selected document; empty for the document itself. */
    selectedPath: Ref<string>;
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
    /** The field of a value at a dotted path, for the values to suggest when it is edited. */
    suggest?: (path: string) => ValueField | undefined;
    /**
     * The table shows the documents at this path (stepped into a field); empty at the top. Kept
     * here so the toolbar can draw the way back without the table moving.
     */
    tableStack: Ref<string[]>;
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

/**
 * A value as the display settings want it: dates in their zone and
 * format, numbers with thousands separators, binary subtype 3 as the UUID of a driver.
 * `undefined` where the settings change nothing, so the caller shows the value as before.
 */
export function settingText(value: Json, locale: string): string | undefined {
    const type = typeOf(value);
    if (type === "date" && isDoc(value)) {
        const milliseconds = Number((value.$date as { $numberLong?: string } | undefined)?.$numberLong ?? Date.parse(String(value.$date)));
        return Number.isNaN(milliseconds) ? undefined : formatDate(milliseconds, preferences.dateFormat, preferences.timeZone, locale);
    }
    if (preferences.numberGrouping && (type === "int" || type === "long" || type === "double" || type === "decimal")) {
        const digits = typeof value === "number" ? String(value) : isDoc(value) ? String(value.$numberInt ?? value.$numberLong ?? value.$numberDouble ?? value.$numberDecimal ?? "") : "";
        return groupDigits(digits, locale);
    }
    if (type === "binary" && isDoc(value)) {
        const binary = value.$binary as { base64?: string; subType?: string } | undefined;
        if (binary?.subType === "03" && binary.base64) return legacyUuidText(binary.base64, preferences.legacyUuid);
    }
    return undefined;
}
