<script setup lang="ts">
import { ToggleGroup, ToggleRoot } from "@vuetify/v0";
import { computed, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage, inApp } from "@/api";
import CodeEditor from "@/components/CodeEditor.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import DropMenu from "@/components/DropMenu.vue";
import IconButton from "@/components/IconButton.vue";
import { useDialogs } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";
import { useExportWizard } from "@/composables/exportWizard";
import type { ExportFormat } from "@/transfer/export";
import { useImportWizard } from "@/composables/importWizard";
import { useNotices } from "@/composables/notices";
import { useKeymap, useShortcut } from "@/keys/keymap";
import { JSON_FILES, openTextFile, saveTextFile } from "@/files";
import type { MenuEntry } from "@/menu";
import { isDoc, scalar, toShell } from "@/shell/ejson";
import { valueAtPath } from "@/shell/values";
import type { Doc, Json } from "@/shell/ejson";
import { ShellError } from "@/shell/message";
import { parseStatements, parseValue } from "@/shell/parse";
import { CODE_LANGUAGES, queryCode } from "@/shell/code";
import { isWrite, planStatement } from "@/shell/plan";
import { PAGE_SIZES, useTabsStore } from "@/stores/tabs";
import type { ResultView } from "@/stores/tabs";
import { noFold, provideResultContext } from "./result-context";
import type { Fold, ResultTarget } from "./result-context";
import ResultTable from "./ResultTable.vue";
import TreeRow from "./TreeRow.vue";

/** What a query returned: paging, the tools for documents, and the tree, table or JSON view. */
const props = defineProps<{
    tabId: string;
}>();

const VIEWS: ResultView[] = ["tree", "table", "json"];

const { t } = useI18n();
const { say, report } = useMessages();
const dialogs = useDialogs();
const keymap = useKeymap();
const notices = useNotices();
const tabs = useTabsStore();
const importWizard = useImportWizard();
const exportWizard = useExportWizard();
// The store's own object: the view, the page size and the search are changed here.
const tab = computed(() => tabs.tabs.find(item => item.id === props.tabId)!);
const result = computed(() => tab.value.result);
const editable = computed(() => tabs.editable(tab.value));
const collection = computed(() => tabs.sourceCollection(tab.value));
const menu = useTemplateRef("menu");

const selected = shallowRef<number>();
/** The field chosen in the selected document; empty for the document itself. */
const selectedPath = shallowRef("");
const fold = ref<Fold>({ version: 0, open: true });
/** Fields the tree shows first in their document; kept while paging. */
const pinned = ref<string[]>([]);
watch(result, () => {
    selected.value = undefined;
    selectedPath.value = "";
    tab.value.fieldPath = undefined;
    // A fold of the result before must not unfold the documents now at its place.
    fold.value = noFold(fold.value.version + 1);
});

/** The documents of the page with their index on it, narrowed to those that hold the search text. */
const rows = computed(() => {
    const all = (result.value?.items ?? []).map((item, index) => ({ item, index }));
    const needle = tab.value.search.trim().toLowerCase();
    return needle ? all.filter(row => toShell(row.item).toLowerCase().includes(needle)) : all;
});
const jsonText = computed(() => rows.value.map(row => toShell(row.item, "", true)).join("\n"));
const page = computed(() => (result.value ? Math.floor(result.value.offset / tab.value.pageSize) + 1 : 1));
const pageSizes = computed<MenuEntry[]>(() => PAGE_SIZES.map(size => ({
    label: String(size),
    checked: size === tab.value.pageSize,
    action: () => {
        tab.value.pageSize = size;
        void tabs.showPage(tab.value, 0);
    }
})));

function documentAt(index: number | undefined): Doc | undefined {
    const item = index === undefined ? undefined : result.value?.items[index];
    return isDoc(item) ? item : undefined;
}

/** All documents, one (`index`), or with `path` the node there and all below it. */
function setFold(open: boolean, index?: number, path?: string) {
    fold.value = { version: fold.value.version + 1, open, index, path };
}

function togglePin(path: string) {
    pinned.value = pinned.value.includes(path) ? pinned.value.filter(item => item !== path) : [...pinned.value, path];
}

