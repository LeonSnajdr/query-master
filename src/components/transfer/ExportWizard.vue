<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogClose, DialogContent, DialogRoot, DialogTitle, SwitchRoot, SwitchThumb, SwitchTrack } from "@vuetify/v0";
import { computed, shallowRef, useId } from "vue";
import { useI18n } from "vue-i18n";
import IconButton from "@/components/IconButton.vue";
import SelectField from "@/components/SelectField.vue";
import { useExportWizard } from "@/composables/exportWizard";
import { CSV_FILES, JSON_FILES, pickFolder, pickSavePath, SQL_FILES } from "@/files";
import type { FileKind } from "@/files";
import { useConnectionsStore } from "@/stores/connections";
import { defaultOutput, exportProblems, FILE_TARGETS, hasColumns, SQL_DIALECTS } from "@/transfer/export";
import type { CsvSettings, ExportFormat, ExportRow, FileTarget, InsertMode, JsonLayout, JsonNotation, SqlDialect } from "@/transfer/export";
import ColumnSchema from "./ColumnSchema.vue";

/** The export wizard: format tiles, rows of collections, settings, progress. */
const { t } = useI18n();
const connections = useConnectionsStore();
const { wizard, setFormat, addRows, chooseTargetConnection, start, stop, close } = useExportWizard();
const databaseList = useId();
const collectionList = useId();
const targetList = useId();

const open = computed({ get: () => wizard.open, set: value => !value && close() });
const state = computed(() => wizard.state);
const running = computed(() => wizard.runId !== undefined);

/** The tiles, with symbols. */
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
const insertOptions = computed(() => (["overwrite", "newId"] as InsertMode[]).map(value => ({ value, label: t(`export.insert.${value}`) })));
const notationOptions = computed(() => (["shell", "relaxed", "canonical"] as JsonNotation[]).map(value => ({ value, label: t(`export.json.notation.${value}`) })));
const layoutOptions = computed(() => (["lines", "comma", "array"] as JsonLayout[]).map(value => ({ value, label: t(`export.json.layout.${value}`) })));

const sourceDatabases = computed(() => connections.sessions[state.value.connectionId]?.databases.map(database => database.name) ?? []);
const targetDatabases = computed(() => connections.sessions[state.value.database.connectionId]?.databases.map(database => database.name) ?? []);
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

/** The row clicked last; edit and remove act on it. */
const selected = shallowRef<number>();
/** The form of "Add collection", also for editing a row (`editing` is its index). */
const form = shallowRef<{ database: string; collection: string; output: string; filter: string; editing?: number }>();
const formCollections = computed(() => (form.value?.database ? connections.collectionsOf(state.value.connectionId, form.value.database) : []));

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
    if (selected.value === undefined) return;
    state.value.rows = state.value.rows.filter((_, index) => index !== selected.value);
    selected.value = undefined;
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

