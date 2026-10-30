<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { computed, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import IconButton from "@/components/IconButton.vue";
import ChoiceField from "@/components/ChoiceField.vue";
import FormError from "@/components/FormError.vue";
import { useMessages } from "@/composables/messages";
import type { Json } from "@/shell/ejson";
import { analyze, mainType, mixedTypes, SCHEMA_TIME } from "@/shell/schema";
import type { FieldStats } from "@/shell/schema";
import { columnsKey, filterValue } from "@/transfer/export";
import type { ExportState } from "@/transfer/export";

/**
 * The schema page (CSV, SQL): the fields of a collection on the left as a tree
 * with their type, the columns of the file or table on the right, `>>` and `<<` between them. A
 * column can be renamed (the header or the column of the table). The fields come from a sample of
 * the documents the row exports (its filter or pipeline). Columns are kept per collection in
 * `state.columns`, names in `state.names`; without a choice the fields of the first level are taken.
 */
const props = defineProps<{
    state: ExportState;
}>();

const { t } = useI18n();
const { say } = useMessages();

/** Documents read to learn the fields: many more than the editor's sample Refresh. */
const SAMPLE = 1000;

/** The collections of the rows, each once, with the filter of its first row. */
const collections = computed(() => {
    const seen = new Map<string, { database: string; collection: string; filter: string }>();
    for (const row of props.state.rows) {
        if (!seen.has(columnsKey(row))) seen.set(columnsKey(row), { database: row.database, collection: row.collection, filter: row.filter });
    }
    return [...seen.entries()].map(([key, value]) => ({ key, ...value }));
});
const current = shallowRef(collections.value[0]?.key ?? "");
const collectionOptions = computed(() => collections.value.map(item => ({ value: item.key, label: item.key })));

/** What the sample of each collection taught; read once per collection while the wizard is open. */
const samples = shallowRef(new Map<string, { loading: boolean; fields: FieldStats[]; error?: string }>());
const sample = computed(() => samples.value.get(current.value));

async function read(key: string) {
    const item = collections.value.find(entry => entry.key === key);
    if (!item || samples.value.get(key)?.loading) return;
    samples.value = new Map(samples.value).set(key, { loading: true, fields: [] });
    let next: { loading: boolean; fields: FieldStats[]; error?: string };
    try {
        const filter = filterValue(item.filter);
        const pipeline: Json[] = Array.isArray(filter) ? [...filter] : filter ? [{ $match: filter }] : [];
        pipeline.push({ $sample: { size: SAMPLE } });
        const page = await backend.runCursorCommand(props.state.connectionId, item.database, { aggregate: item.collection, pipeline, cursor: {}, maxTimeMS: SCHEMA_TIME }, SAMPLE);
        next = { loading: false, fields: treeOrder(analyze(page.documents).fields) };
    } catch (error) {
        // A view that can not be sampled, missing rights, a time limit: said, and paths can be typed.
        next = { loading: false, fields: [], error: say(errorMessage(error)) };
    }
    samples.value = new Map(samples.value).set(key, next);
}
watch(current, key => key && !samples.value.has(key) && void read(key), { immediate: true });

/** Fields as a tree: each right after its parent, siblings in the order of the documents. */
function treeOrder(fields: FieldStats[]): FieldStats[] {
    const byPath = new Map(fields.map(field => [field.path, field]));
    const ordered: FieldStats[] = [];
    const visit = (field: FieldStats) => {
        ordered.push(field);
        for (const child of field.children) {
            const found = byPath.get(child);
            if (found) visit(found);
        }
    };
    for (const field of fields) if (field.depth === 0) visit(field);
    return ordered;
}

/** The type a field shows: its main one, or `mixed` when its values differ. */
function typeLabel(field: FieldStats | undefined): string {
    if (!field) return "";
    return mixedTypes(field) ? t("export.schema.mixed") : mainType(field) ?? "";
}

const fields = computed(() => sample.value?.fields ?? []);
const byPath = computed(() => new Map(fields.value.map(field => [field.path, field])));
const chosen = computed<string[]>(() => props.state.columns[current.value]
    ?? fields.value.filter(field => field.depth === 0).map(field => field.path).sort((a, b) => Number(b === "_id") - Number(a === "_id")));
const offered = computed(() => fields.value.filter(field => !chosen.value.includes(field.path)));
/** The tree on the left: the fields not chosen, and a chosen one still when fields below it are not (shown grey). */
const shown = computed(() => fields.value.filter(field => !chosen.value.includes(field.path) || offered.value.some(other => other.path.startsWith(`${field.path}.`))));

const left = shallowRef(new Set<string>());
const right = shallowRef(new Set<string>());
const typed = shallowRef("");
watch(current, () => {
    left.value = new Set();
    right.value = new Set();
});

function setChosen(columns: string[]) {
    // A new object: the state is reactive as a whole and keeps the choice per collection.
    // eslint-disable-next-line vue/no-mutating-props -- the wizard's state object, owned by the composable
    props.state.columns = { ...props.state.columns, [current.value]: columns };
}

/** The name a column gets in the file or table, as typed; empty for its path. */
function nameOf(path: string): string {
    return props.state.names[current.value]?.[path] ?? "";
}

function rename(path: string, name: string) {
    // Renaming a column of the default choice fixes the choice, so the name has a column to stay with.
    if (!props.state.columns[current.value]) setChosen(chosen.value);
    // eslint-disable-next-line vue/no-mutating-props -- the wizard's state object, owned by the composable
    props.state.names = { ...props.state.names, [current.value]: { ...props.state.names[current.value], [path]: name } };
}

/** The name a column has without one typed: its path, in SQL with `_` for `.`. */
function defaultName(path: string): string {
    return props.state.format === "sql" ? path.replaceAll(".", "_") : path;
}

function toggle(set: Set<string>, field: string): Set<string> {
    const next = new Set(set);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    return next;
}

function add() {
    const picked = offered.value.filter(field => left.value.has(field.path)).map(field => field.path);
    // Without a selection all fields that are left.
    setChosen([...chosen.value, ...(picked.length > 0 ? picked : offered.value.map(field => field.path))]);
    left.value = new Set();
}

function remove() {
    if (right.value.size === 0) return;
    setChosen(chosen.value.filter(field => !right.value.has(field)));
    right.value = new Set();
}

function addTyped() {
    const field = typed.value.trim();
    if (field && !chosen.value.includes(field)) setChosen([...chosen.value, field]);
    typed.value = "";
}

function move(by: -1 | 1) {
    const columns = [...chosen.value];
    const indexes = columns.map((field, index) => (right.value.has(field) ? index : -1)).filter(index => index !== -1);
    if (indexes.length !== 1) return;
    const from = indexes[0]!;
    const to = from + by;
    if (to < 0 || to >= columns.length) return;
    [columns[from], columns[to]] = [columns[to]!, columns[from]!];
    setChosen(columns);
}

/** Exactly one column selected that can move that way. */
const movable = computed(() => {
    const indexes = chosen.value.map((field, index) => (right.value.has(field) ? index : -1)).filter(index => index !== -1);
    const index = indexes.length === 1 ? indexes[0]! : -1;
    return { up: index > 0, down: index !== -1 && index < chosen.value.length - 1 };
});

function reset() {
    const columns = { ...props.state.columns };
    delete columns[current.value];
    const names = { ...props.state.names };
    delete names[current.value];
    // eslint-disable-next-line vue/no-mutating-props -- the wizard's state object, owned by the composable
    props.state.columns = columns;
    // eslint-disable-next-line vue/no-mutating-props -- the wizard's state object, owned by the composable
    props.state.names = names;
}

function refresh() {
    samples.value = new Map([...samples.value].filter(([key]) => key !== current.value));
    void read(current.value);
}
</script>

<template>
    <div
        class="h-full min-h-0 flex flex-col gap-3"
        data-testid="column-schema"
    >
        <div class="form-grid grid-cols-[10rem_1fr]!">
            <span>{{ $t("export.schema.collection") }}:</span>
            <ChoiceField
                v-model="current"
                :label="$t('export.schema.collection')"
                :options="collectionOptions"
            />
        </div>
        <div class="border-t border-divider" />
        <div class="grow min-h-0 grid grid-cols-[1fr_auto_1.2fr] gap-3">
            <div class="min-h-0 flex flex-col gap-1">
                <div class="h-7 flex items-center gap-1">
                    <input
                        v-model="typed"
                        @keydown.enter.prevent="addTyped"
                        :aria-label="$t('export.schema.addField')"
                        :placeholder="$t('export.schema.addField')"
                        class="field h-7! grow font-mono"
                        data-testid="schema-typed"
                        spellcheck="false"
                    />
                    <IconButton
                        @click="addTyped"
                        :disabled="!typed.trim()"
                        :label="$t('export.schema.addField')"
                        icon="i-lucide-plus"
                        tint="text-success"
                    />
                    <IconButton
                        @click="refresh"
                        :disabled="sample?.loading"
                        :label="$t('export.schema.refresh')"
                        icon="i-lucide-refresh-cw"
                    />
                </div>
                <div class="relative grow min-h-0 flex flex-col rounded-sm bg-background border border-divider">
                    <!-- While the sample is read: a bar along the top. -->
                    <div
                        v-if="sample?.loading"
                        class="absolute inset-x-0 top-0 h-0.5 overflow-hidden"
                        data-testid="schema-loading"
                    >
                        <div class="h-full w-1/3 bg-primary animate-pulse" />
                    </div>
                    <ul
                        :aria-label="$t('export.schema.fields')"
                        class="grow min-h-0 overflow-y-auto m-0 p-0 list-none"
                        data-testid="schema-fields"
                    >
                        <li
                            v-for="field in shown"
                            :key="field.path"
                            @click="!chosen.includes(field.path) && (left = toggle(left, field.path))"
                            @dblclick="!chosen.includes(field.path) && setChosen([...chosen, field.path])"
                            :class="chosen.includes(field.path) ? 'opacity-45' : left.has(field.path) ? 'bg-primary/20 text-on-surface-strong' : 'hover:bg-on-surface/5'"
                            :style="{ paddingLeft: `${0.625 + field.depth}rem` }"
                            :title="field.path"
                            class="pr-2.5 py-0.5 flex items-center gap-2 font-mono text-[12.5px] cursor-default"
                        >
                            <span class="grow truncate">{{ field.path.split(".").at(-1) }}</span>
                            <span class="shrink-0 font-sans text-[11px] text-on-surface-variant">{{ typeLabel(field) }}</span>
                        </li>
                        <li
                            v-if="sample?.loading && offered.length === 0"
                            class="px-2.5 py-1 text-on-surface-variant"
                        >
                            {{ $t("export.schema.loading") }}
                        </li>
                    </ul>
                </div>
                <FormError
                    v-if="sample?.error"
                    :text="$t('export.schema.failed', { detail: sample.error })"
                    data-testid="schema-error"
                />
            </div>
            <div class="self-center flex flex-col gap-2">
                <ButtonRoot
                    @click="add"
                    :ariaLabel="$t('export.schema.add')"
                    :disabled="offered.length === 0"
                    :title="$t('export.schema.add')"
                    class="btn-secondary px-2.5!"
                    data-testid="schema-add"
                >
                    <ButtonContent>&gt;&gt;</ButtonContent>
                </ButtonRoot>
                <ButtonRoot
                    @click="remove"
                    :ariaLabel="$t('export.schema.remove')"
                    :disabled="right.size === 0"
                    :title="$t('export.schema.remove')"
                    class="btn-secondary px-2.5!"
                    data-testid="schema-remove"
                >
                    <ButtonContent>&lt;&lt;</ButtonContent>
                </ButtonRoot>
            </div>
            <div class="min-h-0 flex flex-col gap-1">
                <div class="h-7 flex items-center gap-0.5">
                    <span class="grow text-on-surface-variant">{{ $t("export.schema.columns", { count: chosen.length }) }}</span>
                    <IconButton
                        @click="move(-1)"
                        :disabled="!movable.up"
                        :label="$t('indexDialog.up')"
                        icon="i-lucide-arrow-up"
                    />
                    <IconButton
                        @click="move(1)"
                        :disabled="!movable.down"
                        :label="$t('indexDialog.down')"
                        icon="i-lucide-arrow-down"
                    />
                    <IconButton
                        @click="reset"
                        :disabled="!state.columns[current]"
                        :label="$t('export.schema.reset')"
                        icon="i-lucide-rotate-ccw"
                    />
                </div>
                <ol
                    :aria-label="$t('export.schema.chosen')"
                    class="grow min-h-0 overflow-y-auto m-0 p-0 list-none rounded-sm bg-background border border-divider"
                    data-testid="schema-columns"
                >
                    <li
                        v-for="field in chosen"
                        :key="field"
                        @click="right = toggle(right, field)"
                        :class="right.has(field) ? 'bg-primary/20 text-on-surface-strong' : 'hover:bg-on-surface/5'"
                        class="pl-2.5 pr-1 py-0.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 font-mono text-[12.5px] cursor-default"
                        data-testid="schema-column"
                    >
                        <span
                            @dblclick="setChosen(chosen.filter(item => item !== field))"
                            :title="field"
                            class="truncate"
                        >{{ field }}</span>
                        <!-- The name in the file or table; empty keeps the path. -->
                        <input
                            @click.stop
                            @input="rename(field, ($event.target as HTMLInputElement).value)"
                            :aria-label="$t('export.schema.name', { field })"
                            :placeholder="defaultName(field)"
                            :value="nameOf(field)"
                            class="h-6 min-w-0 px-1.5 bg-transparent border border-transparent rounded-sm hover:border-divider focus:border-primary outline-none"
                            data-testid="schema-name"
                            spellcheck="false"
                        />
                        <span class="w-14 truncate font-sans text-[11px] text-on-surface-variant text-right">{{ typeLabel(byPath.get(field)) }}</span>
                    </li>
                </ol>
            </div>
        </div>
        <p class="m-0 text-on-surface-variant">
            {{ t("export.schema.hint") }}
        </p>
    </div>
</template>
