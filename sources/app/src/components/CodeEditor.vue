<script setup lang="ts">
import { autocompletion, closeBrackets, closeBracketsKeymap, completeFromList, completionKeymap, completionStatus, snippet, startCompletion } from "@codemirror/autocomplete";
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript, localCompletionSource, snippets } from "@codemirror/lang-javascript";
import { sql } from "@codemirror/lang-sql";
import { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import type { Extension, Range } from "@codemirror/state";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Decoration, EditorView, ViewPlugin, crosshairCursor, drawSelection, highlightActiveLine, keymap, lineNumbers, placeholder as placeholderText, rectangularSelection, showTooltip } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { preferences } from "@/composables/appearance";
import { useMessages } from "@/composables/messages";
import { codeMirrorKey } from "@/keys/hotkey";
import { useKeymap } from "@/keys/keymap";
import { scriptPlace, suggest, valueDetail, valuePlace } from "@/shell/complete";
import type { Environment, Suggestion, SuggestionType, ValuePlace } from "@/shell/complete";
import { toDraft } from "@/shell/edit";
import { formatCode } from "@/shell/format";
import type { FormatKind } from "@/shell/format";
import type { Json } from "@/shell/ejson";
import type { ValueField } from "@/shell/values";

const emit = defineEmits<{
    /** The run keys (Ctrl+Enter, F5; in a single line also Enter): run, with the cursor and the selected text. */
    run: [position: number, selection: string];
    /** A value of `valueField` was chosen from the list; its text is in the editor. */
    pick: [value: Json];
}>();
/** An editor for shell code: a script, one field of a query, or a result to read. */
const props = defineProps<{
    label: string;
    /** What to complete with; without it nothing is suggested. */
    environment?: Environment;
    /** Code the text continues, for suggestions: a query field is the argument of a `find(`. */
    prefix?: string;
    /** One line without line numbers. */
    singleLine?: boolean;
    readonly?: boolean;
    /** Place of an error to show the cursor at. */
    errorPosition?: number;
    /** SQL instead of shell code: keywords, and the collections with their fields to suggest. */
    sqlSchema?: Record<string, string[]>;
    /**
     * The text is one value of this field, without quotes (the result tree and table edit it so):
     * its known values are suggested as they are in a filter, with the search of all data. The
     * list opens at once, with all values until something is typed.
     */
    valueField?: ValueField;
    /** Without room above and below the line, to fit a row of the result. */
    compact?: boolean;
    /** The font of the row it edits in (a cell of the table), not that of the editors. */
    inheritFont?: boolean;
    /**
     * As high as its text (wrapped, at most six lines), never a scroll bar across: for a value
     * edited in a cell. The list of suggestions opens below the whole field, not below the line.
     */
    grow?: boolean;
    /** The find and replace bar (Ctrl+F) and go to line: for editors with room for it (shell, SQL, text). */
    findBar?: boolean;
    /** Text shown grey while the editor is empty. */
    placeholder?: string;
    /** Test id of the editable text. */
    testid?: string;
    /**
     * How the text is formatted (Shift+Alt+F): by default SQL with a schema, one value where the
     * text continues a `prefix` (a stage, a query field), else a script; `none` for none. (Not
     * `false`: Vue would take a missing prop of a boolean type for `false`.)
     */
    formatAs?: FormatKind | "none";
}>();

const text = defineModel<string>({ required: true });

/** The language part, swapped when the SQL schema (collections, fields) becomes known. */
const language = new Compartment();
/** The run keys, swapped when they are changed in the settings. */
const runKeys = new Compartment();
/** The keys that format, swapped when they are changed in the settings. */
const formatKeys = new Compartment();
const shortcuts = useKeymap();

function runKeymap(): Extension {
    const keys = shortcuts.keys("query.run").map(codeMirrorKey).filter((key): key is string => key !== undefined);
    return keymap.of([...keys.map(key => ({ key, run })), ...(props.singleLine ? [{ key: "Enter", run }] : [])]);
}

/** What the text is, for formatting; `undefined` where it is not formatted (one line, read only, one value of a field). */
function formatKind(): FormatKind | undefined {
    if (props.formatAs === "none" || props.readonly || props.singleLine || props.valueField) return undefined;
    if (props.formatAs) return props.formatAs;
    if (props.sqlSchema) return "sql";
    return props.prefix === undefined ? "script" : "value";
}

