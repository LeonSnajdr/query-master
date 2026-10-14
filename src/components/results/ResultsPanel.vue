<script setup lang="ts">
import { ToggleGroup, ToggleRoot, useNotifications } from "@vuetify/v0";
import { computed, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage, inApp } from "@/api";
import type { TransferFormat } from "@/api";
import CodeEditor from "@/components/CodeEditor.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import DropMenu from "@/components/DropMenu.vue";
import IconButton from "@/components/IconButton.vue";
import { useDialogs } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";
import { useTask } from "@/composables/task";
import { CSV_FILES, JSON_FILES, JSON_LINES_FILES, openTextFile, pickOpenPath, pickSavePath, saveTextFile } from "@/files";
import type { FileKind } from "@/files";
import type { MenuEntry } from "@/menu";
import { isDoc, toShell } from "@/shell/ejson";
import type { Doc, Json } from "@/shell/ejson";
import { ShellError } from "@/shell/message";
import { parseStatements, parseValue } from "@/shell/parse";
import { isWrite, pageCommand, planStatement } from "@/shell/plan";
import { PAGE_SIZES, useTabsStore } from "@/stores/tabs";
import type { ResultView } from "@/stores/tabs";
import { provideResultContext } from "./result-context";
import type { ResultTarget } from "./result-context";
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
const notifications = useNotifications();
const tabs = useTabsStore();
const task = useTask();
// The store's own object: the view, the page size and the search are changed here.
const tab = computed(() => tabs.tabs.find(item => item.id === props.tabId)!);
const result = computed(() => tab.value.result);
const editable = computed(() => tabs.editable(tab.value));
const collection = computed(() => tabs.sourceCollection(tab.value));
const menu = useTemplateRef("menu");

const selected = shallowRef<number>();
const fold = ref<{ version: number; open: boolean; index?: number }>({ version: 0, open: true });
watch(result, () => (selected.value = undefined));

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