/**
 * Keys of the tree, as the menu says (by default Ctrl+J unfolds the chosen node with all below it,
 * Ctrl+Shift+J folds it, Ctrl+P pins the chosen field). The table has keys of its own.
 */
function onResultKey(event: KeyboardEvent) {
    if (tab.value.view !== "tree" || selected.value === undefined) return;
    if (keymap.matches(event, "result.expand")) setFold(true, selected.value, selectedPath.value);
    else if (keymap.matches(event, "result.collapse")) setFold(false, selected.value, selectedPath.value);
    else if (keymap.matches(event, "result.pin") && selectedPath.value !== "") togglePin(selectedPath.value);
    else return;
    // Without it the web view opens its downloads (Ctrl+J) or prints (Ctrl+P).
    event.preventDefault();
}

/** The value a text stands for, or the message why it is none. */
function parse(text: string): { value: Json } | { error: string } {
    try {
        return { value: parseValue(text) };
    } catch (error) {
        return { error: say(errorMessage(error)) };
    }
}

/** After a write: the error to show in the dialog, if it failed. */
function outcome(done: boolean): string | undefined {
    return done ? undefined : say(tab.value.error ?? "");
}

function addDocument() {
    dialogs.showText({
        title: t("document.add"),
        text: "{\n    \n}",
        action: t("action.insert"),
        submit: async (text) => {
            const parsed = parse(text);
            if ("error" in parsed) return parsed.error;
            const documents = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
            if (!documents.every(isDoc)) return t("document.error.notDocument");
            return outcome(await tabs.insertDocuments(tab.value, documents));
        }
    });
}

function viewDocument(index: number | undefined) {
    const document = documentAt(index);
    if (document) dialogs.showText({ title: t("document.view"), text: toShell(document) });
}

function editDocument(index: number | undefined) {
    const document = documentAt(index);
    if (!document) return;
    if (!editable.value) {
        viewDocument(index);
        return;
    }
    const id = document._id!;
    dialogs.showText({
        title: t("document.edit"),
        text: toShell(document),
        action: t("action.save"),
        submit: async (text) => {
            const parsed = parse(text);
            if ("error" in parsed) return parsed.error;
            if (!isDoc(parsed.value)) return t("document.error.notDocument");
            // The server refuses to change an `_id`; said here in plain words.
            if (JSON.stringify(parsed.value._id) !== JSON.stringify(id)) return t("document.error.idChanged");
            return outcome(await tabs.replaceDocument(tab.value, id, parsed.value));
        }
    });
}

const marked = shallowRef(new Set<number>());
watch(result, () => (marked.value = new Set()));

/** The field of the selected document the status bar names. */
function choosePath(path: string) {
    selectedPath.value = path;
    tab.value.fieldPath = path || undefined;
}

function choose(index: number, event?: MouseEvent, path = "") {
    choosePath(path);
    const anchor = selected.value;
    if (event?.ctrlKey || event?.metaKey) {
        const next = new Set(marked.value);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        // The one selected before stays marked when the second is added.
        if (anchor !== undefined && next.size > 0 && marked.value.size === 0) next.add(anchor);
        marked.value = next;
    } else if (event?.shiftKey && anchor !== undefined) {
        const order = rows.value.map(row => row.index);
        const [from, to] = [order.indexOf(anchor), order.indexOf(index)].sort((a, b) => a - b);
        marked.value = new Set(order.slice(Math.max(0, from!), to! + 1));
        return;
    } else {
        marked.value = new Set([index]);
    }
    selected.value = index;
}

/** The documents marked together, in page order; at least the one at `index`. */
function markedDocuments(index: number | undefined): Doc[] {
    const indexes = index !== undefined && marked.value.size > 1 && marked.value.has(index) ? [...marked.value].sort((a, b) => a - b) : [index];
    return indexes.map(documentAt).filter((document): document is Doc => document !== undefined);
}

