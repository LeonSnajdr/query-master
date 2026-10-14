<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { computed, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import IconButton from "@/components/IconButton.vue";
import SelectField from "@/components/SelectField.vue";
import { useConnectionsStore } from "@/stores/connections";
import { columnsKey } from "@/transfer/export";
import type { ExportState } from "@/transfer/export";

/**
 * The schema page (CSV, SQL): the fields of a collection on the left, the
 * columns of the file on the right, `>>` and `<<` between them. The columns are kept per
 * collection in `state.columns`; without a choice the fields of the first level are taken.
 */
const props = defineProps<{
    state: ExportState;
}>();

const { t } = useI18n();
const connections = useConnectionsStore();

/** The collections of the rows, each once. */
const collections = computed(() => {
    const seen = new Map<string, { database: string; collection: string }>();
    for (const row of props.state.rows) seen.set(columnsKey(row), { database: row.database, collection: row.collection });
    return [...seen.entries()].map(([key, value]) => ({ key, ...value }));
});
const current = shallowRef(collections.value[0]?.key ?? "");
const collectionOptions = computed(() => collections.value.map(item => ({ value: item.key, label: item.key })));
const active = computed(() => collections.value.find(item => item.key === current.value));

/** Every field path of the collection, from its sample. */
const fields = computed(() => (active.value ? connections.fieldsOf(props.state.connectionId, active.value.database, active.value.collection) : []));
const chosen = computed<string[]>(() => props.state.columns[current.value] ?? fields.value.filter(field => !field.includes(".")).sort((a, b) => Number(b === "_id") - Number(a === "_id")));
const offered = computed(() => fields.value.filter(field => !chosen.value.includes(field)));

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

function toggle(set: Set<string>, field: string): Set<string> {
    const next = new Set(set);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    return next;
}

function add() {
    const picked = offered.value.filter(field => left.value.has(field));
    setChosen([...chosen.value, ...(picked.length > 0 ? picked : offered.value)]);
    left.value = new Set();
}

function remove() {
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

function reset() {
    const columns = { ...props.state.columns };
    delete columns[current.value];
    // eslint-disable-next-line vue/no-mutating-props -- the wizard's state object, owned by the composable
    props.state.columns = columns;
}
</script>

<template>
    <div
        class="h-full min-h-0 flex flex-col gap-3"
        data-testid="column-schema"
    >
        <div class="form-grid grid-cols-[10rem_1fr]!">
            <span>{{ $t("export.schema.collection") }}:</span>
            <SelectField
                v-model="current"
                :label="$t('export.schema.collection')"
                :options="collectionOptions"
            />
        </div>
        <div class="border-t border-divider" />
        <div class="grow min-h-0 grid grid-cols-[1fr_auto_1fr] gap-3">
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
                        :label="$t('export.schema.addField')"
                        icon="i-lucide-plus"
                        tint="text-success"
                    />
                </div>
                <ul
                    :aria-label="$t('export.schema.fields')"
                    class="grow min-h-0 overflow-y-auto m-0 p-0 list-none rounded-sm bg-background border border-divider"
                    data-testid="schema-fields"
                >
                    <li
                        v-for="field in offered"
                        :key="field"
                        @click="left = toggle(left, field)"
                        @dblclick="setChosen([...chosen, field])"
                        :class="left.has(field) ? 'bg-primary/20 text-on-surface-strong' : 'hover:bg-on-surface/5'"
                        class="px-2.5 py-0.5 font-mono text-[12.5px] cursor-default"
                    >
                        {{ field }}
                    </li>
                </ul>
            </div>
            <div class="self-center flex flex-col gap-2">
                <ButtonRoot
                    @click="add"
                    :ariaLabel="$t('export.schema.add')"
                    :title="$t('export.schema.add')"
                    class="btn-secondary px-2.5!"
                    data-testid="schema-add"
                >
                    <ButtonContent>&gt;&gt;</ButtonContent>
                </ButtonRoot>
                <ButtonRoot
                    @click="remove"
                    :ariaLabel="$t('export.schema.remove')"
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
                        :label="$t('indexDialog.up')"
                        icon="i-lucide-arrow-up"
                    />
                    <IconButton
                        @click="move(1)"
                        :label="$t('indexDialog.down')"
                        icon="i-lucide-arrow-down"
                    />
                    <IconButton
                        @click="reset"
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
                        @dblclick="setChosen(chosen.filter(item => item !== field))"
                        :class="right.has(field) ? 'bg-primary/20 text-on-surface-strong' : 'hover:bg-on-surface/5'"
                        class="px-2.5 py-0.5 font-mono text-[12.5px] cursor-default"
                        data-testid="schema-column"
                    >
                        {{ field }}
                    </li>
                </ol>
            </div>
        </div>
        <p class="m-0 text-on-surface-variant">
            {{ t("export.schema.hint") }}
        </p>
    </div>
</template>