function setFold(open: boolean, index?: number) {
    fold.value = { version: fold.value.version + 1, open, index };
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

async function removeDocument(index: number | undefined) {
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
        notifications.send({ subject: parsed.error, severity: "error", timeout: 8000 });
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
        notifications.send({ subject: t("action.copied"), timeout: 1500 });
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

function queryCode() {
    if (result.value) dialogs.showText({ title: t("result.code"), text: result.value.statement });
}

const FORMATS: { format: TransferFormat; kind: FileKind; extension: string }[] = [
    { format: "json", kind: JSON_FILES, extension: "json" },
    { format: "jsonLines", kind: JSON_LINES_FILES, extension: "jsonl" },
    { format: "csv", kind: CSV_FILES, extension: "csv" }
];
const exportEntries = computed<MenuEntry[]>(() => FORMATS.map(({ format }) => ({
    label: t(`result.export.${format}`),
    action: () => void exportDocuments(format)
})));

/** The command that reads everything the query returns, when it can be read again without writing. */
function exportCommand(): Doc | undefined {
    const plan = tab.value.plan;
    if (!plan?.cursor || !plan.paging || plan.shape || isWrite(plan)) return undefined;
    return pageCommand(plan, 0, 1000);
}

/**
 * Everything the query returns, written into a file by the Rust side straight from the cursor;
 * a result that is no cursor (or the browser preview) gives the documents shown, as JSON.
 */
async function exportDocuments(format: TransferFormat) {
    const plan = tab.value.plan;
    if (!result.value) return;
    const { kind, extension } = FORMATS.find(item => item.format === format)!;
    const name = `${collection.value ?? tab.value.database}.${extension}`;
    try {
        const command = exportCommand();
        if (!inApp || !plan || !command) {
            const documents = result.value.items;
            if (await saveTextFile(name, JSON_FILES, JSON.stringify(documents, null, 2))) {
                notifications.send({ subject: t("result.exported", { count: documents.length }, documents.length), timeout: 3000 });
            }
            return;
        }
        const path = await pickSavePath(name, kind);
        if (!path) return;
        const outcome = await task.track(t("result.export.running"), path, (runId, progress) =>
            backend.exportDocuments(runId, tab.value.connectionId, plan.database, command, path, format, progress));
        notifications.send({ subject: t("result.exported", { count: outcome.documents }, outcome.documents), timeout: 3000 });
        if (outcome.skippedFields.length > 0) {
            notifications.send({ subject: t("result.export.skipped", { fields: outcome.skippedFields.join(", ") }), timeout: 8000 });
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
        parsed = text.split("\n").filter(line => line.trim() !== "").map(line => JSON.parse(line) as unknown);
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    if (!list.every(item => isDoc(item as Json))) throw new Error(t("document.error.notDocument"));
    return list as Doc[];
}

/** A JSON, JSON Lines or CSV file into the collection the result comes from, on the Rust side. */
async function importDocuments() {
    const target = collection.value;
    if (target === undefined) return;
    if (!inApp) return importShown();
    const database = tab.value.plan?.database ?? tab.value.database;
    try {
        if (tabs.locked(tab.value) || tabs.lockedByTree(tab.value, database, target)) throw new ShellError("error.plan.readonly");
        const path = await pickOpenPath(FORMATS.map(item => item.kind));
        if (!path) return;
        const extension = path.split(".").pop()?.toLowerCase() ?? "";
        const format: TransferFormat = extension === "csv" ? "csv" : "json";
        const outcome = await task.track(t("result.import.running"), path, (runId, progress) =>
            backend.importDocuments(runId, tab.value.connectionId, database, target, path, format, progress));
        notifications.send({ subject: t("result.imported", { count: outcome.documents }, outcome.documents), timeout: 3000 });
        await tabs.refresh(tab.value);
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
            notifications.send({ subject: t("result.imported", { count: documents.length }, documents.length), timeout: 3000 });
        } else report(tab.value.error);
    } catch (error) {
        report(error);
    }
}

async function countDocuments() {
    try {
        const count = await tabs.count(tab.value);
        if (count !== undefined) notifications.send({ subject: t("result.counted", { count }, count), timeout: 4000 });
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
    const document = documentAt(target.index);
    const field = target.path !== "";
    const entries: MenuEntry[] = [
        { label: t("document.add"), icon: "i-lucide-file-plus-2", action: addDocument, disabled: collection.value === undefined || tab.value.readonly },
        { label: t("document.view"), icon: "i-lucide-file-search", action: () => viewDocument(target.index), disabled: !document },
        { label: t("document.edit"), icon: "i-lucide-file-pen-line", action: () => editDocument(target.index), disabled: !document || !editable.value },
        { label: t("document.remove"), icon: "i-lucide-file-x-2", danger: true, action: () => void removeDocument(target.index), disabled: !document || !editable.value },
        "separator",
        { label: t("field.remove"), action: () => void removeField(target), disabled: !field || !editable.value || target.path === "_id" },
        "separator",
        { label: t("copy.value"), icon: "i-lucide-copy", action: () => void copy(toShell(target.value)) },
        { label: t("copy.path"), action: () => void copy(target.path), disabled: !field },
        { label: t("copy.document"), action: () => void copy(toShell(document ?? target.value)) },
        ...(extra.length > 0 ? ["separator" as const, ...extra] : []),
        "separator",
        { label: t("result.expand.document"), hotkey: "Ctrl + J", action: () => setFold(true, target.index) },
        { label: t("result.collapse.document"), hotkey: "Ctrl + Shift + J", action: () => setFold(false, target.index) },
        { label: t("result.expand.all"), action: () => setFold(true) },
        { label: t("result.collapse.all"), action: () => setFold(false) },
        "separator",
        ...FORMATS.map(({ format }): MenuEntry => ({ label: t(`result.export.${format}`), icon: "i-lucide-upload", action: () => void exportDocuments(format) })),
        { label: t("result.import"), icon: "i-lucide-download", action: () => void importDocuments(), disabled: collection.value === undefined || tabs.locked(tab.value) },
        "separator",
        { label: t("action.refresh"), icon: "i-lucide-refresh-cw", hotkey: "Ctrl + R", action: () => void tabs.refresh(tab.value) }
    ];
    void menu.value?.open(event, entries);
}

provideResultContext({ editable, selected, fold, commit: (target, text) => void commit(target, text), menu: openMenu, open: editDocument });
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
                @click="queryCode"
                :disabled="!result"
                :label="$t('result.code')"
                icon="i-lucide-braces"
            />
            <span class="toolbar-rule" />
            <DropMenu
                :entries="exportEntries"
                :label="$t('result.export')"
            >
                <span
                    :class="result ? '' : 'pointer-events-none opacity-35'"
                    :title="$t('result.export')"
                    class="h-6.5 px-1 inline-flex items-center gap-1.5 rounded-sm text-[13px] text-on-surface hover:text-on-surface-strong hover:bg-on-surface/10"
                    data-testid="result-export"
                >
                    <span class="i-lucide-upload size-4 text-warning" />
                    <span class="pr-1 text-on-surface-strong">{{ $t("result.export.short") }}</span>
                </span>
            </DropMenu>
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
            <label class="h-6.5 flex items-center gap-1.5 px-1 text-on-surface-variant">
                <span class="i-lucide-search size-4 shrink-0" />
                <!-- eslint-disable-next-line vue/no-mutating-props -- `tab` is the store's own object, not a prop -->
                <input
                    v-model="tab.search"
                    :aria-label="$t('result.search')"
                    :placeholder="$t('result.search')"
                    class="w-40 bg-transparent outline-none text-[13px] text-on-surface-strong placeholder:italic placeholder:text-on-surface-variant"
                    data-testid="result-search"
                    type="search"
                />
            </label>

            <span class="grow" />
            <span
                v-if="result"
                class="pr-3 text-xs text-on-surface-variant tabular-nums"
                data-testid="result-range"
            >{{ rows.length === 0 ? $t("result.empty") : $t("result.range", { from: result.offset + 1, to: result.offset + result.items.length }) }}</span>
            <ToggleGroup
                v-model="tab.view"
                :label="$t('view.label')"
                class="flex items-center gap-2.5"
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

        <div
            class="grow min-h-0 overflow-auto pb-2 font-mono text-[13px] leading-[19px] select-text"
            data-testid="query-result"
        >
            <p
                v-if="!result"
                class="m-0 px-4 py-3 font-sans text-[13px] text-on-surface-variant"
            >
                {{ tab.running ? $t("query.running") : $t("query.hint") }}
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