async function removeDocument(index: number | undefined) {
    const documents = markedDocuments(index);
    if (documents.length > 1 && editable.value) {
        const confirmed = await dialogs.confirm({
            title: t("document.removeMany.title", { count: documents.length }),
            text: t("document.removeMany.text", { count: documents.length }, documents.length),
            action: t("action.delete")
        });
        if (confirmed && !await tabs.removeDocuments(tab.value, documents.map(document => document._id!))) report(tab.value.error);
        return;
    }
    const document = documentAt(index);
    if (!document || !editable.value) return;
    const confirmed = await dialogs.confirm({
        title: t("document.remove.title"),
        text: t("document.remove.text", { id: toShell(document._id!) }),
        action: t("action.delete")
    });
    if (confirmed && !await tabs.removeDocuments(tab.value, [document._id!])) report(tab.value.error);
}

async function commit(target: ResultTarget, text: string) {
    const document = documentAt(target.index);
    if (!document) return;
    const parsed = parse(text);
    if ("error" in parsed) {
        notices.notify({ kind: "error", title: parsed.error });
        return;
    }
    if (!await tabs.setField(tab.value, document._id!, target.path, parsed.value)) report(tab.value.error);
}

async function removeField(target: ResultTarget) {
    const document = documentAt(target.index);
    if (document && !await tabs.removeField(tab.value, document._id!, target.path)) report(tab.value.error);
}

async function copy(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        notices.answer(t("action.copied"));
    } catch (error) {
        report(error);
    }
}

async function explain() {
    const current = result.value;
    if (!current) return;
    try {
        const [statement] = parseStatements(current.statement);
        if (!statement) return;
        statement.modifiers.push({ name: "explain", args: ["executionStats"] });
        const plan = planStatement(statement, tab.value.database);
        const reply = await backend.runCommand(tab.value.connectionId, plan.database, plan.command);
        dialogs.showText({ title: t("result.explain"), text: toShell(reply) });
    } catch (error) {
        report(error);
    }
}

/** The query as shell statement and as code of the drivers for Node.js, Python, Java and C#. */
function showQueryCode() {
    const plan = tab.value.plan;
    if (!result.value) return;
    const statement = result.value.statement;
    // A script has no single plan: then only the text that ran.
    const variants = plan ? CODE_LANGUAGES.map(language => ({ label: t(`code.${language}`), text: queryCode(language, plan, statement) })) : undefined;
    dialogs.showText({ title: t("result.code"), text: statement, variants });
}

/**
 * What the query reads, as the filter of a row of the export wizard: the `find` filter, or a
 * pipeline when the query also sorts, skips, limits or projects, or is an aggregation itself.
 */
function wizardFilter(): { collection: string; filter: string } | undefined {
    const command = tab.value.plan?.command;
    const plan = tab.value.plan;
    if (!command || !plan || plan.shape || isWrite(plan)) return undefined;
    if (typeof command.aggregate === "string" && Array.isArray(command.pipeline)) {
        return { collection: command.aggregate, filter: command.pipeline.length > 0 ? toShell(command.pipeline) : "" };
    }
    if (typeof command.find !== "string") return undefined;
    const filter = isDoc(command.filter) ? command.filter : {};
    const stages: Json[] = [];
    if (Object.keys(filter).length > 0) stages.push({ $match: filter });
    if (isDoc(command.sort) && Object.keys(command.sort).length > 0) stages.push({ $sort: command.sort });
    if (command.skip !== undefined) stages.push({ $skip: command.skip });
    if (command.limit !== undefined) stages.push({ $limit: command.limit });
    if (isDoc(command.projection) && Object.keys(command.projection).length > 0) stages.push({ $project: command.projection });
    const onlyFilter = stages.length === 1 && Object.keys(filter).length > 0;
    return { collection: command.find, filter: stages.length === 0 ? "" : onlyFilter ? toShell(filter) : toShell(stages) };
}

/**
 * The export wizard with the collection and the filter of the query. A result the wizard can not
 * read again (a script, another command, the browser preview) is saved as shown, in JSON.
 */
async function openExport(format?: ExportFormat) {
    const query = wizardFilter();
    if (inApp && query) {
        await exportWizard.openExport({ connectionId: tab.value.connectionId, database: tab.value.plan!.database, collection: query.collection }, query.filter, format);
        return;
    }
    if (!result.value) return;
    const documents = result.value.items;
    try {
        if (await saveTextFile(`${collection.value ?? tab.value.database}.json`, JSON_FILES, JSON.stringify(documents, null, 2))) {
            notices.notify({ kind: "success", title: t("result.exported", { count: documents.length }, documents.length) });
        }
    } catch (error) {
        report(error);
    }
}