/**
 * Formats the text, the cursor at the same place in the code. Undo takes it back in one step. A
 * mistake in the text is reported with its place and the text stays.
 */
async function format(target = view): Promise<boolean> {
    const kind = formatKind();
    if (!target || !kind) return false;
    const before = target.state.doc.toString();
    try {
        const result = await formatCode(before, kind, target.state.selection.main.head);
        // Typed on meanwhile: that is not overwritten.
        if (result.text === before || target.state.doc.toString() !== before) return true;
        target.dispatch({ changes: { from: 0, to: before.length, insert: result.text }, selection: { anchor: Math.min(result.cursor, result.text.length) }, scrollIntoView: true, userEvent: "format" });
    } catch (error) {
        report(error);
    }
    return true;
}

function formatKeymap(): Extension {
    if (!formatKind()) return [];
    const keys = shortcuts.keys("editor.format").map(codeMirrorKey).filter((key): key is string => key !== undefined);
    return keymap.of(keys.map(key => ({
        key,
        run: (target: EditorView) => {
            void format(target);
            return true;
        }
    })));
}

function languageExtension(): Extension {
    if (props.valueField) return [];
    return props.sqlSchema ? sql({ schema: props.sqlSchema, upperCaseKeywords: true }) : javascript();
}
const { say, report } = useMessages();
const { t } = useI18n();

/** The words of the find bar and of go to line, in the language of the app. */
function searchPhrases(): Record<string, string> {
    const keys = ["Find", "Replace", "next", "previous", "all", "match case", "regexp", "by word", "replace", "replace all", "close", "Go to line", "go", "current match", "on line", "replaced match on line $", "replaced $ matches"];
    return Object.fromEntries(keys.map(key => [key, t(`editor.search.${key.replace(/[^a-z]+/gi, "_")}`)]));
}
const host = useTemplateRef<HTMLDivElement>("host");
let view: EditorView | undefined;

/** The icons CodeMirror draws for its completion types. */
const ICONS: Record<SuggestionType, string> = {
    method: "method",
    collection: "class",
    database: "namespace",
    field: "property",
    operator: "keyword",
    stage: "function",
    option: "property",
    value: "constant",
    variable: "variable"
};

function completion(item: Suggestion): Completion {
    return {
        label: item.label,
        type: ICONS[item.type],
        detail: item.detail === undefined ? undefined : say(item.detail),
        // Translated when the list is built: it is built anew on every request.
        info: item.info?.map(say).join(" "),
        boost: item.boost,
        apply: item.snippet ? snippet(item.snippet) : item.apply
    };
}

function complete(context: CompletionContext): CompletionResult | null {
    if (!props.environment) return null;
    const prefix = props.prefix ?? "";
    // The environment is read on every call: fields arrive after the first request for them.
    const found = suggest(prefix + context.state.sliceDoc(0, context.pos), props.environment);
    if (!found || found.from < prefix.length || (!found.auto && !context.explicit)) return null;
    return { from: found.from - prefix.length, options: found.options.map(completion), validFor: /^[\w$.-]*$/ };
}

/** Keywords as JavaScript completes them: `for`, `if`, `function` … with their brackets. */
const completeKeywords = completeFromList(snippets);

/** Where JavaScript completes by itself in a whole script; not in a field that continues a `prefix`. */
function scriptPlaceAt(context: CompletionContext): ReturnType<typeof scriptPlace> {
    if (!props.environment || props.prefix !== undefined || props.singleLine) return undefined;
    return scriptPlace(context.state.sliceDoc(0, context.pos));
}

/** Variables and functions the script declares, wherever a value can stand. */
const completeVariables: CompletionSource = context => (scriptPlaceAt(context) ? localCompletionSource(context) : null);

/** Keywords where a statement starts. */
const completeStatement: CompletionSource = context => (scriptPlaceAt(context) === "statement" ? completeKeywords(context) : null);

/** How all data is searched: for the one field, or for the shell code. */
const searcher = () => (props.valueField ? props.valueField.search : props.environment?.search);

/** Something was typed since the editor opened: the list of one field's values then filters. */
let touched = false;