const STATE_ICONS: Record<string, string> = {
    waiting: "i-lucide-circle-dashed text-on-surface-variant",
    running: "i-lucide-loader-circle animate-spin text-primary",
    done: "i-lucide-circle-check text-success",
    failed: "i-lucide-circle-x text-error",
    stopped: "i-lucide-circle-pause text-warning"
};
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
                                    <SelectField
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
                                    <SelectField
                                        v-model="server"
                                        :label="$t('export.server')"
                                        :options="serverOptions"
                                        data-testid="export-server"
                                    />
                                </div>
                                <datalist :id="targetList">
                                    <option
                                        v-for="name in targetDatabases"
                                        :key="name"
                                        :value="name"
                                    />
                                </datalist>
                                <input
                                    v-model="state.database.database"
                                    :aria-label="$t('export.targetDatabase')"
                                    :list="targetList"
                                    :placeholder="$t('export.targetDatabase.placeholder')"
                                    class="field grow"
                                    data-testid="export-target-database"
                                    spellcheck="false"
                                />
                            </div>
                            <span>{{ $t("export.insertMode") }}:</span>
                            <SelectField
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
                            :disabled="selected === undefined"
                            :label="$t('export.removeRow')"
                            data-testid="export-remove"
                            icon="i-lucide-file-x-2"
                            tint="text-error"
                        />
                    </div>

                    <!-- "Add collection" and editing a row, in place of the small dialog. -->
                    <div
                        v-if="form"
                        class="grid grid-cols-[1fr_1fr_1fr_1.4fr_auto] gap-2 items-center p-2 rounded-sm border border-divider"
                        data-testid="export-form"
                    >
                        <datalist :id="databaseList">
                            <option
                                v-for="name in sourceDatabases"
                                :key="name"
                                :value="name"
                            />
                        </datalist>
                        <datalist :id="collectionList">
                            <option
                                v-for="name in formCollections"
                                :key="name"
                                :value="name"
                            />
                        </datalist>
                        <input
                            v-model="form.database"
                            :aria-label="$t('export.fromDatabase')"
                            :list="databaseList"
                            :placeholder="$t('export.fromDatabase')"
                            class="field"
                            spellcheck="false"
                        />
                        <input
                            v-model="form.collection"
                            :aria-label="$t('export.fromCollection')"
                            :list="collectionList"
                            :placeholder="$t('export.fromCollection')"
                            class="field"
                            data-testid="export-form-collection"
                            spellcheck="false"
                        />
                        <input
                            v-model="form.output"
                            :aria-label="$t('export.column.output')"
                            :placeholder="$t('export.column.output')"
                            class="field"
                            spellcheck="false"
                        />
                        <input
                            v-model="form.filter"
                            :aria-label="$t('export.column.filter')"
                            :placeholder="$t('export.allDocuments')"
                            class="field font-mono"
                            spellcheck="false"
                        />
                        <div class="flex gap-1">
                            <ButtonRoot
                                @click="saveForm"
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

                    <div class="grow min-h-0 overflow-auto rounded-sm bg-background border border-divider">
                        <table
                            class="w-full border-collapse text-[13px]"
                            data-testid="export-rows"
                        >
                            <thead>
                                <tr class="text-left">
                                    <th
                                        v-for="column in ['database', 'collection', 'output', 'filter']"
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
                                    @click="selected = index"
                                    :class="selected === index ? 'bg-primary/15' : 'hover:bg-on-surface/4'"
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
                                    <td class="px-1 py-0.5 border-t border-divider">
                                        <input
                                            v-model="row.filter"
                                            :aria-label="$t('export.column.filter')"
                                            :placeholder="$t('export.allDocuments')"
                                            class="w-full h-7 px-1.5 bg-transparent border border-transparent rounded-sm focus:border-primary outline-none font-mono placeholder:italic placeholder:font-sans"
                                            data-testid="export-filter"
                                            spellcheck="false"
                                        />
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
                        <SelectField
                            v-model="notation"
                            :label="$t('export.json.notation')"
                            :options="notationOptions"
                            data-testid="export-notation"
                        />
                        <span>{{ $t("export.json.layout") }}:</span>
                        <SelectField
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
                        <SelectField
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
                        <SelectField
                            v-model="delimiter"
                            :label="$t('export.csv.delimiter')"
                            :options="delimiterOptions"
                            data-testid="export-delimiter"
                        />
                        <span>{{ $t("export.csv.quote") }}:</span>
                        <SelectField
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
                <div
                    v-else
                    class="grow min-h-0 flex flex-col px-6 pt-4 gap-3"
                >
                    <div class="h-1 rounded-full bg-on-surface/15 overflow-hidden">
                        <div
                            :class="running ? 'w-1/3 animate-pulse' : 'w-full'"
                            class="h-full bg-primary"
                        />
                    </div>
                    <div class="grow min-h-0 overflow-auto rounded-sm bg-background border border-divider">
                        <table
                            class="w-full border-collapse"
                            data-testid="export-progress"
                        >
                            <tbody>
                                <tr
                                    v-for="(row, index) in state.rows"
                                    :key="index"
                                    :data-state="wizard.progress[index]?.state"
                                    class="align-top"
                                    data-testid="export-progress-row"
                                >
                                    <td class="w-8 pl-2.5 py-1.5 border-b border-divider">
                                        <span
                                            :class="STATE_ICONS[wizard.progress[index]?.state ?? 'waiting']"
                                            class="size-4 block"
                                        />
                                    </td>
                                    <td class="py-1.5 pr-3 border-b border-divider">
                                        <span class="text-on-surface-strong">{{ row.database }}.{{ row.collection }}</span>
                                        <span class="text-on-surface-variant"> → {{ state.format === 'database' ? `${state.database.database}.${row.output}` : row.output }}</span>
                                        <span
                                            v-if="wizard.progress[index]?.error"
                                            class="block text-error break-words"
                                        >{{ wizard.progress[index]?.error }}</span>
                                    </td>
                                    <td class="w-32 py-1.5 pr-3 border-b border-divider text-right tabular-nums text-on-surface-variant">
                                        {{ $t("task.count", { done: (wizard.progress[index]?.done ?? 0).toLocaleString() }, wizard.progress[index]?.done ?? 0) }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <footer class="shrink-0 flex items-center gap-2 px-6 py-5">
                    <p
                        v-if="wizard.step === 'rows' && problemText && state.rows.length > 0"
                        class="m-0 grow text-error"
                        data-testid="export-problem"
                    >
                        {{ problemText }}
                    </p>
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
        </DialogContent>
    </DialogRoot>
</template>