/** A JSON array, one document, or one document per line; extended JSON keeps the BSON types. */
function readDocuments(text: string): Doc[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        try {
            parsed = text.split("\n").filter(line => line.trim() !== "").map(line => JSON.parse(line) as unknown);
        } catch {
            // Shell notation, as the shell and "Copy document" write it: ObjectId(…), unquoted keys.
            parsed = parseValue(text);
        }
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    if (!list.every(item => isDoc(item as Json))) throw new Error(t("document.error.notDocument"));
    return list as Doc[];
}

/** The import wizard with every file going into the collection the result comes from. */
async function importDocuments() {
    const target = collection.value;
    if (target === undefined) return;
    if (!inApp) return importShown();
    if (tabs.locked(tab.value)) {
        report(new ShellError("error.plan.readonly"));
        return;
    }
    await importWizard.openImport({ connectionId: tab.value.connectionId, database: tab.value.plan?.database ?? tab.value.database, collection: target });
}

//: Ctrl+S exports what the tab shows, Ctrl+O imports into its collection,
// Ctrl+Shift+V inserts documents from the clipboard. Only for the tab in front.
const inFront = computed(() => tabs.activeId === tab.value.id);

/** How to run, with the keys as set. */
const runHint = computed(() => {
    const keys = keymap.spoken("query.run", t("keys.or"));
    return keys === undefined ? t("query.hint.noKey") : t("query.hint", { keys });
});
useShortcut("result.export", () => void openExport(), () => inFront.value);
const searchInput = useTemplateRef<HTMLInputElement>("searchInput");
useShortcut("result.search", () => {
    searchInput.value?.focus();
    searchInput.value?.select();
}, () => inFront.value);
useShortcut("result.import", () => void importDocuments(), () => inFront.value && collection.value !== undefined);
useShortcut("result.importClipboard", () => void importClipboard(), () => inFront.value && collection.value !== undefined);

/** Documents copied somewhere else: JSON, JSON Lines or shell notation, inserted after asking. */
async function importClipboard() {
    try {
        const documents = readDocuments(await navigator.clipboard.readText());
        if (documents.length === 0) return;
        const confirmed = await dialogs.confirm({
            title: t("result.importClipboard"),
            text: t("result.importClipboard.text", { count: documents.length, collection: collection.value ?? "" }, documents.length),
            action: t("action.insert")
        });
        if (!confirmed) return;
        if (await tabs.insertDocuments(tab.value, documents)) {
            notices.notify({ kind: "success", title: t("result.imported", { count: documents.length }, documents.length) });
        } else report(tab.value.error);
    } catch (error) {
        report(error);
    }
}

/** Browser preview: the file is read in the page and inserted in one go. */
async function importShown() {
    try {
        const text = await openTextFile(JSON_FILES);
        if (text === undefined) return;
        const documents = readDocuments(text);
        if (documents.length === 0) return;
        if (await tabs.insertDocuments(tab.value, documents)) {
            notices.notify({ kind: "success", title: t("result.imported", { count: documents.length }, documents.length) });
        } else report(tab.value.error);
    } catch (error) {
        report(error);
    }
}

async function countDocuments() {
    try {
        const count = await tabs.count(tab.value);
        if (count !== undefined) notices.answer(t("result.counted", { count }, count));
    } catch (error) {
        report(error);
    }
}

async function lastPage() {
    try {
        const count = await tabs.count(tab.value);
        if (count === undefined) return;
        const size = tab.value.pageSize;
        await tabs.showPage(tab.value, Math.max(0, Math.floor((count - 1) / size) * size));
    } catch (error) {
        report(error);
    }
}