/** The value of a field at `position`, where the editor can search all data for values. */
function searchPlace(state: EditorState, position: number): ValuePlace | undefined {
    if (!searcher()) return undefined;
    if (props.valueField) {
        // Untouched, the text is the value as it was: the search is for all values.
        return { collection: props.valueField.collection, field: props.valueField.field, prefix: touched ? state.sliceDoc(0, position) : "", inString: true };
    }
    return valuePlace((props.prefix ?? "") + state.sliceDoc(0, position));
}

/**
 * The known values of `valueField`, the most frequent first, as a filter suggests them. Chosen, a
 * value replaces the whole text and brings its type along (`pick`).
 */
const completeValue: CompletionSource = (context) => {
    const field = props.valueField;
    const hints = field?.values?.(field.collection, field.field) ?? [];
    if (!field || hints.length === 0) return null;
    const options: Completion[] = hints.map((hint, rank) => {
        const text = toDraft(hint.value).text;
        return {
            label: text,
            type: ICONS.value,
            detail: valueDetail(hint),
            boost: Math.max(0, 30 - rank),
            apply: (target: EditorView) => {
                target.dispatch({ changes: { from: 0, to: target.state.doc.length, insert: text }, selection: { anchor: text.length } });
                emit("pick", hint.value);
            }
        };
    });
    return touched ? { from: 0, options } : { from: 0, to: context.state.doc.length, options, filter: false };
};

/** Searches all data for the values of the field at the cursor; the list shows them when found. */
function searchAll(view: EditorView): boolean {
    const search = searcher();
    const place = searchPlace(view.state, view.state.selection.main.head);
    if (!search || !place) return false;
    const reopen = () => {
        if (view.hasFocus) startCompletion(view);
    };
    void search.run(place.collection, place.field, place.prefix).then(reopen, report);
    // At once "Searching …" in the footer: the search state changed outside the editor.
    void Promise.resolve().then(() => {
        view.dispatch({});
        reopen();
    });
    return true;
}

