<script setup lang="ts">
import { ButtonContent, ButtonRoot, PopoverActivator, PopoverContent, PopoverRoot } from "@vuetify/v0";
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { namesAsChoices } from "@/choice";
import ChoiceField from "@/components/ChoiceField.vue";
import IconButton from "@/components/IconButton.vue";
import { useConnectionsStore } from "@/stores/connections";
import { splitPath } from "@/transfer/export";
import type { InsertMode } from "@/transfer/export";
import type { ImportRow, ImportState } from "@/transfer/import";

const emit = defineEmits<{
    addFiles: [];
}>();
/**
 * The files of the import, in columns: Database, Collection, Mode, From file.
 * Beyond it: rows are selected as in the result table (click, Ctrl, Shift, the boxes), a double
 * click or the edit button edits a row in place, a click on a column header sets that column for
 * the selected rows (or all), and the mode chosen in a selected row goes to every selected row.
 */
const props = defineProps<{
    state: ImportState;
    /** Files are being dragged over the window. */
    dragging: boolean;
}>();
const { t } = useI18n();
const connections = useConnectionsStore();

const MODES: InsertMode[] = ["overwrite", "newId"];
const modeOptions = computed(() => MODES.map(value => ({ value, label: t(`import.mode.${value}`) })));
const databases = computed(() => namesAsChoices(connections.sessions[props.state.connectionId]?.databases.map(database => database.name) ?? []));

/** The collections of a database of the target server, views marked; read when first needed. */
function collectionChoices(name: string) {
    if (!name) return [];
    const names = connections.collectionsOf(props.state.connectionId, name);
    const types = connections.sessions[props.state.connectionId]?.databases.find(database => database.name === name)?.types ?? {};
    return namesAsChoices(names, Object.fromEntries(names.map(collection => [collection, types[collection] === "view" ? t("choice.view") : undefined])));
}

function collectionsLoading(name: string): boolean {
    return connections.sessions[props.state.connectionId]?.databases.find(database => database.name === name)?.loading ?? false;
}

/** The import creates this database: the server is known and has none of that name. */
function isNewDatabase(name: string): boolean {
    return connections.sessions[props.state.connectionId] !== undefined && !databases.value.some(choice => choice.value === name);
}

/** The import creates this collection, in a new database or one whose collections are known. */
function isNewCollection(database: string, collection: string): boolean {
    if (isNewDatabase(database)) return true;
    return !collectionsLoading(database) && !collectionChoices(database).some(choice => choice.value === collection);
}

const rows = computed(() => props.state.rows);
const selected = ref(new Set<number>());
let anchor: number | undefined;
// Rows come and go (added, removed): what was selected no longer means the same rows.
watch(() => rows.value.length, () => {
    selected.value = new Set();
    anchor = undefined;
});

function setRows(next: ImportRow[]) {
    // eslint-disable-next-line vue/no-mutating-props -- the wizard's state object, owned by the composable
    props.state.rows = next;
}

/** The rows a change applies to: the selected ones, or all when none is selected. */
const targets = computed(() => (selected.value.size > 0 ? [...selected.value] : rows.value.map((_, index) => index)));

function click(event: MouseEvent, index: number) {
    if (event.shiftKey && anchor !== undefined) {
        const next = new Set<number>();
        for (let at = Math.min(anchor, index); at <= Math.max(anchor, index); at++) next.add(at);
        selected.value = next;
        return;
    }
    if (event.ctrlKey || event.metaKey) toggle(index);
    else selected.value = new Set([index]);
    anchor = index;
}

function toggle(index: number) {
    const next = new Set(selected.value);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    selected.value = next;
    anchor = index;
}

const allSelected = computed(() => rows.value.length > 0 && selected.value.size === rows.value.length);
function toggleAll() {
    selected.value = allSelected.value ? new Set() : new Set(rows.value.map((_, index) => index));
}

function setField(indexes: number[], change: Partial<ImportRow>) {
    const chosen = new Set(indexes);
    setRows(rows.value.map((row, index) => (chosen.has(index) ? { ...row, ...change } : row)));
}

