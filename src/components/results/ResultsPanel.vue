<script setup lang="ts">
import { ButtonContent, ButtonRoot, ToggleGroup, ToggleRoot } from "@vuetify/v0";
import { computed, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { errorMessage, inApp } from "@/api";
import CodeEditor from "@/components/CodeEditor.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import DropMenu from "@/components/DropMenu.vue";
import ErrorState from "@/components/ErrorState.vue";
import IconButton from "@/components/IconButton.vue";
import { preferences } from "@/composables/appearance";
import { useDialogs } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";
import { useExportWizard } from "@/composables/exportWizard";
import type { ExportFormat } from "@/transfer/export";
import { useImportWizard } from "@/composables/importWizard";
import { useNotices } from "@/composables/notices";
import { useKeymap, useShortcut } from "@/keys/keymap";
import { JSON_FILES, openTextFile, saveTextFile } from "@/files";
import type { MenuEntry } from "@/menu";
import { isDoc, keyText, scalar, toShell } from "@/shell/ejson";
import { toRelaxed } from "@/shell/display";
import { filterPath, valueAtPath } from "@/shell/values";
import type { ValueField } from "@/shell/values";
import { useValueSearch, useValueSources } from "@/composables/values";
import { useConnectionsStore } from "@/stores/connections";
import type { Doc, Json } from "@/shell/ejson";
import { ShellError } from "@/shell/message";
import type { Message } from "@/shell/message";
import { parseValue } from "@/shell/parse";
import { fieldCommand } from "@/shell/fields";
import type { FieldChange, FieldCondition, FieldScope } from "@/shell/fields";
import { CODE_LANGUAGES, queryCode } from "@/shell/code";
import { isWrite } from "@/shell/plan";
import { PAGE_SIZES, useTabsStore } from "@/stores/tabs";
import type { ResultView } from "@/stores/tabs";
import { displayText, noFold, provideResultContext } from "./result-context";
import type { Fold, ResultTarget } from "./result-context";
import PlanView from "./PlanView.vue";
import ResultTable from "./ResultTable.vue";
import TreeRow from "./TreeRow.vue";
import FieldDialog from "./FieldDialog.vue";
import type { FieldRequest } from "./FieldDialog.vue";

/** What a query returned: paging, the tools for documents, and the tree, table or JSON view. */
const props = defineProps<{
    tabId: string;
}>();

const VIEWS: ResultView[] = ["tree", "table", "json", "plan"];

const { t } = useI18n();
const { say, report, tell } = useMessages();
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
/** The view Json in the notation of the settings: the shell's, or Extended JSON relaxed or canonical. */
const jsonText = computed(() => rows.value.map((row) => {
    if (preferences.jsonView === "canonical") return JSON.stringify(row.item, null, 4);
    if (preferences.jsonView === "relaxed") return JSON.stringify(toRelaxed(row.item), null, 4);
    return toShell(row.item, "", true);
}).join("\n"));
/** The documents of the page; while searching, how many of them match. */
const rangeText = computed(() => {
    const shown = result.value;
    if (!shown || rows.value.length === 0) return t("result.empty");
    const range = t("result.range", { from: shown.offset + 1, to: shown.offset + shown.items.length });
    return rows.value.length === shown.items.length ? range : t("result.rangeMatches", { matches: rows.value.length, range });
});
const page = computed(() => (result.value ? Math.floor(result.value.offset / tab.value.pageSize) + 1 : 1));
const pageSizes = computed<MenuEntry[]>(() => PAGE_SIZES.map(size => ({
    label: String(size),
    checked: size === tab.value.pageSize,
    // While the tab runs the new page could not be shown: the size waits for the run to end.
    disabled: tab.value.running,
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
    if (tab.value.view !== "tree") return;
    if (treeKey(event)) return;
    if (selected.value === undefined) return;
    if (keymap.matches(event, "result.expand")) setFold(true, selected.value, selectedPath.value);
    else if (keymap.matches(event, "result.collapse")) setFold(false, selected.value, selectedPath.value);
    else if (keymap.matches(event, "result.pin") && selectedPath.value !== "") togglePin(selectedPath.value);
    else if (fieldKey(event)) return;
    else return;
    // Without it the web view opens its downloads (Ctrl+J) or prints (Ctrl+P).
    event.preventDefault();
}

/**
 * The tree by keys, as a tree view: up and down go from line to line, right unfolds (or goes to
 * the first child), left folds (or goes to the parent), Enter edits the value in place, Shift+Enter
 * renames the field, Del deletes it (asking first). True when a key acted.
 */
function treeKey(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const area = event.currentTarget as HTMLElement;
    const lines = [...area.querySelectorAll<HTMLElement>("[data-testid=tree-row]")];
    const at = lines.findIndex(line => Number(line.dataset.index) === selected.value && (line.dataset.path ?? "") === selectedPath.value);
    const line = lines[at];
    const go = (target: HTMLElement | undefined) => {
        if (!target) return;
        choose(Number(target.dataset.index), undefined, target.dataset.path ?? "");
        target.scrollIntoView({ block: "nearest" });
    };
    const toggle = line?.querySelector<HTMLElement>("button");
    const isOpen = toggle?.querySelector(".rotate-90") !== null;
    const hasChildren = toggle !== null && toggle !== undefined && !toggle.classList.contains("invisible");
    switch (event.key) {
        case "ArrowDown":
            go(at === -1 ? lines[0] : lines[at + 1]);
            break;
        case "ArrowUp":
            go(at === -1 ? lines[0] : lines[Math.max(0, at - 1)]);
            break;
        case "ArrowRight":
            if (!line || !hasChildren) return false;
            if (isOpen) go(lines[at + 1]);
            else toggle?.click();
            break;
        case "ArrowLeft": {
            if (!line) return false;
            if (hasChildren && isOpen) {
                toggle?.click();
                break;
            }
            const path = line.dataset.path ?? "";
            const parent = path.includes(".") ? path.slice(0, path.lastIndexOf(".")) : "";
            go(lines.find(other => other.dataset.index === line.dataset.index && (other.dataset.path ?? "") === parent));
            break;
        }
        case "Enter":
            if (!line) return false;
            if (event.shiftKey) {
                if (!selectedPath.value || selectedPath.value === "_id" || !editable.value) return false;
                const document = documentAt(selected.value);
                if (document) openField("rename", { index: selected.value!, path: selectedPath.value, value: valueAtPath(document, selectedPath.value) ?? null });
            } else {
                line.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
            }
            break;
        case "Delete": {
            if (!line || !selectedPath.value || selectedPath.value === "_id" || !editable.value) return false;
            const document = documentAt(selected.value);
            if (document) openField("remove", { index: selected.value!, path: selectedPath.value, value: valueAtPath(document, selectedPath.value) ?? null });
            break;
        }
        default: return false;
    }
    event.preventDefault();
    return true;
}

/** The keys of the field dialogs on the chosen field (adding also on the document); true when one acted. */
function fieldKey(event: KeyboardEvent): boolean {
    const index = selected.value;
    const document = documentAt(index);
    if (index === undefined || !document || !editable.value) return false;
    const path = selectedPath.value;
    const target: ResultTarget = { index, path, value: path ? valueAtPath(document, path) ?? null : document };
    const onField = path !== "" && path !== "_id";
    let mode: FieldRequest["mode"] | undefined;
    if (keymap.matches(event, "field.add")) mode = "add";
    else if (keymap.matches(event, "field.edit") && onField) mode = "edit";
    else if (keymap.matches(event, "field.rename") && onField) mode = "rename";
    else if (keymap.matches(event, "field.remove") && onField) mode = "remove";
    if (!mode) return false;
    event.preventDefault();
    openField(mode, target);
    return true;
}

/** The value a text stands for, or the message why it is none. */
function parse(text: string): { value: Json } | { error: string } {
    try {
        return { value: parseValue(text) };
    } catch (error) {
        return { error: say(errorMessage(error)) };
    }
}

/** After a write: the error to show in the dialog, if it failed; the result behind it stays as it is. */
function outcome(failure: string | Message | undefined): string | undefined {
    return failure === undefined ? undefined : say(failure);
}

/** A write made from the result itself (a menu, a cell): what went wrong goes on a card, once. */
function wrote(failure: string | Message | undefined): boolean {
    if (failure !== undefined) tell(failure);
    return failure === undefined;
}

function addDocument() {
    dialogs.showText({
        title: t("document.add"),
        text: "{\n    \n}",
        action: t("action.insert"),
        // *Save and continue*: insert, and the dialog stays for the next document.
        again: t("document.insertAndContinue"),
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

/** The result of before shows instead of the error of the last run, until the next run. */
const showLast = shallowRef(false);
watch(() => tab.value.error, () => (showLast.value = false));
/** Runs that ended without a failure: refused by a lock, or stopped on purpose. A note, not red. */
const NOTES: Record<string, string> = { "error.plan.readonly": "result.notRun", "error.plan.readonlyTree": "result.notRun", "error.script.stopped": "result.stopped" };
const failure = computed(() => {
    const error = tab.value.error;
    if (!error || showLast.value) return undefined;
    const note = typeof error === "string" ? undefined : NOTES[error.key];
    return { title: t(note ?? "result.failedTitle"), detail: say(error), kind: note ? "info" as const : "error" as const };
});

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
        if (confirmed) wrote(await tabs.removeDocuments(tab.value, documents.map(document => document._id!)));
        return;
    }
    const document = documentAt(index);
    if (!document || !editable.value) return;
    const confirmed = await dialogs.confirm({
        title: t("document.remove.title"),
        text: t("document.remove.text", { id: toShell(document._id!) }),
        action: t("action.delete")
    });
    if (confirmed) wrote(await tabs.removeDocuments(tab.value, [document._id!]));
}

async function commit(target: ResultTarget, text: string) {
    const document = documentAt(target.index);
    if (!document) return;
    const parsed = parse(text);
    if ("error" in parsed) {
        tell(parsed.error);
        return;
    }
    wrote(await tabs.setField(tab.value, document._id!, target.path, parsed.value));
}

/** The field dialog (add, edit, rename, delete, append) *Fields* menu. */
const fieldRequest = shallowRef<FieldRequest>();
const fieldOpen = shallowRef(false);

/** The filter of the query in the tab, when its documents come from a `find`. */
function queryFilter(): Doc | undefined {
    const command = tab.value.plan?.command;
    if (command?.find === undefined) return undefined;
    return isDoc(command.filter) ? command.filter : {};
}

function openField(mode: FieldRequest["mode"], target: ResultTarget) {
    const document = documentAt(target.index);
    if (!document) return;
    const ids = [...marked.value].map(index => documentAt(index)?._id).filter((id): id is Json => id !== undefined);
    const dot = target.path.lastIndexOf(".");
    const parent = dot === -1 ? "" : target.path.slice(0, dot);
    const own = dot === -1 ? target.path : target.path.slice(dot + 1);
    // Adding on a sub document adds into it; on any other field beside it.
    const into = mode === "add" && (target.path === "" || isDoc(target.value));
    fieldRequest.value = {
        mode,
        parent: into ? target.path : parent,
        name: mode === "add" ? "" : own,
        value: mode === "edit" ? target.value : undefined,
        target: { id: document._id!, selected: ids.length > 1 ? ids : [document._id!], query: queryFilter() }
    };
    fieldOpen.value = true;
}

async function duplicateDocument(index: number) {
    const document = documentAt(index);
    if (!document) return;
    const copy = { ...document };
    delete copy._id;
    wrote(await tabs.insertDocuments(tab.value, [copy]));
}

async function submitField(change: FieldChange, scope: FieldScope, condition: FieldCondition): Promise<string | undefined> {
    const target = fieldRequest.value?.target;
    if (!target) return undefined;
    const failure = await tabs.write(tab.value, collection => fieldCommand(collection, change, target, scope, condition));
    if (failure === undefined) return undefined;
    return typeof failure === "string" ? failure : say(failure);
}

async function copy(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        notices.answer(t("action.copied"));
    } catch (error) {
        report(error);
    }
}

/** The bulb: the view "Plan" (stage 19), which reads the plan when it shows. */
function explain() {
    tab.value.view = "plan";
}

// The view "Plan" reads the plan of what the tab shows, again when that changes.
watch(() => [tab.value.view, result.value] as const, ([view, current]) => {
    if (view === "plan" && current && tab.value.explain?.statement !== current.statement && !tab.value.running) void tabs.explainResult(tab.value);
}, { immediate: true });

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
        if (wrote(await tabs.insertDocuments(tab.value, documents))) {
            notices.notify({ kind: "success", title: t("result.imported", { count: documents.length }, documents.length) });
        }
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
        if (wrote(await tabs.insertDocuments(tab.value, documents))) {
            notices.notify({ kind: "success", title: t("result.imported", { count: documents.length }, documents.length) });
        }
    } catch (error) {
        report(error);
    }
}

async function countDocuments() {
    try {
        const count = await tabs.count(tab.value);
        notices.answer(count === undefined ? t("result.notCountable") : t("result.counted", { count }, count));
    } catch (error) {
        report(error);
    }
}

async function lastPage() {
    try {
        const count = await tabs.count(tab.value);
        if (count === undefined) {
            notices.answer(t("result.notCountable"));
            return;
        }
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
                // *Duplicate document*: the same document under a new `_id`.
                { label: t("document.duplicate"), icon: "i-lucide-copy-plus", action: () => void duplicateDocument(target.index), disabled: !document || !editable.value },
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
                //: adding works on any row; the rest needs a field (not `_id`).
                { label: `${t("field.title.add")} …`, icon: "i-lucide-list-plus", command: "field.add", action: () => openField("add", target), disabled: !document || !editable.value },
                { label: `${t("field.title.edit")} …`, icon: "i-lucide-pencil", command: "field.edit", action: () => openField("edit", target), disabled: !field || !editable.value || target.path === "_id" },
                { label: `${t("field.title.rename")} …`, command: "field.rename", action: () => openField("rename", target), disabled: !field || !editable.value || target.path === "_id" || /\.\d+(\.|$)/.test(target.path) },
                { label: `${t("field.title.remove")} …`, icon: "i-lucide-trash-2", danger: true, command: "field.remove", action: () => openField("remove", target), disabled: !field || !editable.value || target.path === "_id" },
                ...(Array.isArray(target.value) && field ? [{ label: `${t("field.title.push")} …`, action: () => openField("push", target), disabled: !editable.value }] : []),
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
                //: the value as text (no quotes), as the shell writes it, the field with its name.
                { label: t("copy.text"), icon: "i-lucide-copy", action: () => void copy(displayText(target.value)) },
                { label: t("copy.value"), action: () => void copy(toShell(target.value)) },
                { label: t("copy.field"), action: () => void copy(`${keyText(target.path.split(".").at(-1) ?? "")}: ${toShell(target.value)}`), disabled: !field },
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

const valueSources = useValueSources(() => tab.value);
const valueSearch = useValueSearch(() => tab.value);
const connections = useConnectionsStore();

/**
 * The values to suggest for a value edited in place: those of its field in the collection the
 * documents come from (`items.0.sku` is `items.sku`), as the filter suggests them.
 */
function suggest(path: string): ValueField | undefined {
    const collection = tabs.sourceCollection(tab.value);
    const field = filterPath(path);
    if (collection === undefined || !field) return undefined;
    // Reads the sample of the collection, whose values count too, if it was not read yet.
    connections.fieldsOf(tab.value.connectionId, tab.value.plan?.database ?? tab.value.database, collection);
    return { collection, field, values: valueSources, search: valueSearch };
}

provideResultContext({ editable, selected, selectedPath, marked, choose, fold, pinned, commit: (target, text) => void commit(target, text), menu: openMenu, open: editDocument, suggest });
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
                data-testid="result-explain"
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
            <ButtonRoot
                v-if="tab.error && showLast"
                @click="showLast = false"
                :title="$t('result.showError')"
                class="mr-3 shrink-0 inline-flex items-center gap-1 text-xs text-error hover:underline"
                data-testid="query-failed"
            >
                <span class="i-lucide-circle-alert size-3.5" />
                <ButtonContent>{{ $t("result.failed") }}</ButtonContent>
            </ButtonRoot>
            <span
                v-if="result && !failure"
                class="pr-3 shrink-0 whitespace-nowrap text-xs text-on-surface-variant tabular-nums"
                data-testid="result-range"
            >{{ rangeText }}</span>
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

        <!-- Focusable for F7 ("Set focus to results"); the keys of the tree are handled here. -->
        <div
            @keydown="onResultKey"
            class="grow min-h-0 overflow-auto pb-2 font-mono text-[13px] leading-[19px] select-text outline-none"
            data-testid="query-result"
            tabindex="-1"
        >
            <!-- A failed run takes the place of the result, which stays one click away. -->
            <ErrorState
                v-if="failure"
                :detail="failure.detail"
                :kind="failure.kind"
                :title="failure.title"
                data-testid="query-error"
            >
                <ButtonRoot
                    v-if="result"
                    @click="showLast = true"
                    class="btn-secondary h-7! text-[12px]"
                    data-testid="query-error-last"
                >
                    <ButtonContent>{{ $t("result.showLast") }}</ButtonContent>
                </ButtonRoot>
            </ErrorState>
            <p
                v-else-if="!result"
                class="m-0 px-4 py-3 font-sans text-[13px] text-on-surface-variant"
            >
                {{ tab.running ? $t("query.running") : runHint }}
            </p>
            <PlanView
                v-else-if="tab.view === 'plan'"
                :tabId
            />
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
                    :expanded="preferences.autoExpand === 'all' || preferences.autoExpand === 'first' && row.index === 0"
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
                findBar
                readonly
            />
        </div>

        <ContextMenu ref="menu" />
        <FieldDialog
            v-model="fieldOpen"
            :request="fieldRequest"
            :submit="submitField"
        />
    </section>
</template>
