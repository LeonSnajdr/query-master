<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogClose, DialogContent, DialogRoot, DialogTitle, SwitchRoot, SwitchThumb, SwitchTrack } from "@vuetify/v0";
import { computed, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { namesAsChoices } from "@/choice";
import FormError from "@/components/FormError.vue";
import IconButton from "@/components/IconButton.vue";
import ChoiceField from "@/components/ChoiceField.vue";
import CodeEditor from "@/components/CodeEditor.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import { useExportWizard } from "@/composables/exportWizard";
import { useFreeSpace } from "@/composables/freeSpace";
import { CSV_FILES, JSON_FILES, pickFolder, pickSavePath, SQL_FILES } from "@/files";
import type { FileKind } from "@/files";
import { useConnectionsStore } from "@/stores/connections";
import type { Environment } from "@/shell/complete";
import { defaultOutput, exportProblems, FILE_TARGETS, hasColumns, INSERT_MODES, SQL_DIALECTS } from "@/transfer/export";
import type { CsvSettings, ExportFormat, ExportRow, FileTarget, InsertMode, JsonLayout, JsonNotation, SqlDialect } from "@/transfer/export";
import ColumnSchema from "./ColumnSchema.vue";
import TransferFailure from "./TransferFailure.vue";
import TransferProgress from "./TransferProgress.vue";

/** The export wizard: format tiles, rows of collections, settings, progress. */
const { t } = useI18n();
const connections = useConnectionsStore();
const { wizard, setFormat, addRows, chooseTargetConnection, start, stop, close } = useExportWizard();

const open = computed({ get: () => wizard.open, set: value => !value && close() });
const state = computed(() => wizard.state);
const running = computed(() => wizard.runId !== undefined);

/** The tiles, with their symbols. */
const TILES: { format: ExportFormat; icon: string }[] = [
    { format: "json", icon: "i-lucide-braces" },
    { format: "csv", icon: "i-lucide-sheet" },
    { format: "sql", icon: "i-lucide-database" },
    { format: "database", icon: "i-lucide-file-text" }
];

const title = computed(() => {
    if (wizard.step === "settings") return t("export.title.settings", { format: t(`export.format.${state.value.format}`) });
    if (wizard.step === "schema") return t("export.title.schema");
    return t("export.title");
});
const delimiterOptions = computed(() => ([[",", "comma"], [";", "semicolon"], ["\t", "tab"], [" ", "space"]] as const).map(([value, name]) => ({ value, label: t(`export.csv.delimiter.${name}`) })));
const quoteOptions = computed(() => ([["\"", "double"], ["'", "single"]] as const).map(([value, name]) => ({ value, label: t(`export.csv.quote.${name}`) })));
const CSV_FLAGS = ["header", "nullEmpty", "escapeStrings"] as const;
const dialectOptions = computed(() => SQL_DIALECTS.map(value => ({ value, label: t(`export.sql.dialect.${value}`) })));
const SQL_FLAGS = ["createTable", "dropTable"] as const;
const targetOptions = computed(() => FILE_TARGETS.map(value => ({ value, label: t(`export.target.${value}`) })));
const serverOptions = computed(() => connections.saved.map(profile => ({ value: profile.id, label: profile.name })));
const insertOptions = computed(() => INSERT_MODES.map(value => ({ value, label: t(`export.insert.${value}`) })));
const notationOptions = computed(() => (["shell", "relaxed", "canonical"] as JsonNotation[]).map(value => ({ value, label: t(`export.json.notation.${value}`) })));
const layoutOptions = computed(() => (["lines", "comma", "array"] as JsonLayout[]).map(value => ({ value, label: t(`export.json.layout.${value}`) })));

/** Completion for the filter of a row: fields and operators as in the filter of the document browser. */
function environmentFor(database: string): Environment {
    const id = state.value.connectionId;
    return {
        serverVersion: connections.sessions[id]?.version,
        databases: sourceDatabases.value,
        collections: connections.collectionsOf(id, database),
        fields: name => connections.fieldsOf(id, database, name)
    };
}

const sourceDatabases = computed(() => connections.sessions[state.value.connectionId]?.databases.map(database => database.name) ?? []);
const sourceChoices = computed(() => namesAsChoices(sourceDatabases.value));
const targetChoices = computed(() => namesAsChoices(connections.sessions[state.value.database.connectionId]?.databases.map(database => database.name) ?? []));
const problems = computed(() => exportProblems(state.value));
const problemText = computed(() => {
    const first = problems.value[0];
    if (!first) return "";
    return first.row === undefined ? t(first.key) : t("export.problem.inRow", { row: first.row + 1, text: t(first.key) });
});

const target = computed({ get: () => state.value.target, set: (value: FileTarget) => (state.value.target = value) });
const server = computed({ get: () => state.value.database.connectionId, set: (value: string) => void chooseTargetConnection(value) });
const insertMode = computed({ get: () => state.value.database.insertMode, set: (value: InsertMode) => (state.value.database.insertMode = value) });
const notation = computed({ get: () => state.value.json.notation, set: (value: JsonNotation) => (state.value.json.notation = value) });
const layout = computed({ get: () => state.value.json.layout, set: (value: JsonLayout) => (state.value.json.layout = value) });
const delimiter = computed({ get: () => state.value.csv.delimiter, set: (value: CsvSettings["delimiter"]) => (state.value.csv.delimiter = value) });
const dialect = computed({ get: () => state.value.sql.dialect, set: (value: SqlDialect) => (state.value.sql.dialect = value) });
const quote = computed({ get: () => state.value.csv.quote, set: (value: CsvSettings["quote"]) => (state.value.csv.quote = value) });

/** The row clicked last: edit acts on it. */
const selected = shallowRef<number>();
/** The rows selected (Ctrl and Shift add to them): remove acts on all. */
const marked = shallowRef(new Set<number>());
// The first row is selected once the rows are there, so edit and remove work at once.
watch(() => wizard.loading, (loading) => {
    if (loading) return;
    selected.value = state.value.rows.length > 0 ? 0 : undefined;
    marked.value = new Set(selected.value === undefined ? [] : [0]);
});

function clickRow(event: MouseEvent, index: number) {
    if (event.shiftKey && selected.value !== undefined) {
        const [from, to] = [Math.min(selected.value, index), Math.max(selected.value, index)];
        marked.value = new Set(Array.from({ length: to - from + 1 }, (_, step) => from + step));
    } else if (event.ctrlKey || event.metaKey) {
        const next = new Set(marked.value);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        marked.value = next;
    } else {
        marked.value = new Set([index]);
    }
    selected.value = index;
}
const spaceMenu = useTemplateRef("spaceMenu");

/** Below the rows, as in Windows Explorer: the choice goes away; the menu offers adding one. */
const rowSpace = useFreeSpace(() => {
    selected.value = undefined;
    marked.value = new Set();
}, {
    rows: "[data-testid=export-row], thead",
    menu: event => void spaceMenu.value?.open(event, [
        { label: t("export.addCollection"), icon: "i-lucide-file-plus-2", action: () => openForm() }
    ])
});

/** The form of "Add collection", also for editing a row (`editing` is its index). */
const form = ref<{ database: string; collection: string; output: string; filter: string; editing?: number }>();
const formDatabase = computed(() => connections.sessions[state.value.connectionId]?.databases.find(database => database.name === form.value?.database));
const formCollections = computed(() => {
    const database = form.value?.database;
    if (!database) return [];
    const names = connections.collectionsOf(state.value.connectionId, database);
    return namesAsChoices(names, Object.fromEntries(names.map(name => [name, formDatabase.value?.types[name] === "view" ? t("choice.view") : undefined])));
});

function openForm(row?: number) {
    const existing = row === undefined ? undefined : state.value.rows[row];
    form.value = existing ? { ...existing, editing: row } : { database: sourceDatabases.value[0] ?? "", collection: "", output: "", filter: "" };
}

function saveForm() {
    const value = form.value;
    if (!value?.database.trim() || !value.collection.trim()) return;
    const row: ExportRow = {
        database: value.database.trim(),
        collection: value.collection.trim(),
        output: value.output.trim() || defaultOutput(state.value.format, value.database.trim(), value.collection.trim()),
        filter: value.filter
    };
    if (value.editing === undefined) addRows([row]);
    else state.value.rows = state.value.rows.map((item, index) => (index === value.editing ? row : item));
    form.value = undefined;
}

function removeRow() {
    if (marked.value.size === 0) return;
    state.value.rows = state.value.rows.filter((_, index) => !marked.value.has(index));
    selected.value = undefined;
    marked.value = new Set();
}

const KINDS: Partial<Record<ExportFormat, FileKind>> = { json: JSON_FILES, csv: CSV_FILES, sql: SQL_FILES };

async function choosePath() {
    if (state.value.target === "directory") {
        const folder = await pickFolder();
        if (folder) state.value.path = folder;
        return;
    }
    const first = state.value.rows[0];
    const path = await pickSavePath(first?.output ?? "export.json", KINDS[state.value.format]);
    if (path) state.value.path = path;
}

/** Next from the rows: the settings of a file format; a database starts at once. */
function next() {
    if (problems.value.length > 0) return;
    if (state.value.format === "database") void start();
    else wizard.step = "settings";
}

/** The columns of the rows; into a database also what happens to the target. */
const columns = computed(() => ["database", "collection", "output", "filter", ...(state.value.format === "database" ? ["target"] : [])]);
const targetModes = computed(() => (["append", "replace"] as const).map(value => ({ value, label: t(`export.target.mode.${value}`) })));

/** *Replace* or *Append* for a row; for all selected rows when it is one of them ("Do same for others"). */
function setReplace(index: number, replace: boolean) {
    const rows = marked.value.has(index) ? marked.value : new Set([index]);
    state.value.rows = state.value.rows.map((row, position) => (rows.has(position) ? { ...row, replace } : row));
}

const progressRows = computed(() => state.value.rows.map(row => ({
    source: `${row.database}.${row.collection}`,
    target: state.value.format === "database" ? `${state.value.database.database}.${row.output}` : row.output
})));
/** The failed row whose message stands next to the buttons; none: the first that failed. */
const failure = shallowRef<number>();
watch(() => wizard.runId, () => (failure.value = undefined));
</script>

<template>
    <DialogRoot v-model="open">
        <DialogContent class="dialog p-0! w-[min(94vw,54rem)]! h-[min(92vh,44rem)]!">
            <div
                class="h-full flex flex-col text-[13px]"
                data-testid="export-wizard"
            >
                <header class="shrink-0 bg-dock border-b border-divider">
                    <div class="relative h-14 flex items-center justify-center">
                        <DialogTitle class="m-0 text-[21px] font-normal text-on-surface-strong">
                            {{ title }}
                        </DialogTitle>
                        <DialogClose
                            :aria-label="$t('action.close')"
                            class="absolute right-4 top-3 size-8 inline-flex items-center justify-center rounded-sm text-on-surface hover:bg-on-surface/10"
                        >
                            <span class="i-lucide-x size-5" />
                        </DialogClose>
                    </div>
                    <div
                        v-if="wizard.step === 'rows'"
                        :aria-label="$t('export.format')"
                        class="flex justify-center gap-2 pb-2.5"
                        role="radiogroup"
                    >
                        <ButtonRoot
                            v-for="tile in TILES"
                            :key="tile.format"
                            @click="setFormat(tile.format)"
                            :aria-checked="state.format === tile.format"
                            :class="state.format === tile.format ? 'text-on-surface-strong font-bold' : 'text-on-surface hover:text-on-surface-strong'"
                            :data-testid="`export-tile-${tile.format}`"
                            :disabled="running"
                            class="relative w-21 pt-1 pb-2 flex flex-col items-center gap-1.5 disabled:opacity-35"
                            role="radio"
                        >
                            <span
                                :class="tile.icon"
                                class="size-7"
                            />
                            <ButtonContent>{{ $t(`export.format.${tile.format}`) }}</ButtonContent>
                            <!-- The notch under the chosen tile. -->
                            <span
                                v-if="state.format === tile.format"
                                class="absolute -bottom-[17px] size-3 rotate-45 bg-background border-l border-t border-divider"
                            />
                        </ButtonRoot>
                    </div>
                </header>

                <!-- Page 1: where to, and the rows of collections. -->
                <div
                    v-if="wizard.step === 'rows'"
                    class="grow min-h-0 flex flex-col px-6 pt-5 gap-3"
                >
                    <div class="form-grid grid-cols-[10rem_1fr]!">
                        <template v-if="state.format !== 'database'">
                            <span>{{ $t("export.to") }}:</span>
                            <div class="flex items-center gap-2">
                                <div class="w-34 shrink-0">
                                    <ChoiceField
                                        v-model="target"
                                        :label="$t('export.to')"
                                        :options="targetOptions"
                                    />
                                </div>
                                <div
                                    v-if="state.target !== 'clipboard'"
                                    class="grow flex items-center field p-0! pr-1!"
                                >
                                    <input
                                        v-model="state.path"
                                        :aria-label="$t('export.path')"
                                        :placeholder="$t(state.target === 'directory' ? 'export.path.folder' : 'export.path.file')"
                                        class="grow h-full px-2.5 bg-transparent outline-none"
                                        data-testid="export-path"
                                        spellcheck="false"
                                    />
                                    <IconButton
                                        @click="choosePath"
                                        :label="$t('export.path.choose')"
                                        icon="i-lucide-ellipsis"
                                    />
                                </div>
                            </div>
                        </template>
                        <template v-else>
                            <span>{{ $t("export.to") }}:</span>
                            <div class="flex items-center gap-2">
                                <div class="w-56 shrink-0">
                                    <ChoiceField
                                        v-model="server"
                                        :label="$t('export.server')"
                                        :options="serverOptions"
                                        data-testid="export-server"
                                    />
                                </div>
                                <div class="grow min-w-0">
                                    <ChoiceField
                                        v-model="state.database.database"
                                        :label="$t('export.targetDatabase')"
                                        :options="targetChoices"
                                        :placeholder="$t('export.targetDatabase.placeholder')"
                                        data-testid="export-target-database"
                                        free
                                        markNew
                                    />
                                </div>
                            </div>
                            <span>{{ $t("export.insertMode") }}:</span>
                            <ChoiceField
                                v-model="insertMode"
                                :label="$t('export.insertMode')"
                                :options="insertOptions"
                            />
                            <span>{{ $t("export.copyIndexes") }}:</span>
                            <SwitchRoot
                                v-model="state.database.copyIndexes"
                                :label="$t('export.copyIndexes')"
                            >
                                <SwitchTrack class="switch-track">
                                    <SwitchThumb class="switch-thumb" />
                                </SwitchTrack>
                            </SwitchRoot>
                        </template>
                    </div>

                    <div class="border-t border-divider" />

                    <div class="flex items-center gap-0.5">
                        <IconButton
                            @click="openForm()"
                            :label="$t('export.addCollection')"
                            data-testid="export-add"
                            icon="i-lucide-file-plus-2"
                            tint="text-success"
                        >
                            {{ $t("export.addCollection") }}
                        </IconButton>
                        <span class="toolbar-rule" />
                        <IconButton
                            @click="selected !== undefined && openForm(selected)"
                            :disabled="selected === undefined"
                            :label="$t('export.editRow')"
                            icon="i-lucide-file-pen-line"
                            tint="text-warning"
                        />
                        <IconButton
                            @click="removeRow"
                            :disabled="marked.size === 0"
                            :label="$t('export.removeRow')"
                            data-testid="export-remove"
                            icon="i-lucide-file-x-2"
                            tint="text-error"
                        />
                    </div>

                    <!-- "Add collection" and editing a row, in place rather than in a small dialog. -->
                    <div
                        v-if="form"
                        class="grid grid-cols-[1fr_1fr_1fr_1.4fr_auto] gap-2 items-center p-2 rounded-sm border border-divider"
                        data-testid="export-form"
                    >
                        <!-- Another database: its collections differ, so the collection is chosen anew. -->
                        <ChoiceField
                            @update:modelValue="(database: string) => form && (form = { ...form, database, collection: '' })"
                            :label="$t('export.fromDatabase')"
                            :modelValue="form.database"
                            :options="sourceChoices"
                            :placeholder="$t('export.fromDatabase')"
                            data-testid="export-form-database"
                        />
                        <ChoiceField
                            v-model="form.collection"
                            :label="$t('export.fromCollection')"
                            :loading="formDatabase?.loading"
                            :options="formCollections"
                            :placeholder="$t('export.fromCollection')"
                            data-testid="export-form-collection"
                        />
                        <input
                            v-model="form.output"
                            :aria-label="$t('export.column.output')"
                            :placeholder="$t('export.column.output')"
                            class="field"
                            spellcheck="false"
                        />
                        <div class="field p-0! min-w-0">
                            <CodeEditor
                                v-model="form.filter"
                                :environment="environmentFor(form.database)"
                                :label="$t('export.column.filter')"
                                :placeholder="$t('export.allDocuments')"
                                :prefix="`db.getCollection(${JSON.stringify(form.collection)}).find(`"
                                singleLine
                            />
                        </div>
                        <div class="flex gap-1">
                            <ButtonRoot
                                @click="saveForm"
                                :disabled="!form.database.trim() || !form.collection.trim()"
                                class="btn-primary h-8!"
                                data-testid="export-form-save"
                            >
                                <ButtonContent>{{ $t(form.editing === undefined ? "action.add" : "action.save") }}</ButtonContent>
                            </ButtonRoot>
                            <IconButton
                                @click="form = undefined"
                                :label="$t('action.cancel')"
                                icon="i-lucide-x"
                            />
                        </div>
                    </div>

                    <!-- Del removes the selected rows, as Remove does. -->
                    <div
                        @click="rowSpace.onClick"
                        @contextmenu="rowSpace.onContextMenu"
                        @keydown.delete.self="removeRow"
                        class="grow min-h-0 overflow-auto rounded-sm bg-background border border-divider focus-visible:outline-1 focus-visible:outline-primary"
                        tabindex="0"
                    >
                        <table
                            class="w-full border-collapse text-[13px]"
                            data-testid="export-rows"
                        >
                            <thead>
                                <tr class="text-left">
                                    <th
                                        v-for="column in columns"
                                        :key="column"
                                        class="sticky top-0 z-1 bg-background px-2.5 pt-2 pb-1 font-normal"
                                    >
                                        <span class="block font-semibold text-on-surface-strong">{{ $t(`export.column.${column}`) }}</span>
                                        <span class="block text-[11.5px] text-on-surface-variant">{{ $t(`export.column.${column}.hint.${column === 'output' && state.format === 'database' ? 'collection' : 'default'}`) }}</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="(row, index) in state.rows"
                                    :key="`${row.database}.${row.collection}.${index}`"
                                    @click="clickRow($event, index)"
                                    :class="marked.has(index) ? 'bg-primary/15' : 'hover:bg-on-surface/4'"
                                    class="select-none"
                                    data-testid="export-row"
                                >
                                    <td class="px-2.5 py-1 border-t border-divider max-w-40 truncate">
                                        {{ row.database }}
                                    </td>
                                    <td class="px-2.5 py-1 border-t border-divider max-w-48 truncate">
                                        {{ row.collection }}
                                    </td>
                                    <td class="px-1 py-0.5 border-t border-divider">
                                        <input
                                            v-model="row.output"
                                            :aria-label="$t('export.column.output')"
                                            class="w-full h-7 px-1.5 bg-transparent border border-transparent rounded-sm focus:border-primary outline-none"
                                            data-testid="export-output"
                                            spellcheck="false"
                                        />
                                    </td>
                                    <!-- A one-line editor with completion, as the filter of the document browser. -->
                                    <td class="px-1 py-0.5 border-t border-divider max-w-0 w-[34%]">
                                        <div class="h-7 px-1 flex items-center overflow-hidden rounded-sm border border-transparent focus-within:border-primary">
                                            <CodeEditor
                                                v-model="row.filter"
                                                :environment="environmentFor(row.database)"
                                                :label="$t('export.column.filter')"
                                                :placeholder="$t('export.allDocuments')"
                                                :prefix="`db.getCollection(${JSON.stringify(row.collection)}).find(`"
                                                class="w-full"
                                                testid="export-filter"
                                                compact
                                                singleLine
                                            />
                                        </div>
                                    </td>
                                    <!-- Into a database, as a paste: add to the target, or replace it. -->
                                    <td
                                        v-if="state.format === 'database'"
                                        class="px-1 py-0.5 border-t border-divider w-36"
                                    >
                                        <ChoiceField
                                            @update:modelValue="(value: string) => setReplace(index, value === 'replace')"
                                            :label="$t('export.column.target')"
                                            :modelValue="row.replace ? 'replace' : 'append'"
                                            :options="targetModes"
                                            data-testid="export-target-mode"
                                        />
                                    </td>
                                </tr>
                                <!-- While the collections are read; with none, that there is nothing to export. -->
                                <tr v-if="wizard.loading || state.rows.length === 0">
                                    <td
                                        :colspan="columns.length"
                                        class="px-2.5 py-3 border-t border-divider text-on-surface-variant"
                                        data-testid="export-rows-state"
                                    >
                                        <span
                                            v-if="wizard.loading"
                                            class="inline-flex items-center gap-2"
                                        ><span class="i-lucide-loader-circle size-4 animate-spin" />{{ $t("export.loadingCollections") }}</span>
                                        <span v-else>{{ $t("export.nothingToExport") }}</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Page 2: the settings of the format. -->
                <div
                    v-else-if="wizard.step === 'settings'"
                    class="grow min-h-0 px-6 pt-6"
                >
                    <div
                        v-if="state.format === 'json'"
                        class="form-grid grid-cols-[10rem_1fr]!"
                    >
                        <span>{{ $t("export.json.notation") }}:</span>
                        <ChoiceField
                            v-model="notation"
                            :label="$t('export.json.notation')"
                            :options="notationOptions"
                            data-testid="export-notation"
                        />
                        <span>{{ $t("export.json.layout") }}:</span>
                        <ChoiceField
                            v-model="layout"
                            :label="$t('export.json.layout')"
                            :options="layoutOptions"
                            data-testid="export-layout"
                        />
                    </div>
                    <div
                        v-else-if="state.format === 'sql'"
                        class="form-grid grid-cols-[18rem_1fr]!"
                    >
                        <span>{{ $t("export.sql.dialect") }}:</span>
                        <ChoiceField
                            v-model="dialect"
                            :label="$t('export.sql.dialect')"
                            :options="dialectOptions"
                            data-testid="export-dialect"
                        />
                        <span>{{ $t("export.sql.schema") }}:</span>
                        <input
                            v-model="state.sql.schema"
                            :aria-label="$t('export.sql.schema')"
                            :placeholder="$t('export.sql.schema.placeholder')"
                            class="field"
                            data-testid="export-sql-schema"
                            spellcheck="false"
                        />
                        <template
                            v-for="flag in SQL_FLAGS"
                            :key="flag"
                        >
                            <span>{{ $t(`export.sql.${flag}`) }}:</span>
                            <SwitchRoot
                                v-model="state.sql[flag]"
                                :data-testid="`export-sql-${flag}`"
                                :label="$t(`export.sql.${flag}`)"
                            >
                                <SwitchTrack class="switch-track">
                                    <SwitchThumb class="switch-thumb" />
                                </SwitchTrack>
                            </SwitchRoot>
                        </template>
                    </div>
                    <div
                        v-else
                        class="form-grid grid-cols-[14rem_1fr]!"
                    >
                        <span>{{ $t("export.csv.delimiter") }}:</span>
                        <ChoiceField
                            v-model="delimiter"
                            :label="$t('export.csv.delimiter')"
                            :options="delimiterOptions"
                            data-testid="export-delimiter"
                        />
                        <span>{{ $t("export.csv.quote") }}:</span>
                        <ChoiceField
                            v-model="quote"
                            :label="$t('export.csv.quote')"
                            :options="quoteOptions"
                        />
                        <template
                            v-for="flag in CSV_FLAGS"
                            :key="flag"
                        >
                            <span>{{ $t(`export.csv.${flag}`) }}:</span>
                            <SwitchRoot
                                v-model="state.csv[flag]"
                                :data-testid="`export-csv-${flag}`"
                                :label="$t(`export.csv.${flag}`)"
                            >
                                <SwitchTrack class="switch-track">
                                    <SwitchThumb class="switch-thumb" />
                                </SwitchTrack>
                            </SwitchRoot>
                        </template>
                    </div>
                </div>

                <!-- Page 3 of CSV: the columns of each collection. -->
                <div
                    v-else-if="wizard.step === 'schema'"
                    class="grow min-h-0 px-6 pt-5"
                >
                    <ColumnSchema :state="state" />
                </div>

                <!-- Page 3: how far each row got. -->
                <TransferProgress
                    v-else
                    v-model:selected="failure"
                    :heads="[$t('transfer.progress.collection'), $t(state.format === 'database' ? 'transfer.progress.target' : 'transfer.progress.file')]"
                    :progress="wizard.progress"
                    :rows="progressRows"
                    :running="running"
                    kind="export"
                />

                <footer class="shrink-0 flex items-center gap-2 px-6 py-5">
                    <FormError
                        v-if="wizard.step === 'rows' && problemText && !wizard.loading"
                        :text="problemText"
                        data-testid="export-problem"
                    />
                    <TransferFailure
                        v-else-if="wizard.step === 'progress'"
                        :progress="wizard.progress"
                        :rows="progressRows"
                        :selected="failure"
                        kind="export"
                    />
                    <span
                        v-else
                        class="grow"
                    />
                    <template v-if="wizard.step === 'rows'">
                        <ButtonRoot
                            @click="next"
                            :disabled="problems.length > 0"
                            class="btn-primary"
                            data-testid="export-next"
                        >
                            <ButtonContent>{{ $t(state.format === "database" ? "export.start" : "action.next") }}</ButtonContent>
                        </ButtonRoot>
                    </template>
                    <template v-else-if="wizard.step === 'settings' || wizard.step === 'schema'">
                        <ButtonRoot
                            @click="wizard.step = wizard.step === 'schema' ? 'settings' : 'rows'"
                            class="btn-secondary"
                            data-testid="export-back"
                        >
                            <ButtonContent>{{ $t("action.back") }}</ButtonContent>
                        </ButtonRoot>
                        <ButtonRoot
                            v-if="wizard.step === 'settings' && hasColumns(state.format)"
                            @click="wizard.step = 'schema'"
                            class="btn-primary"
                            data-testid="export-schema"
                        >
                            <ButtonContent>{{ $t("action.next") }}</ButtonContent>
                        </ButtonRoot>
                        <ButtonRoot
                            v-else
                            @click="start"
                            class="btn-primary"
                            data-testid="export-start"
                        >
                            <ButtonContent>{{ $t("export.start") }}</ButtonContent>
                        </ButtonRoot>
                    </template>
                    <ButtonRoot
                        v-if="wizard.step === 'progress' && running"
                        @click="stop"
                        class="btn-secondary"
                        data-testid="export-stop"
                    >
                        <ButtonContent>{{ $t("action.stop") }}</ButtonContent>
                    </ButtonRoot>
                    <DialogClose
                        v-else
                        class="btn-secondary"
                        data-testid="export-close"
                    >
                        {{ $t(wizard.step === "progress" ? "action.close" : "action.cancel") }}
                    </DialogClose>
                </footer>
            </div>
            <!-- Inside the dialog, so that its menu is not behind the dialog's backdrop. -->
            <ContextMenu ref="spaceMenu" />
        </DialogContent>
    </DialogRoot>
</template>
