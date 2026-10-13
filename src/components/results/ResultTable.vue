<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef } from "vue";
import { isDoc, preview, scalar, typeOf } from "@/shell/ejson";
import type { Json } from "@/shell/ejson";
import { displayText, useResultContext } from "./result-context";

/** Documents as rows, their top-level fields as columns. */
const props = defineProps<{
    /** The documents shown, each with its index on the page. */
    rows: { item: Json; index: number }[];
    /** Index of the first item in the whole result. */
    offset: number;
}>();

/** More columns than this are of no use side by side. */
const MAX_COLUMNS = 80;

const context = useResultContext();

/** A wrapped scalar (`{ $oid: … }`) is a value, not a row with fields. */
function fieldsOf(item: Json): Record<string, Json> | undefined {
    return isDoc(item) && !scalar(item) ? item : undefined;
}

const columns = computed(() => {
    const names = new Set<string>();
    for (const row of props.rows) {
        for (const key of Object.keys(fieldsOf(row.item) ?? {})) names.add(key);
    }
    return [...names].slice(0, MAX_COLUMNS);
});

function cell(item: Json, column: string): Json | undefined {
    return fieldsOf(item)?.[column];
}

function cellAt(index: number, column: string): Json | undefined {
    const row = props.rows.find(item => item.index === index);
    return row ? cell(row.item, column) : undefined;
}

function cellText(value: Json | undefined): string {
    if (value === undefined) return "";
    return scalar(value) ? displayText(value) : preview(value, 60);
}

function cellClass(value: Json | undefined): string {
    if (value === undefined) return "";
    switch (typeOf(value)) {
        case "int":
        case "long":
        case "double":
        case "decimal": return "text-right text-code-number";
        case "string": return "text-code-string";
        case "objectId": return "text-code-type";
        case "bool": return "text-code-keyword";
        case "null": return "text-code-comment";
        case "date": return "text-code-call";
        default: return "text-on-surface";
    }
}

// Editing in place: one cell at a time.
const editing = shallowRef<{ index: number; column: string }>();
const draft = shallowRef("");
const input = useTemplateRef<HTMLInputElement[]>("input");

async function startEdit(index: number, column: string) {
    const value = cellAt(index, column);
    const leaf = value === undefined ? undefined : scalar(value);
    if (!context.editable.value || column === "_id" || (value !== undefined && !leaf)) {
        context.open(index);
        return;
    }
    draft.value = leaf?.text ?? "";
    editing.value = { index, column };
    await nextTick();
    input.value?.[0]?.select();
}

function commit() {
    const at = editing.value;
    if (!at) return;
    editing.value = undefined;
    const value = cellAt(at.index, at.column);
    if (draft.value.trim() !== "" && draft.value !== (value === undefined ? "" : scalar(value)?.text)) {
        context.commit({ index: at.index, path: at.column, value: value ?? null }, draft.value);
    }
}
</script>

<template>
    <table
        class="border-separate border-spacing-0 font-mono text-[13px]"
        data-testid="result-table"
    >
        <thead>
            <tr>
                <th class="sticky top-0 left-0 z-2 w-11 px-2 h-6.5 bg-dock border-b border-r border-divider text-right font-normal text-on-surface-variant">
                    #
                </th>
                <th
                    v-for="column in columns"
                    :key="column"
                    class="sticky top-0 z-1 px-2.5 h-6.5 bg-dock border-b border-r border-divider text-left font-semibold text-on-surface-strong whitespace-nowrap"
                >
                    {{ column }}
                </th>
                <th
                    v-if="columns.length === 0"
                    class="sticky top-0 z-1 px-2.5 h-6.5 bg-dock border-b border-divider"
                />
            </tr>
        </thead>
        <tbody>
            <tr
                v-for="{ item, index } in rows"
                :key="index"
                @click="context.selected.value = index"
                :class="context.selected.value === index ? 'bg-primary/14' : 'hover:bg-on-surface/4'"
                data-testid="table-row"
            >
                <td class="sticky left-0 px-2 h-6 bg-background border-b border-r border-divider text-right text-on-surface-variant tabular-nums select-none">
                    {{ offset + index + 1 }}
                </td>
                <template v-if="columns.length > 0">
                    <td
                        v-for="column in columns"
                        :key="column"
                        @contextmenu="context.menu($event, { index, path: column, value: cell(item, column) ?? null })"
                        @dblclick="startEdit(index, column)"
                        :class="cellClass(cell(item, column))"
                        :title="cell(item, column) === undefined ? undefined : preview(cell(item, column)!, 1000)"
                        class="max-w-80 px-2.5 h-6 border-b border-r border-divider truncate whitespace-nowrap"
                        data-testid="table-cell"
                    >
                        <input
                            v-if="editing?.index === index && editing.column === column"
                            ref="input"
                            v-model="draft"
                            @blur="editing = undefined"
                            @keydown.enter.prevent="commit"
                            @keydown.esc.stop="editing = undefined"
                            :aria-label="column"
                            class="w-full min-w-32 h-5 px-1 bg-surface-variant border border-primary outline-none text-on-surface-strong"
                            data-testid="table-edit"
                            spellcheck="false"
                        />
                        <template v-else>
                            {{ cellText(cell(item, column)) }}
                        </template>
                    </td>
                </template>
                <td
                    v-else
                    class="px-2.5 h-6 border-b border-divider whitespace-nowrap"
                >
                    {{ preview(item, 200) }}
                </td>
            </tr>
        </tbody>
    </table>
</template>