function openMenu(event: MouseEvent, target: ResultTarget, extra: MenuEntry[] = []) {
    selected.value = target.index;
    choosePath(target.path);
    // A click outside the marked documents marks only the one clicked.
    if (!marked.value.has(target.index)) marked.value = new Set([target.index]);
    const several = markedDocuments(target.index);
    const document = documentAt(target.index);
    const field = target.path !== "";
    const locked = collection.value === undefined || tabs.locked(tab.value);
    // The value of the field in each marked document that has one to filter by.
    const filterValues = several.length > 1
        ? several.map(item => valueAtPath(item, target.path)).filter((value): value is Json => value !== undefined && scalar(value) !== undefined)
        : scalar(target.value) ? [target.value] : [];
    const canFilter = field && collection.value !== undefined && filterValues.length > 0;
    // The table pins its columns itself (`extra`); the tree pins fields here.
    const isPinned = pinned.value.includes(target.path);
    const pin: MenuEntry[] = field && tab.value.view === "tree"
        ? [{ label: t(isPinned ? "result.unpin" : "result.pin"), icon: isPinned ? "i-lucide-pin-off" : "i-lucide-pin", command: "result.pin", action: () => togglePin(target.path) }]
        : [];
    // Grouped: Documents, Fields, Copy; what the view adds; then the rest.
    const entries: MenuEntry[] = [
        { label: t("document.view"), icon: "i-lucide-file-search", action: () => viewDocument(target.index), disabled: !document },
        { label: t("document.edit"), icon: "i-lucide-file-pen-line", action: () => editDocument(target.index), disabled: !document || !editable.value },
        // As in Compass: a value of a field becomes a condition of the filter; of several marked
        // documents, their values of the field together (`$in`), or all but them.
        {
            label: filterValues.length > 1 ? t("result.filterByValues", { count: filterValues.length }) : t("result.filterByValue"),
            icon: "i-lucide-filter",
            // A failed run shows its error in the tab it ran in; a filter that does not parse is said here.
            action: () => void tabs.filterByValue(tab.value, target.path, filterValues).catch(report),
            disabled: !canFilter
        },
        {
            label: filterValues.length > 1 ? t("result.excludeValues", { count: filterValues.length }) : t("result.excludeValue"),
            icon: "i-lucide-filter-x",
            action: () => void tabs.filterByValue(tab.value, target.path, filterValues, true).catch(report),
            disabled: !canFilter
        },
        "separator",
        {
            label: t("menu.documents"),
            icon: "i-lucide-files",
            children: [
                { label: t("document.add"), icon: "i-lucide-file-plus-2", action: addDocument, disabled: locked },
                { label: t("document.remove"), icon: "i-lucide-file-x-2", danger: true, action: () => void removeDocument(target.index), disabled: !document || !editable.value },
                { label: t("document.refresh"), icon: "i-lucide-rotate-cw", action: () => void tabs.refreshDocument(tab.value, target.index).catch(report), disabled: !document || collection.value === undefined },
                "separator",
                { label: t("result.importClipboard"), icon: "i-lucide-clipboard-paste", command: "result.importClipboard", action: () => void importClipboard(), disabled: locked },
                { label: t("result.import"), icon: "i-lucide-download", command: "result.import", action: () => void importDocuments(), disabled: locked },
                { label: t("export.menu"), icon: "i-lucide-upload", command: "result.export", action: () => void openExport() },
                // A result the wizard can not read again is saved as shown, whatever the format.
                ...(inApp && wizardFilter() ? [exportWizard.exportAsGroup(format => void openExport(format))] : [])
            ]
        },
        {
            label: t("menu.fields"),
            icon: "i-lucide-list-tree",
            children: [
                { label: t("field.remove"), action: () => void removeField(target), disabled: !field || !editable.value || target.path === "_id" },
                "separator",
                { label: t("result.expand.node"), command: "result.expand", action: () => setFold(true, target.index, target.path) },
                { label: t("result.collapse.node"), command: "result.collapse", action: () => setFold(false, target.index, target.path) },
                { label: t("result.expand.all"), action: () => setFold(true) },
                { label: t("result.collapse.all"), action: () => setFold(false) }
            ]
        },
        {
            label: t("menu.copy"),
            icon: "i-lucide-copy",
            children: [
                { label: t("copy.value"), icon: "i-lucide-copy", action: () => void copy(toShell(target.value)) },
                { label: t("copy.path"), action: () => void copy(target.path), disabled: !field },
                { label: t("copy.document"), action: () => void copy(toShell(document ?? target.value)) },
                { label: t("copy.json"), action: () => void copy(JSON.stringify(document ?? target.value, null, 2)) },
                ...(several.length > 1 ? [{ label: t("copy.documents", { count: several.length }), action: () => void copy(JSON.stringify(several, null, 2)) }] : [])
            ]
        },
        ...pin,
        ...(extra.length > 0 ? ["separator" as const, ...extra] : []),
        "separator",
        { label: t("action.refresh"), icon: "i-lucide-refresh-cw", command: "tab.refresh", action: () => void tabs.refresh(tab.value) }
    ];
    void menu.value?.open(event, entries);
}