/** The mode of one row; with that row among several selected, of all of them. */
function setMode(index: number, mode: InsertMode) {
    setField(selected.value.has(index) && selected.value.size > 1 ? [...selected.value] : [index], { mode });
}

function remove() {
    if (selected.value.size === 0) return;
    setRows(rows.value.filter((_, index) => !selected.value.has(index)));
}

// Editing in place: the row's fields become inputs; Enter or leaving the row keeps, Esc drops.
const editing = shallowRef<number>();
const draft = ref({ database: "", collection: "" });
const draftCollections = computed(() => collectionChoices(draft.value.database));

async function edit(index: number) {
    const row = rows.value[index];
    if (!row) return;
    editing.value = index;
    draft.value = { database: row.database, collection: row.collection };
    selected.value = new Set([index]);
    anchor = index;
    await nextTick();
    const input = document.querySelector<HTMLInputElement>("[data-testid=import-edit-collection]");
    input?.focus();
    input?.select();
}

function commit() {
    const index = editing.value;
    if (index === undefined) return;
    editing.value = undefined;
    setField([index], { database: draft.value.database.trim(), collection: draft.value.collection.trim() });
}

/** Leaving the row (not just moving between its two inputs) keeps the edit. */
function leave(event: FocusEvent) {
    const next = event.relatedTarget as HTMLElement | null;
    if (!next?.closest("[data-editing]")) commit();
}

function editSelected() {
    const first = [...selected.value].sort((a, b) => a - b)[0];
    if (first !== undefined) void edit(first);
}

function onKey(event: KeyboardEvent) {
    if (editing.value !== undefined) return;
    // Keys typed into a field (the one of a column header) belong to its text, not to the rows.
    if ((event.target as HTMLElement).closest("input:not([type=checkbox]), textarea, [contenteditable]")) return;
    if (event.key === "Delete") remove();
    else if (event.key === "F2" || event.key === "Enter") editSelected();
    else if (event.key === "a" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        selected.value = new Set(rows.value.map((_, index) => index));
    }
}

// A click on a column header: one value for the selected rows, or for all.
const bulkOpen = ref<Record<string, boolean>>({ database: false, collection: false, mode: false });
const bulkValue = shallowRef("");
/** The collections offered in the header: those of the database of the first row it applies to. */
const bulkDatabase = computed(() => rows.value[targets.value[0] ?? -1]?.database ?? "");
const bulkCollections = computed(() => collectionChoices(bulkDatabase.value));
function openBulk(column: "database" | "collection") {
    const first = rows.value[targets.value[0] ?? -1];
    bulkValue.value = first ? first[column] : "";
}
function applyBulk(column: "database" | "collection") {
    const value = bulkValue.value.trim();
    if (value) setField(targets.value, { [column]: value });
    bulkOpen.value[column] = false;
}
function applyMode(mode: InsertMode) {
    setField(targets.value, { mode });
    bulkOpen.value.mode = false;
}

const summary = computed(() => {
    const files = t("import.files", { count: rows.value.length }, rows.value.length);
    return selected.value.size > 0 ? t("import.filesSelected", { files, count: selected.value.size }) : files;
});

defineExpose({ editSelected, remove });
</script>