function element(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/**
 * The footer of the list where a value of a field stands (as VS Code and JetBrains have one): not
 * an entry, so the arrows and Enter stay with the values. Left the search of all data (a click or
 * Ctrl+Space), right where the values come from or what the search found. `false` elsewhere.
 */
function renderSearchBar(dom: HTMLElement, view: EditorView): boolean {
    const search = searcher();
    const place = searchPlace(view.state, view.state.selection.main.head);
    dom.replaceChildren();
    if (!search || !place) return false;
    const state = search.state(place.collection, place.field, place.prefix);
    dom.title = state?.error ? say(state.error) : say({ key: "complete.search.info" });
    if (state?.running) {
        dom.append(element("span", "cm-searchAll-spin"), element("span", "cm-searchAll-running", say({ key: "complete.search.running" })));
        return true;
    }
    let label = place.prefix ? say({ key: "complete.search.prefix", params: { text: place.prefix } }) : say({ key: "complete.search.all" });
    if (state) label = say({ key: "complete.search.again" });
    const action = element("button", "cm-searchAll-action", `⌕ ${label}`) as HTMLButtonElement;
    action.type = "button";
    action.tabIndex = -1;
    action.dataset.testid = "search-all";
    // A press keeps the focus in the editor, as on an entry of the list.
    action.addEventListener("mousedown", (event) => {
        event.preventDefault();
        searchAll(view);
    });
    let status = say({ key: "complete.search.known" });
    let warn = false;
    if (state?.error) [status, warn] = [say({ key: "complete.search.failed" }), true];
    else if (state?.sampled) [status, warn] = [say({ key: "complete.search.sampled" }), true];
    else if (state?.truncated) status = say({ key: "complete.search.truncated", params: { count: state.hints.length } });
    else if (state) status = say({ key: "complete.search.found", params: { count: state.hints.length } });
    dom.append(action, element("kbd", "cm-searchAll-keys", say({ key: "complete.search.keys" })), element("span", warn ? "cm-searchAll-status cm-searchAll-warn" : "cm-searchAll-status", status));
    return true;
}

/** Puts the footer under the list of suggestions while one is open at a value of a field. */
const searchFooter = ViewPlugin.define((view) => {
    const footer = element("div", "cm-searchAll");
    footer.dataset.testid = "search-footer";
    const sync = () => {
        const list = view.dom.querySelector(".cm-tooltip-autocomplete");
        if (!list || !renderSearchBar(footer, view)) {
            footer.remove();
            return;
        }
        // The list puts a new <ul> at its end when its entries change: the footer stays last.
        if (list.lastElementChild !== footer) {
            list.appendChild(footer);
            view.requestMeasure();
        }
    };
    // After the update, when the list has drawn its entries.
    return { update: () => void setTimeout(sync), destroy: () => footer.remove() };
});

const showSearchBar = StateEffect.define<boolean>();

/**
 * The footer alone, for Ctrl+Space at a value of a field without any value to suggest: it is
 * hidden while a list shows, and goes when the text or the cursor changes, or with Esc.
 */
const searchBarAlone = StateField.define<boolean>({
    create: () => false,
    update(open, transaction) {
        for (const effect of transaction.effects) if (effect.is(showSearchBar)) return effect.value;
        return transaction.docChanged || transaction.selection ? false : open;
    },
    provide: field => showTooltip.from(field, open => (open
        ? {
                pos: 0,
                above: false,
                create: (view) => {
                    const dom = element("div", "cm-searchAll cm-searchAll-alone");
                    const render = () => {
                        const shown = renderSearchBar(dom, view) && completionStatus(view.state) === null;
                        dom.style.display = shown ? "" : "none";
                    };
                    render();
                    return { dom, update: render, positioned: render };
                }
            }
        : null))
});

const markError = StateEffect.define<number | undefined>();
const errorMark = Decoration.mark({ class: "cm-errorMark" });

/**
 * The place a run failed, underlined as a word processor marks a misspelling: the word there, or
 * one character. It goes when the text changes or the next run succeeds.
 */
const errorMarks = StateField.define({
    create: () => Decoration.none,
    update(marks, transaction) {
        for (const effect of transaction.effects) {
            if (!effect.is(markError)) continue;
            const position = effect.value;
            if (position === undefined) return Decoration.none;
            const doc = transaction.state.doc;
            const from = Math.min(position, doc.length);
            const word = transaction.state.wordAt(from);
            const to = word && word.from === from ? word.to : Math.min(from + 1, doc.length);
            const ranges: Range<Decoration>[] = from < to ? [errorMark.range(from, to)] : [];
            return Decoration.set(ranges);
        }
        return transaction.docChanged ? Decoration.none : marks;
    },
    provide: field => EditorView.decorations.from(field)
});

/** Ctrl+Space: with the list open at a value, search all data; else open it, with the footer alone where no value is known. */
function ctrlSpace(target: EditorView): boolean {
    if (completionStatus(target.state) === "active") return searchAll(target);
    if (searchPlace(target.state, target.state.selection.main.head)) target.dispatch({ effects: showSearchBar.of(true) });
    // The list's own key opens it as usual.
    return false;
}

function selected(state: EditorState): string {
    const range = state.selection.main;
    return state.sliceDoc(range.from, range.to);
}

function run(target: EditorView): boolean {
    emit("run", target.state.selection.main.head, selected(target.state));
    return true;
}

const highlight = HighlightStyle.define([
    { tag: [tags.string, tags.special(tags.string)], color: "var(--v0-code-string)" },
    { tag: tags.regexp, color: "var(--v0-code-type)" },
    { tag: [tags.number, tags.bool, tags.null], color: "var(--v0-code-number)" },
    { tag: [tags.keyword, tags.operatorKeyword], color: "var(--v0-code-keyword)" },
    { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "var(--v0-code-key)" },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--v0-code-call)", fontWeight: "600" },
    { tag: tags.comment, color: "var(--v0-code-comment)", fontStyle: "italic" }
]);

/**
 * Find (Ctrl+F), find again (F3), replace, go to line (Ctrl+Alt+G), all matches (Ctrl+Shift+L).
 * Without Ctrl+D, which saves the query (your decision of 18.10.2026).
 */
const EDITOR_SEARCH_KEYS = searchKeymap.filter(binding => binding.key !== "Mod-d");

