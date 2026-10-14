<script setup lang="ts">
import { autocompletion, closeBrackets, closeBracketsKeymap, completeFromList, completionKeymap, snippet } from "@codemirror/autocomplete";
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript, localCompletionSource, snippets } from "@codemirror/lang-javascript";
import { sql } from "@codemirror/lang-sql";
import { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";
import { useMessages } from "@/composables/messages";
import { codeMirrorKey } from "@/keys/hotkey";
import { useKeymap } from "@/keys/keymap";
import { scriptPlace, suggest } from "@/shell/complete";
import type { Environment, Suggestion, SuggestionType } from "@/shell/complete";

const emit = defineEmits<{
    /** The run keys (Ctrl+Enter, F5; in a single line also Enter): run, with the cursor and the selected text. */
    run: [position: number, selection: string];
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
    return props.sqlSchema ? sql({ schema: props.sqlSchema, upperCaseKeywords: true }) : javascript();
}
const { say } = useMessages();
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
    ".cm-content": { caretColor: "var(--v0-primary)", padding: props.singleLine ? "5px 0" : "8px 0" },
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
    ".cm-snippetField": { backgroundColor: "color-mix(in srgb, var(--v0-primary) 18%, transparent)" }
});

function extensions(): Extension[] {
    const base: Extension[] = [
        drawSelection(),
        bracketMatching(),
        indentUnit.of("    "),
        language.of(languageExtension()),
        syntaxHighlighting(highlight),
        EditorView.contentAttributes.of({ "aria-label": props.label }),
        theme
    ];
    if (!props.singleLine) base.push(lineNumbers(), highlightActiveLine());
    if (props.readonly) return [...base, EditorState.readOnly.of(true), EditorView.editable.of(false)];
    return [
        ...base,
        history(),
        indentOnInput(),
        closeBrackets(),
        // SQL completes from its language (keywords, schema); shell code from the shell's catalog,
        // and a script also with its own variables and the JavaScript keywords.
        props.sqlSchema ? autocompletion({ icons: true }) : autocompletion({ override: [complete, completeVariables, completeStatement], icons: true }),
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
            if (update.docChanged) text.value = update.state.doc.toString();
        })
    ];
}

onMounted(() => {
    view = new EditorView({ parent: host.value!, state: EditorState.create({ doc: text.value, extensions: extensions() }) });
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