<template>
    <div class="grow min-h-0 flex flex-col gap-2">
        <div class="flex items-center gap-0.5">
            <IconButton
                @click="emit('addFiles')"
                :label="$t('import.addFiles')"
                data-testid="import-add"
                icon="i-lucide-file-plus-2"
                tint="text-success"
            >
                {{ $t("import.addFiles") }}
            </IconButton>
            <span class="toolbar-rule" />
            <IconButton
                @click="editSelected"
                :disabled="selected.size === 0"
                :label="$t('import.editRow')"
                data-testid="import-edit"
                icon="i-lucide-file-pen-line"
                tint="text-warning"
            />
            <IconButton
                @click="remove"
                :disabled="selected.size === 0"
                :label="$t('import.removeRow')"
                data-testid="import-remove"
                icon="i-lucide-file-x-2"
                tint="text-error"
            />
        </div>

        <div
            :class="dragging ? 'border-primary border-dashed bg-primary/8' : 'border-divider'"
            class="grow min-h-0 overflow-auto rounded-sm bg-background border"
        >
            <p
                v-if="rows.length === 0"
                class="h-full m-0 flex items-center justify-center text-on-surface-variant"
                data-testid="import-empty"
            >
                {{ $t("import.empty") }}
            </p>
            <table
                v-else
                @keydown="onKey"
                class="w-full border-collapse table-fixed text-[13px] outline-none"
                data-testid="import-rows"
                tabindex="0"
            >
                <colgroup>
                    <col class="w-8" />
                    <col class="w-[26%]" />
                    <col class="w-[24%]" />
                    <col class="w-[24%]" />
                    <col />
                </colgroup>
                <thead>
                    <tr class="text-left">
                        <th class="sticky top-0 z-1 bg-background pl-2.5 pt-2 pb-1">
                            <input
                                @change="toggleAll"
                                :aria-label="$t('import.selectAll')"
                                :checked="allSelected"
                                class="size-3.5 accent-primary"
                                data-testid="import-select-all"
                                type="checkbox"
                            />
                        </th>
                        <th
                            v-for="column in (['database', 'collection'] as const)"
                            :key="column"
                            class="sticky top-0 z-1 bg-background p-0 font-normal"
                        >
                            <PopoverRoot v-model="bulkOpen[column]">
                                <PopoverActivator
                                    @click="openBulk(column)"
                                    :data-testid="`import-header-${column}`"
                                    :title="$t('import.setFor', { count: targets.length }, targets.length)"
                                    class="w-full px-2.5 pt-2 pb-1 text-left hover:bg-on-surface/5"
                                >
                                    <span class="block font-semibold text-on-surface-strong">{{ $t(`import.column.${column}`) }} <span class="i-lucide-pencil size-3 opacity-50" /></span>
                                    <span class="block text-[11.5px] text-on-surface-variant">{{ $t("import.column.name") }}</span>
                                </PopoverActivator>
                                <PopoverContent class="menu-panel p-3 w-72">
                                    <form
                                        @submit.prevent="applyBulk(column)"
                                        class="flex flex-col gap-2"
                                    >
                                        <span class="text-on-surface-variant">{{ $t(`import.setColumn.${column}`, { count: targets.length }, targets.length) }}</span>
                                        <ChoiceField
                                            v-model="bulkValue"
                                            :label="$t(`import.column.${column}`)"
                                            :loading="column === 'collection' && collectionsLoading(bulkDatabase)"
                                            :options="column === 'database' ? databases : bulkCollections"
                                            data-testid="import-bulk-value"
                                            free
                                            markNew
                                        />
                                        <ButtonRoot
                                            @click="applyBulk(column)"
                                            class="btn-primary self-end"
                                            data-testid="import-bulk-apply"
                                        >
                                            <ButtonContent>{{ $t("import.apply", { count: targets.length }, targets.length) }}</ButtonContent>
                                        </ButtonRoot>
                                    </form>
                                </PopoverContent>
                            </PopoverRoot>
                        </th>
                        <th class="sticky top-0 z-1 bg-background p-0 font-normal">
                            <PopoverRoot v-model="bulkOpen.mode">
                                <PopoverActivator
                                    :title="$t('import.setFor', { count: targets.length }, targets.length)"
                                    class="w-full px-2.5 pt-2 pb-1 text-left hover:bg-on-surface/5"
                                    data-testid="import-header-mode"
                                >
                                    <span class="block font-semibold text-on-surface-strong">{{ $t("import.column.mode") }} <span class="i-lucide-pencil size-3 opacity-50" /></span>
                                    <span class="block text-[11.5px] text-on-surface-variant">{{ $t("import.column.mode.hint") }}</span>
                                </PopoverActivator>
                                <PopoverContent class="menu-panel py-1 w-64">
                                    <span class="block px-3 py-1 text-on-surface-variant">{{ $t("import.setColumn.mode", { count: targets.length }, targets.length) }}</span>
                                    <button
                                        v-for="mode in MODES"
                                        :key="mode"
                                        @click="applyMode(mode)"
                                        class="w-full px-3 py-1 text-left hover:bg-primary/25"
                                        data-testid="import-bulk-mode"
                                        type="button"
                                    >
                                        {{ $t(`import.mode.${mode}`) }}
                                    </button>
                                </PopoverContent>
                            </PopoverRoot>
                        </th>
                        <th class="sticky top-0 z-1 bg-background px-2.5 pt-2 pb-1 font-normal">
                            <span class="block font-semibold text-on-surface-strong">{{ $t("import.column.file") }}</span>
                            <span class="block text-[11.5px] text-on-surface-variant">{{ $t("import.column.path") }}</span>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="(row, index) in rows"
                        :key="row.path"
                        @click="click($event, index)"
                        @dblclick="edit(index)"
                        :class="selected.has(index) ? 'bg-primary/15' : 'hover:bg-on-surface/4'"
                        :data-editing="editing === index || undefined"
                        :data-selected="selected.has(index) || undefined"
                        data-testid="import-row"
                    >
                        <td
                            @click.stop="toggle(index)"
                            class="pl-2.5 border-t border-divider"
                        >
                            <input
                                :aria-label="$t('import.selectRow')"
                                :checked="selected.has(index)"
                                class="size-3.5 accent-primary pointer-events-none"
                                tabindex="-1"
                                type="checkbox"
                            />
                        </td>
                        <!-- Enter and Esc reach the cell only when the field's list did not use them. -->
                        <template v-if="editing === index">
                            <td
                                @focusout="leave"
                                @keydown.enter.stop.prevent="commit"
                                @keydown.esc.stop.prevent="editing = undefined"
                                class="px-1 py-0.5 border-t border-divider"
                            >
                                <ChoiceField
                                    v-model="draft.database"
                                    :label="$t('import.column.database')"
                                    :options="databases"
                                    data-testid="import-edit-database"
                                    size="compact"
                                    free
                                    markNew
                                />
                            </td>
                            <td
                                @focusout="leave"
                                @keydown.enter.stop.prevent="commit"
                                @keydown.esc.stop.prevent="editing = undefined"
                                class="px-1 py-0.5 border-t border-divider"
                            >
                                <ChoiceField
                                    v-model="draft.collection"
                                    :label="$t('import.column.collection')"
                                    :loading="collectionsLoading(draft.database)"
                                    :options="draftCollections"
                                    data-testid="import-edit-collection"
                                    size="compact"
                                    free
                                    markNew
                                />
                            </td>
                        </template>
                        <template v-else>
                            <td
                                :title="row.database"
                                class="px-2.5 py-1 border-t border-divider"
                            >
                                <span class="flex items-center gap-1.5">
                                    <span
                                        class="truncate"
                                        data-testid="import-database"
                                    >{{ row.database }}</span>
                                    <span
                                        v-if="isNewDatabase(row.database)"
                                        class="shrink-0 badge-new"
                                    >{{ $t("choice.new") }}</span>
                                </span>
                            </td>
                            <td
                                :title="row.collection"
                                class="px-2.5 py-1 border-t border-divider"
                            >
                                <span class="flex items-center gap-1.5">
                                    <span
                                        class="truncate"
                                        data-testid="import-collection"
                                    >{{ row.collection }}</span>
                                    <span
                                        v-if="isNewCollection(row.database, row.collection)"
                                        class="shrink-0 badge-new"
                                        data-testid="import-collection-new"
                                    >{{ $t("choice.new") }}</span>
                                </span>
                            </td>
                        </template>
                        <td
                            @click.stop
                            @dblclick.stop
                            class="px-1 py-0.5 border-t border-divider"
                        >
                            <ChoiceField
                                @update:modelValue="(mode: InsertMode) => setMode(index, mode)"
                                :label="$t('import.column.mode')"
                                :modelValue="row.mode"
                                :options="modeOptions"
                                size="compact"
                            />
                        </td>
                        <td
                            :title="row.path"
                            class="px-2.5 py-1 border-t border-divider truncate text-on-surface-variant"
                        >
                            {{ splitPath(row.path).name }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <span
            class="text-on-surface-variant"
            data-testid="import-summary"
        >{{ rows.length > 0 ? `${summary} · ${$t("import.hint")}` : "" }}</span>
    </div>
</template>