const theme = EditorView.theme({
    "&": { height: "100%", fontSize: props.inheritFont ? "inherit" : "var(--editor-font-size, 13px)", color: "var(--v0-on-surface)", backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
    ...(props.inheritFont ? { "&.cm-editor .cm-scroller": { fontFamily: "inherit" } } : {}),
    // One line never scrolls up and down; a pixel of rounding would show a scroll bar otherwise,
    // and no room is kept for one.
    // Across it scrolls with the cursor, without a bar that would cover the one line.
    ".cm-scroller": {
        ...(props.singleLine ? { overflowY: "hidden", scrollbarGutter: "auto", scrollbarWidth: "none" } : {}),
        // The field is taller than the one line: the text stands in its middle, not at its top, as
        // that of the fields and cells beside it. CodeMirror's own rule is `!important`.
        ...((props.singleLine || props.compact) && !props.grow ? { alignItems: "center !important" } : {})
    },
    ...(props.grow
        ? {
                "&": { height: "auto", fontSize: props.inheritFont ? "inherit" : "var(--editor-font-size, 13px)", color: "var(--v0-on-surface)", backgroundColor: "transparent" },
                ".cm-scroller": { overflowX: "hidden", overflowY: "auto", maxHeight: "calc(6 * 1.4em)", scrollbarGutter: "auto", scrollbarWidth: "thin" },
                // The list below the field (or above it), never over the text: set from the field's edges.
                ".cm-tooltip.cm-tooltip-autocomplete:not(.cm-tooltip-above)": { transform: "translateY(var(--below-field, 0px))" },
                ".cm-tooltip.cm-tooltip-autocomplete.cm-tooltip-above": { transform: "translateY(var(--above-field, 0px))" }
            }
        : {}),
    ".cm-content": {
        caretColor: "var(--v0-primary)",
        padding: props.compact ? "0" : props.singleLine ? "5px 0" : "8px 0",
        // The one line is as high as it is, so the scroller can put it in the middle of the field
        // instead of letting it fill the height and stand at the top.
        ...((props.singleLine || props.compact) && !props.grow ? { minHeight: "0" } : {})
    },
    ".cm-line": { padding: props.singleLine ? "0 2px" : "0 6px" },
    ".cm-cursor": { borderLeftColor: "var(--v0-primary)" },
    ".cm-placeholder": { color: "var(--v0-on-surface-variant)", fontStyle: "italic", fontFamily: "\"Open Sans\", system-ui, sans-serif" },
    ".cm-errorMark": { textDecoration: "underline wavy var(--v0-error)", textUnderlineOffset: "3px", textDecorationSkipInk: "none" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--v0-on-surface-variant)", border: "none", paddingLeft: "8px" },
    ".cm-activeLine": { backgroundColor: props.readonly || props.singleLine ? "transparent" : "color-mix(in srgb, var(--v0-on-surface) 5%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--v0-on-surface-strong)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: "color-mix(in srgb, var(--v0-primary) 30%, transparent)"
    },
    "&.cm-focused .cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--v0-primary) 30%, transparent)", outline: "none" },
    ".cm-tooltip": {
        backgroundColor: "var(--v0-dock)",
        color: "var(--v0-on-surface-strong)",
        border: "1px solid var(--v0-divider)",
        borderRadius: "4px",
        boxShadow: "0 8px 24px rgb(0 0 0 / 0.35)",
        overflow: "hidden"
    },
    // Find and replace (Ctrl+F, Ctrl+H) and "go to line" (Ctrl+Alt+G), as panels above the text.
    ".cm-panels": { backgroundColor: "var(--v0-dock)", color: "var(--v0-on-surface)", fontFamily: "\"Open Sans\", system-ui, sans-serif", fontSize: "12.5px" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--v0-divider)" },
    ".cm-panel input[type=text], .cm-panel .cm-textfield": {
        backgroundColor: "var(--v0-background)",
        color: "var(--v0-on-surface-strong)",
        border: "1px solid var(--v0-divider)",
        borderRadius: "3px",
        padding: "2px 6px"
    },
    ".cm-panel button, .cm-panel .cm-button": {
        backgroundImage: "none",
        backgroundColor: "color-mix(in srgb, var(--v0-on-surface) 8%, transparent)",
        color: "var(--v0-on-surface)",
        border: "1px solid var(--v0-divider)",
        borderRadius: "3px"
    },
    ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--v0-warning) 30%, transparent)" },
    ".cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--v0-primary) 40%, transparent)" },
    ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--v0-on-surface) 12%, transparent)" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "inherit", maxHeight: "18em" },
    ".cm-tooltip-autocomplete ul li": { padding: "2px 8px 2px 4px" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--v0-primary)", color: "var(--v0-on-primary)" },
    ".cm-completionDetail": { marginLeft: "1em", opacity: "0.7", fontStyle: "normal", fontSize: "0.85em" },
    ".cm-completionInfo": { padding: "6px 10px", maxWidth: "22rem", fontFamily: "\"Open Sans\", system-ui, sans-serif" },
    ".cm-searchAll": {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "3px 8px",
        borderTop: "1px solid var(--v0-divider)",
        backgroundColor: "color-mix(in srgb, var(--v0-on-surface) 4%, transparent)",
        fontFamily: "\"Open Sans\", system-ui, sans-serif",
        fontSize: "11.5px",
        color: "var(--v0-on-surface-variant)",
        whiteSpace: "nowrap"
    },
    // Alone it is the tooltip itself, with the look of the list.
    ".cm-searchAll.cm-searchAll-alone": { borderTop: "1px solid var(--v0-divider)", backgroundColor: "var(--v0-dock)", padding: "4px 8px" },
    ".cm-searchAll-action": { color: "var(--v0-primary)", background: "none", border: "none", padding: "0", font: "inherit", cursor: "pointer" },
    ".cm-searchAll-action:hover": { textDecoration: "underline" },
    ".cm-searchAll-keys": { fontFamily: "inherit", fontSize: "10.5px", padding: "0 4px", border: "1px solid var(--v0-divider)", borderRadius: "3px" },
    ".cm-searchAll-status": { marginLeft: "auto", paddingLeft: "12px" },
    ".cm-searchAll-warn": { color: "var(--v0-warning)" },
    ".cm-searchAll-running": { color: "var(--v0-on-surface)" },
    ".cm-searchAll-spin": {
        width: "9px",
        height: "9px",
        border: "2px solid var(--v0-primary)",
        borderRightColor: "transparent",
        borderRadius: "50%",
        animation: "cm-searchAll-turn 0.8s linear infinite"
    },
    "@keyframes cm-searchAll-turn": { to: { transform: "rotate(360deg)" } },
    ".cm-snippetField": { backgroundColor: "color-mix(in srgb, var(--v0-primary) 18%, transparent)" }
});

