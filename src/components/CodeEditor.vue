<script setup lang="ts">
import { autocompletion, closeBrackets, closeBracketsKeymap, completeFromList, completionKeymap, completionStatus, snippet, startCompletion } from "@codemirror/autocomplete";
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript, localCompletionSource, snippets } from "@codemirror/lang-javascript";
import { sql } from "@codemirror/lang-sql";
import { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";
import { useMessages } from "@/composables/messages";
import { codeMirrorKey } from "@/keys/hotkey";
import { useKeymap } from "@/keys/keymap";
import { scriptPlace, suggest, valueDetail, valuePlace } from "@/shell/complete";
import type { Environment, Suggestion, SuggestionType, ValuePlace } from "@/shell/complete";
import { toDraft } from "@/shell/edit";
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
    /** Test id of the editable text. */
    testid?: string;
}>();

const text = defineModel<string>({ required: true });

/** The language part, swapped when the SQL schema (collections, fields) becomes known. */
const language = new Compartment();
/** The run keys, swapped when they are changed in the settings. */
const runKeys = new Compartment();
const shortcuts = useKeymap();

function runKeymap(): Extension {
    const keys = shortcuts.keys("query.run").map(codeMirrorKey).filter((key): key is string => key !== undefined);
    return keymap.of([...keys.map(key => ({ key, run })), ...(props.singleLine ? [{ key: "Enter", run }] : [])]);
}

function languageExtension(): Extension {
    if (props.valueField) return [];
    return props.sqlSchema ? sql({ schema: props.sqlSchema, upperCaseKeywords: true }) : javascript();
}
const { say, report } = useMessages();
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

/** Where values come from and how all data is searched: of the one field, or of the shell code. */
const valueSource = () => (props.valueField ? props.valueField.values : props.environment?.values);
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
    // At once "Searching …"; the list was just closed by choosing the entry.
    void Promise.resolve().then(reopen);
    return true;
}

/**
 * The last entry of the list where a value of a field stands: search all data. Shown with what is
 * known already, or alone when asked for with Ctrl+Space. It replaces nothing (`from` is the
 * cursor), so whatever is typed, it is never filtered away.
 */
const completeSearch: CompletionSource = (context) => {
    const search = searcher();
    const place = searchPlace(context.state, context.pos);
    if (!search || !place) return null;
    const known = valueSource()?.(place.collection, place.field)?.length ?? 0;
    if (!context.explicit && known === 0) return null;
    const state = search.state(place.collection, place.field, place.prefix);
    let label = place.prefix ? say({ key: "complete.search.prefix", params: { text: place.prefix } }) : say({ key: "complete.search.all" });
    if (state?.running) label = say({ key: "complete.search.running" });
    else if (state) label = say({ key: "complete.search.again" });
    let detail = say({ key: "complete.search.keys" });
    if (state?.error) detail = say({ key: "complete.search.failed" });
    else if (state?.sampled) detail = say({ key: "complete.search.sampled" });
    else if (state?.truncated) detail = say({ key: "complete.search.truncated", params: { count: state.hints.length } });
    else if (state && !state.running) detail = say({ key: "complete.search.found", params: { count: state.hints.length } });
    return {
        from: context.pos,
        options: [{
            label,
            detail,
            info: state?.error ? say(state.error) : say({ key: "complete.search.info" }),
            type: "text",
            // Last, so it is never chosen by a plain Enter; a line above it sets it apart (theme).
            boost: -99,
            apply: view => void (state?.running || searchAll(view))
        }]
    };
};

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

const theme = EditorView.theme({
    "&": { height: "100%", fontSize: "var(--editor-font-size, 13px)", color: "var(--v0-on-surface)", backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
    ".cm-content": { caretColor: "var(--v0-primary)", padding: props.compact ? "0" : props.singleLine ? "5px 0" : "8px 0" },
    ".cm-line": { padding: props.singleLine ? "0 2px" : "0 6px" },
    ".cm-cursor": { borderLeftColor: "var(--v0-primary)" },
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
    ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "inherit", maxHeight: "18em" },
    ".cm-tooltip-autocomplete ul li": { padding: "2px 8px 2px 4px" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--v0-primary)", color: "var(--v0-on-primary)" },
    ".cm-completionDetail": { marginLeft: "1em", opacity: "0.7", fontStyle: "normal", fontSize: "0.85em" },
    ".cm-completionInfo": { padding: "6px 10px", maxWidth: "22rem", fontFamily: "\"Open Sans\", system-ui, sans-serif" },
    ".cm-tooltip-autocomplete ul li:has(.cm-completionIcon-text)": { borderTop: "1px solid var(--v0-divider)" },
    ".cm-snippetField": { backgroundColor: "color-mix(in srgb, var(--v0-primary) 18%, transparent)" }
});

function extensions(): Extension[] {
    const base: Extension[] = [
        drawSelection(),
        bracketMatching(),
        indentUnit.of("    "),
        language.of(languageExtension()),
        syntaxHighlighting(highlight),
        EditorView.contentAttributes.of({ "aria-label": props.label, ...(props.testid ? { "data-testid": props.testid } : {}) }),
        theme
    ];
    if (!props.singleLine) base.push(lineNumbers(), highlightActiveLine());
    if (props.readonly) return [...base, EditorState.readOnly.of(true), EditorView.editable.of(false)];
    return [
        ...base,
        history(),
        indentOnInput(),
        closeBrackets(),
        // Ctrl+Space again, with the list open at a value: search all data. Ahead of the list's own
        // keys (also of the highest precedence, so the order decides), which take it to open the list.
        Prec.highest(keymap.of([{ key: "Ctrl-Space", run: target => completionStatus(target.state) === "active" && searchAll(target) }])),
        // SQL completes from its language (keywords, schema); shell code from the shell's catalog,
        // and a script also with its own variables and the JavaScript keywords.
        props.sqlSchema
            ? autocompletion({ icons: true })
            : autocompletion({ override: props.valueField ? [completeValue, completeSearch] : [complete, completeVariables, completeStatement, completeSearch], icons: true }),
        // Before the default keys, so Ctrl+Enter is not taken as "new line below".
        runKeys.of(runKeymap()),
        keymap.of([
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...historyKeymap,
            ...(props.singleLine ? [] : [indentWithTab]),
            ...defaultKeymap
        ]),
        // A single line stays one: pasted line breaks become spaces.
        ...(props.singleLine
            ? [EditorState.transactionFilter.of(transaction => (transaction.newDoc.lines > 1
                    ? [{ changes: { from: 0, to: transaction.startState.doc.length, insert: transaction.newDoc.toString().replace(/\s*\n\s*/g, " ") } }]
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

watch(() => props.errorPosition, (position) => {
    if (!view || position === undefined) return;
    view.dispatch({ selection: { anchor: Math.min(position, view.state.doc.length) }, scrollIntoView: true });
    view.focus();
});

defineExpose({
    /** The cursor and the selected text, for buttons that run. */
    cursor: () => ({ position: view?.state.selection.main.head ?? 0, selection: view ? selected(view.state) : "" }),
    focus: () => view?.focus()
});
</script>

<template>
    <div
        ref="host"
        class="h-full min-h-0 min-w-0 overflow-hidden"
        data-testid="code-editor"
    />
</template>