provideResultContext({ editable, selected, marked, choose, fold, pinned, commit: (target, text) => void commit(target, text), menu: openMenu, open: editDocument });
</script>

<template>
    <section class="h-full min-h-0 flex flex-col">
        <div
            class="h-8 shrink-0 flex items-center gap-0.5 px-3.5"
            data-testid="results-toolbar"
        >
            <IconButton
                @click="tabs.showPage(tab, 0)"
                :disabled="tab.running || !result || result.offset === 0"
                :label="$t('page.first')"
                icon="i-lucide-chevron-first"
            />
            <IconButton
                @click="result && tabs.showPage(tab, result.offset - tab.pageSize)"
                :disabled="tab.running || !result || result.offset === 0"
                :label="$t('page.previous')"
                data-testid="page-previous"
                icon="i-lucide-chevron-left"
            />
            <span
                :title="$t('page.current')"
                class="w-8 text-center text-[13px] text-primary tabular-nums"
                data-testid="page-number"
            >{{ page }}</span>
            <IconButton
                @click="result && tabs.showPage(tab, result.offset + tab.pageSize)"
                :disabled="tab.running || !result?.hasMore"
                :label="$t('page.next')"
                data-testid="page-next"
                icon="i-lucide-chevron-right"
            />
            <IconButton
                @click="lastPage"
                :disabled="tab.running || !result?.hasMore"
                :label="$t('page.last')"
                icon="i-lucide-chevron-last"
            />
            <span class="toolbar-rule" />
            <DropMenu
                :entries="pageSizes"
                :label="$t('page.size')"
            >
                <span
                    class="h-6.5 px-1.5 inline-flex items-center gap-2 rounded-sm text-[13px] text-on-surface hover:bg-on-surface/10 tabular-nums"
                    data-testid="page-size"
                >
                    {{ tab.pageSize }}
                    <span class="i-lucide-chevron-down size-3.5" />
                </span>
            </DropMenu>
            <span class="toolbar-rule" />
            <IconButton
                @click="tabs.refresh(tab)"
                :disabled="tab.running"
                :label="$t('action.refresh')"
                icon="i-lucide-refresh-cw"
            />
            <span class="toolbar-rule" />
            <IconButton
                @click="addDocument"
                :disabled="collection === undefined || tabs.locked(tab)"
                :label="$t('document.add')"
                data-testid="document-add"
                icon="i-lucide-file-plus-2"
                tint="text-success"
            />
            <IconButton
                @click="viewDocument(selected)"
                :disabled="!documentAt(selected)"
                :label="$t('document.view')"
                data-testid="document-view"
                icon="i-lucide-file-search"
            />
            <IconButton
                @click="editDocument(selected)"
                :disabled="!documentAt(selected) || !editable"
                :label="$t('document.edit')"
                data-testid="document-edit"
                icon="i-lucide-file-pen-line"
                tint="text-warning"
            />
            <IconButton
                @click="removeDocument(selected)"
                :disabled="!documentAt(selected) || !editable"
                :label="$t('document.remove')"
                data-testid="document-remove"
                icon="i-lucide-file-x-2"
                tint="text-error"
            />
            <span class="toolbar-rule" />
            <IconButton
                @click="explain"
                :disabled="!result"
                :label="$t('result.explain')"
                icon="i-lucide-lightbulb"
                tint="text-warning"
            />
            <IconButton
                @click="showQueryCode"
                :disabled="!result"
                :label="$t('result.code')"
                data-testid="result-code"
                icon="i-lucide-braces"
            />
            <span class="toolbar-rule" />
            <IconButton
                @click="openExport"
                :disabled="!result"
                :label="keymap.titled($t('export.menu'), 'result.export')"
                data-testid="result-export"
                icon="i-lucide-upload"
                tint="text-warning"
            >
                {{ $t("result.export.short") }}
            </IconButton>
            <IconButton
                @click="importDocuments"
                :disabled="collection === undefined || tabs.locked(tab)"
                :label="$t('result.import')"
                icon="i-lucide-download"
                tint="text-success"
            >
                {{ $t("result.import.short") }}
            </IconButton>
            <span class="toolbar-rule" />
            <IconButton
                @click="countDocuments"
                :disabled="!result || collection === undefined"
                :label="$t('result.count')"
                data-testid="result-count"
                icon="i-lucide-sigma"
            />
            <span class="toolbar-rule" />
            <!-- The search gives way first when the pane is narrow; the view switch stays whole. -->
            <label class="h-6.5 min-w-16 shrink flex items-center gap-1.5 px-1 text-on-surface-variant">
                <span class="i-lucide-search size-4 shrink-0" />
                <!-- eslint-disable-next-line vue/no-mutating-props -- `tab` is the store's own object, not a prop -->
                <input
                    ref="searchInput"
                    v-model="tab.search"
                    :aria-label="$t('result.search')"
                    :placeholder="$t('result.search')"
                    :title="keymap.titled($t('result.search.focus'), 'result.search')"
                    class="w-40 min-w-0 shrink bg-transparent outline-none text-[13px] text-on-surface-strong placeholder:italic placeholder:text-on-surface-variant"
                    data-testid="result-search"
                    type="search"
                />
            </label>

            <span class="grow" />
            <span
                v-if="result"
                class="pr-3 shrink-0 whitespace-nowrap text-xs text-on-surface-variant tabular-nums"
                data-testid="result-range"
            >{{ rows.length === 0 ? $t("result.empty") : $t("result.range", { from: result.offset + 1, to: result.offset + result.items.length }) }}</span>
            <ToggleGroup
                v-model="tab.view"
                :label="$t('view.label')"
                class="shrink-0 flex items-center gap-2.5"
                mandatory
            >
                <ToggleRoot
                    v-for="view in VIEWS"
                    :key="view"
                    :data-testid="`view-${view}`"
                    :value="view"
                    class="text-[13px] text-on-surface-variant hover:text-on-surface data-[state=on]:text-on-surface-strong data-[state=on]:font-semibold"
                >
                    {{ $t(`view.${view}`) }}
                </ToggleRoot>
            </ToggleGroup>
        </div>

        <p
            v-if="tab.error"
            class="m-0 shrink-0 max-h-40 overflow-y-auto mx-3.5 my-1 px-3 py-2 rounded-sm bg-error/12 text-error text-[13px] font-mono whitespace-pre-wrap break-words"
            data-testid="query-error"
            role="alert"
        >
            {{ say(tab.error) }}
        </p>

        <!-- Focusable for F7 ("Set focus to results"); the keys of the tree are handled here. -->
        <div
            @keydown="onResultKey"
            class="grow min-h-0 overflow-auto pb-2 font-mono text-[13px] leading-[19px] select-text outline-none"
            data-testid="query-result"
            tabindex="-1"
        >
            <p
                v-if="!result"
                class="m-0 px-4 py-3 font-sans text-[13px] text-on-surface-variant"
            >
                {{ tab.running ? $t("query.running") : runHint }}
            </p>
            <p
                v-else-if="rows.length === 0"
                class="m-0 px-4 py-3 font-sans text-[13px] text-on-surface-variant"
            >
                {{ $t("result.empty") }}
            </p>
            <div
                v-else-if="tab.view === 'tree'"
                class="px-2 pt-1"
                role="tree"
            >
                <TreeRow
                    v-for="row in rows"
                    :key="`${result.offset}-${row.index}`"
                    :expanded="row.index === 0"
                    :index="row.index"
                    :number="result.offset + row.index + 1"
                    :value="row.item"
                />
            </div>
            <ResultTable
                v-else-if="tab.view === 'table'"
                :key="tab.id"
                :offset="result.offset"
                :rows
            />
            <CodeEditor
                v-else
                :key="`${result.offset}-${result.milliseconds}-${rows.length}`"
                :label="$t('view.json')"
                :modelValue="jsonText"
                readonly
            />
        </div>

        <ContextMenu ref="menu" />
    </section>
</template>