/**
 * How far the field reaches below and above the line of the cursor, as CSS variables on the
 * editor: the list of suggestions moves by them to the field's edge.
 */
const fieldEdges = EditorView.updateListener.of((update) => {
    if (!update.docChanged && !update.selectionSet && !update.geometryChanged && !update.focusChanged) return;
    const target = update.view;
    target.requestMeasure({
        read: (current) => {
            const line = current.coordsAtPos(current.state.selection.main.head);
            const box = current.dom.getBoundingClientRect();
            // Two pixels clear of the frame of the field.
            return line ? { below: Math.max(0, box.bottom - line.bottom) + 2, above: Math.min(0, box.top - line.top) - 2 } : undefined;
        },
        write: (edges, current) => {
            if (!edges) return;
            current.dom.style.setProperty("--below-field", `${edges.below}px`);
            current.dom.style.setProperty("--above-field", `${edges.above}px`);
        }
    });
});

/** The text of a single line: line breaks become spaces, as they do when something is pasted. */
function oneLine(value: string): string {
    return value.replace(/\s*\n\s*/g, " ");
}

function extensions(): Extension[] {
    const base: Extension[] = [
        drawSelection(),
        bracketMatching(),
        // Tab width and closing brackets as the settings say (new editors take a change).
        indentUnit.of(" ".repeat(preferences.tabWidth)),
        EditorState.tabSize.of(preferences.tabWidth),
        language.of(languageExtension()),
        syntaxHighlighting(highlight),
        EditorView.contentAttributes.of({ "aria-label": props.label, ...(props.testid ? { "data-testid": props.testid } : {}) }),
        ...(props.placeholder ? [placeholderText(props.placeholder)] : []),
        theme
    ];
    if (!props.singleLine) base.push(lineNumbers(), highlightActiveLine());
    if (props.grow) base.push(EditorView.lineWrapping, fieldEdges);
    if (props.readonly) return [...base, EditorState.readOnly.of(true), EditorView.editable.of(false)];
    return [
        ...base,
        history(),
        indentOnInput(),
        ...(preferences.autoClose ? [closeBrackets()] : []),
        // Several cursors (Ctrl+Alt+Up/Down, Alt+click), block selection
        // (Alt+drag), the other places of the selected text marked; find and replace on top.
        EditorState.allowMultipleSelections.of(true),
        rectangularSelection(),
        crosshairCursor(),
        ...(props.singleLine ? [] : [highlightSelectionMatches()]),
        ...(props.findBar ? [search({ top: true }), EditorState.phrases.of(searchPhrases())] : []),
        // Ctrl+Space again, with the list open at a value: search all data. Ahead of the list's own
        // keys (also of the highest precedence, so the order decides), which take it to open the list.
        // Esc closes the footer shown alone.
        Prec.highest(keymap.of([
            { key: "Ctrl-Space", run: ctrlSpace },
            { key: "Escape", run: target => target.state.field(searchBarAlone) && (target.dispatch({ effects: showSearchBar.of(false) }), true) }
        ])),
        searchBarAlone,
        searchFooter,
        errorMarks,
        // SQL completes from its language (keywords, schema); shell code from the shell's catalog,
        // and a script also with its own variables and the JavaScript keywords.
        props.sqlSchema
            ? autocompletion({ icons: true })
            : autocompletion({ override: props.valueField ? [completeValue] : [complete, completeVariables, completeStatement], icons: true }),
        // Before the default keys, so Ctrl+Enter is not taken as "new line below".
        runKeys.of(runKeymap()),
        formatKeys.of(formatKeymap()),
        keymap.of([
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...historyKeymap,
            ...(props.singleLine ? [] : [indentWithTab]),
            ...(props.findBar ? EDITOR_SEARCH_KEYS : []),
            ...defaultKeymap
        ]),
        // A single line stays one: pasted line breaks become spaces.
        ...(props.singleLine
            ? [EditorState.transactionFilter.of(transaction => (transaction.newDoc.lines > 1
                    ? [{ changes: { from: 0, to: transaction.startState.doc.length, insert: oneLine(transaction.newDoc.toString()) } }]
                    : transaction))]
            : []),
        EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            touched = true;
            text.value = update.state.doc.toString();
        })
    ];
}

onMounted(() => {
    // The text can come from a query formatted over several lines (the filter of an export row):
    // one line shows it as one, so its braces stand in the field and not above and below it.
    if (props.singleLine && oneLine(text.value) !== text.value) text.value = oneLine(text.value);
    view = new EditorView({ parent: host.value!, state: EditorState.create({ doc: text.value, extensions: extensions() }) });
    // One value of a field: ready to type over, its known values open below.
    if (props.valueField) {
        view.focus();
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        if (props.valueField.values?.(props.valueField.collection, props.valueField.field)?.length) startCompletion(view);
    }
});

onBeforeUnmount(() => view?.destroy());

// The text changed from outside (not by typing).
watch(text, (value) => {
    if (!view || value === view.state.doc.toString()) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
});

watch(() => props.sqlSchema, () => view?.dispatch({ effects: language.reconfigure(languageExtension()) }));

watch(() => shortcuts.keys("query.run"), () => view?.dispatch({ effects: runKeys.reconfigure(runKeymap()) }));

watch(() => shortcuts.keys("editor.format"), () => view?.dispatch({ effects: formatKeys.reconfigure(formatKeymap()) }));

watch(() => props.errorPosition, (position) => {
    if (!view) return;
    if (position === undefined) {
        view.dispatch({ effects: markError.of(undefined) });
        return;
    }
    view.dispatch({ selection: { anchor: Math.min(position, view.state.doc.length) }, effects: markError.of(position), scrollIntoView: true });
    view.focus();
});

defineExpose({
    /** The cursor and the selected text, for buttons that run. */
    cursor: () => ({ position: view?.state.selection.main.head ?? 0, selection: view ? selected(view.state) : "" }),
    focus: () => view?.focus(),
    /** Formats the text (the button of a toolbar); `false` where this editor does not format. */
    format: () => format()
});
</script>

<template>
    <div
        ref="host"
        class="h-full min-h-0 min-w-0 overflow-hidden"
        data-testid="code-editor"
    />
</template>
