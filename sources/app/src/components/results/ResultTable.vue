<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { preferences } from "@/composables/appearance";
import { useKeymap } from "@/keys/keymap";
import type { MenuEntry } from "@/menu";
import { isDoc, preview, scalar, typeOf } from "@/shell/ejson";
import type { Json } from "@/shell/ejson";
import { isLink, openLink } from "@/links";
import { displayText, settingText, useResultContext } from "./result-context";
import ValueEditor from "./ValueEditor.vue";

/**
 * Documents as rows, their fields as columns: the type under each column name,
 * embedded fields shown as columns of their own on request, and "step into" an array or a sub
 * document, whose elements then become the columns.
 */
const props = defineProps<{
    /** The documents shown, each with its index on the page. */
    rows: { item: Json; index: number }[];
    /** Index of the first item in the whole result. */
    offset: number;
}>();

/** More columns than this are of no use side by side. */
const MAX_COLUMNS = 120;

const { t, locale } = useI18n();
const context = useResultContext();
const keymap = useKeymap();

/** The path stepped into, segment by segment; empty at the top of the documents. */
/** The path the table stepped into; the toolbar of the results shows the way back. */
const stack = context.tableStack;
/** Columns (relative to `stack`) whose embedded fields are shown as columns. */
const embedded = ref(new Set<string>());
const pinned = ref<string[]>([]);
const hidden = ref(new Set<string>());
const current = shallowRef<{ index: number; column: string }>();

/** The children of a value: elements of an array, fields of a document, none for a scalar. */
function children(value: Json | undefined): [string, Json][] {
    if (Array.isArray(value)) return value.map((item, index) => [String(index), item]);
    if (isDoc(value) && !scalar(value)) return Object.entries(value);
    return [];
}

function at(value: Json | undefined, segments: string[]): Json | undefined {
    let reached = value;
    for (const segment of segments) reached = children(reached).find(([key]) => key === segment)?.[1];
    return reached;
}

const levels = computed(() => props.rows.map(row => ({ index: row.index, value: at(row.item, stack.value) })));

/** Sorting by a column (*Sort asc/desc*): the documents of the page, not the query. */
const sortBy = shallowRef<{ column: string; descending: boolean }>();
/** Order of values of different types: missing last, then numbers, text, dates, the rest as text. */
function sortKey(value: Json | undefined): [number, number | string] {
    if (value === undefined) return [9, ""];
    const type = typeOf(value);
    if (type === "int" || type === "long" || type === "double" || type === "decimal") return [1, Number(isDoc(value) ? value.$numberInt ?? value.$numberLong ?? value.$numberDouble ?? value.$numberDecimal : value)];
    if (type === "date" && isDoc(value)) return [3, Number((value.$date as { $numberLong?: string } | undefined)?.$numberLong ?? Date.parse(String(value.$date)))];
    if (type === "null") return [0, ""];
    return [2, displayText(value)];
}
/** The rows in the order shown: sorted when asked, else as the server gave them. */
const shown = computed(() => {
    const by = sortBy.value;
    if (!by) return levels.value;
    return [...levels.value].sort((a, b) => {
        const [rankA, keyA] = sortKey(cell(a.value, by.column));
        const [rankB, keyB] = sortKey(cell(b.value, by.column));
        // Missing values stay last either way.
        if (rankA !== rankB) return rankA === 9 ? 1 : rankB === 9 ? -1 : (rankA - rankB) * (by.descending ? -1 : 1);
        const order = typeof keyA === "number" && typeof keyB === "number" ? keyA - keyB : String(keyA).localeCompare(String(keyB), undefined, { numeric: true });
        return by.descending ? -order : order;
    });
});
/** Columns moved left or right by hand, in their order; the others follow as they come. */
const order = ref<string[]>([]);

const columns = computed(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    const add = (prefix: string, value: Json | undefined) => {
        for (const [key, item] of children(value)) {
            const column = prefix ? `${prefix}.${key}` : key;
            if (embedded.value.has(column) && children(item).length > 0) add(column, item);
            else if (!seen.has(column) && !embedded.value.has(column)) {
                seen.add(column);
                names.push(column);
            }
        }
    };
    for (const level of levels.value) add("", level.value);
    // Unfolded columns without anything to unfold in some row still show as themselves.
    for (const column of embedded.value) {
        if (!names.some(name => name.startsWith(`${column}.`)) && !seen.has(column)) names.push(column);
    }
    const placed = order.value.length === 0 ? names : [...order.value.filter(name => names.includes(name)), ...names.filter(name => !order.value.includes(name))];
    const arranged = [...pinned.value.filter(name => placed.includes(name)), ...placed.filter(name => !pinned.value.includes(name))];
    return arranged.filter(name => !hidden.value.has(name)).slice(0, MAX_COLUMNS);
});

function cell(value: Json | undefined, column: string): Json | undefined {
    return at(value, column.split("."));
}

function cellAt(index: number, column: string): Json | undefined {
    return cell(levels.value.find(level => level.index === index)?.value, column);
}

/** The dotted path of a cell from the root of its document. */
function fullPath(column: string): string {
    return [...stack.value, column].join(".");
}

/** Inside a stepped-into value the column says where it comes from: `0 - Sources.0`. */
function label(column: string): string {
    return stack.value.length === 0 ? column : `${column} - ${fullPath(column)}`;
}

function typeLabel(column: string): string {
    const values = levels.value.map(level => cell(level.value, column)).filter((item): item is Json => item !== undefined);
    const value = values[0];
    if (value === undefined) return "";
    const type = typeOf(value);
    // Values of different types make the column `mixed` (null aside).
    if (values.some(item => typeOf(item) !== type && typeOf(item) !== "null")) return t("result.type.mixed");
    return type === "date" ? t("result.type.datetime") : t(`result.type.${type}`);
}

function cellText(value: Json | undefined): string {
    if (value === undefined) return t("result.notSet");
    const type = typeOf(value);
    const shown = settingText(value, locale.value);
    if (shown !== undefined) return shown;
    if (type === "date") return displayText(value);
    // Numbers as digits; the type stands in the column head.
    if ((type === "long" || type === "decimal") && isDoc(value)) return String(value.$numberLong ?? value.$numberDecimal);
    if (type === "array" || type === "object") {
        const count = children(value).length;
        const text = t("result.count.elements", { count }, count);
        return type === "array" ? `[${text}]` : `{${text}}`;
    }
    return scalar(value) ? displayText(value) : preview(value, 60);
}

function cellClass(value: Json | undefined): string {
    if (value === undefined) return "italic text-on-surface-variant/60";
    // Colours by type can be switched off in the settings.
    if (!preferences.typeColors) return "";
    switch (typeOf(value)) {
        case "int":
        case "long":
        case "double":
        case "decimal": return "text-code-number";
        case "string": return "text-code-string";
        case "objectId": return "text-code-type";
        case "bool": return "text-code-keyword";
        case "null": return "text-code-type";
        case "date": return "text-code-type";
        default: return "text-on-surface";
    }
}

function stepInto(column: string): void {
    stack.value = [...stack.value, ...column.split(".")];
    embedded.value = new Set();
    pinned.value = [];
    hidden.value = new Set();
    current.value = undefined;
}

function stepBack(): void {
    stack.value = stack.value.slice(0, -1);
}

// A level up, from the keys here or the button of the toolbar: what was set for the level below goes.
watch(() => stack.value.length, (length, before) => {
    if (length >= before) return;
    embedded.value = new Set();
    current.value = undefined;
});

function restore(): void {
    stack.value = [];
    sortBy.value = undefined;
    order.value = [];
    embedded.value = new Set();
    pinned.value = [];
    hidden.value = new Set();
    widths.value = {};
}

/** Widths dragged at the right edge of a column head, in pixels; others take what they need. */
const widths = ref<Record<string, number>>({});
const MIN_WIDTH = 40;

function widthStyle(column: string): Record<string, string> | undefined {
    const width = widths.value[column];
    return width === undefined ? undefined : { width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` };
}

/** Dragging the edge of a head sets the width of its column; a double click gives it back. */
function startResize(event: PointerEvent, column: string): void {
    const handle = event.currentTarget as HTMLElement;
    const head = handle.parentElement!;
    const start = event.clientX;
    const width = head.getBoundingClientRect().width;
    handle.setPointerCapture(event.pointerId);
    const move = (moved: PointerEvent) => {
        widths.value = { ...widths.value, [column]: Math.max(MIN_WIDTH, Math.round(width + moved.clientX - start)) };
    };
    const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
}

function resetWidth(column: string): void {
    const rest = { ...widths.value };
    delete rest[column];
    widths.value = rest;
}

function toggle<T>(set: Set<T>, value: T, on: boolean): Set<T> {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
}

// Editing in place: one cell at a time.
const editing = shallowRef<{ index: number; column: string }>();
const tableKeys = useTemplateRef<HTMLDivElement>("tableKeys");

function activate(index: number, column: string) {
    const value = cellAt(index, column);
    if (children(value).length > 0) {
        stepInto(column);
        return;
    }
    if (!context.editable.value || fullPath(column) === "_id") {
        context.open(index);
        return;
    }
    editing.value = { index, column };
}

function isEditing(index: number, column: string): boolean {
    return editing.value?.index === index && editing.value.column === column;
}

function commit(index: number, column: string, text: string) {
    context.commit({ index, path: fullPath(column), value: cellAt(index, column) ?? null }, text);
}

/** Back to the table after editing, so that its keys work again. */
function stopEditing(back: boolean) {
    editing.value = undefined;
    if (back) tableKeys.value?.focus();
}

function select(index: number, column: string, event?: MouseEvent) {
    current.value = { index, column };
    context.choose(index, event, fullPath(column));
}

const unfoldable = computed(() => columns.value.filter(name => levels.value.some(level => children(cell(level.value, name)).length > 0)));

/** What the menu of a cell and the keys do, column by column. */
const commands = {
    showEmbedded: (column: string) => (embedded.value = toggle(embedded.value, column, true)),
    showAllEmbedded: () => (embedded.value = new Set([...embedded.value, ...unfoldable.value])),
    hideAllEmbedded: () => (embedded.value = new Set()),
    togglePin: (column: string) => (pinned.value = pinned.value.includes(column) ? pinned.value.filter(name => name !== column) : [...pinned.value, column]),
    hide: (column: string) => (hidden.value = toggle(hidden.value, column, true)),
    hideOthers: (column: string) => (hidden.value = new Set(columns.value.filter(name => name !== column))),
    showAll: () => (hidden.value = new Set()),
    sort: (column: string, descending: boolean) => (sortBy.value = { column, descending }),
    unsort: () => (sortBy.value = undefined),
    move: (column: string, by: -1 | 1) => {
        const list = [...columns.value];
        const from = list.indexOf(column);
        const to = from + by;
        if (from === -1 || to < 0 || to >= list.length) return;
        [list[from], list[to]] = [list[to]!, list[from]!];
        order.value = list;
    },
    autosize: (column: string) => (widths.value = { ...widths.value, [column]: fitWidth(column) }),
    autosizeAll: () => (widths.value = Object.fromEntries(columns.value.map(column => [column, fitWidth(column)])))
};

/** A width that fits the head and every cell of the column on the page, as *Auto-size column*. */
function fitWidth(column: string): number {
    const longest = Math.max(label(column).length, typeLabel(column).length, ...levels.value.map(level => cellText(cell(level.value, column)).length));
    return Math.min(640, Math.max(MIN_WIDTH, Math.round(longest * 7 + 20)));
}

function openMenu(event: MouseEvent, index: number, column: string) {
    select(index, column);
    const value = cellAt(index, column);
    const nested = children(value).length > 0;
    const extra: MenuEntry[] = [
        { label: t("table.embedded.show"), command: "table.embedded.show", disabled: !nested, action: () => commands.showEmbedded(column) },
        { label: t("table.embedded.showAll"), command: "table.embedded.showAll", disabled: unfoldable.value.length === 0, action: commands.showAllEmbedded },
        { label: t("table.embedded.hideAll"), command: "table.embedded.hideAll", disabled: embedded.value.size === 0, action: commands.hideAllEmbedded },
        "separator",
        { label: t("table.stepInto"), icon: "i-lucide-corner-down-right", command: "table.stepInto", disabled: !nested, action: () => stepInto(column) },
        ...(stack.value.length > 0 ? [{ label: t("table.stepBack"), icon: "i-lucide-arrow-left", command: "table.stepBack", action: stepBack } satisfies MenuEntry] : []),
        pinned.value.includes(column)
            ? { label: t("table.unpin"), icon: "i-lucide-pin-off", command: "table.pin", action: () => commands.togglePin(column) }
            : { label: t("table.pin"), icon: "i-lucide-pin", command: "table.pin", action: () => commands.togglePin(column) },
        "separator",
        { label: t("table.hide"), command: "table.hide", action: () => commands.hide(column) },
        { label: t("table.hideOthers"), command: "table.hideOthers", action: () => commands.hideOthers(column) },
        { label: t("table.showAll"), icon: "i-lucide-eye", command: "table.showAll", disabled: hidden.value.size === 0, action: commands.showAll },
        "separator",
        { label: t("table.sortAsc"), icon: "i-lucide-arrow-down-a-z", command: "table.sortAsc", action: () => commands.sort(column, false) },
        { label: t("table.sortDesc"), icon: "i-lucide-arrow-down-z-a", command: "table.sortDesc", action: () => commands.sort(column, true) },
        { label: t("table.sortReset"), disabled: !sortBy.value, action: commands.unsort },
        "separator",
        { label: t("table.moveLeft"), icon: "i-lucide-arrow-left-to-line", command: "table.moveLeft", disabled: columns.value.indexOf(column) <= 0, action: () => commands.move(column, -1) },
        { label: t("table.moveRight"), icon: "i-lucide-arrow-right-to-line", command: "table.moveRight", disabled: columns.value.indexOf(column) >= columns.value.length - 1, action: () => commands.move(column, 1) },
        { label: t("table.autosize"), command: "table.autosize", action: () => commands.autosize(column) },
        { label: t("table.autosizeAll"), command: "table.autosizeAll", action: commands.autosizeAll },
        "separator",
        { label: t("table.restore"), action: restore }
    ];
    context.menu(event, { index, path: fullPath(column), value: value ?? null }, extra);
}

/**
 * Keys on the table: arrows move the chosen cell, Enter opens it (edit, step into), Backspace
 * steps back, and the shortcuts of the cell menu act on the chosen cell's column.
 */
function onKey(event: KeyboardEvent) {
    if (editing.value) return;
    const at = current.value;
    const key = event.key.toLowerCase();
    const control = event.ctrlKey || event.metaKey;
    if (keymap.matches(event, "table.stepBack") && stack.value.length > 0) {
        stepBack();
    } else if (!control && at && ["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        const rows = shown.value.map(level => level.index);
        const row = rows.indexOf(at.index) + (key === "arrowdown" ? 1 : key === "arrowup" ? -1 : 0);
        const column = columns.value.indexOf(at.column) + (key === "arrowright" ? 1 : key === "arrowleft" ? -1 : 0);
        const index = rows[Math.min(Math.max(row, 0), rows.length - 1)];
        const name = columns.value[Math.min(Math.max(column, 0), columns.value.length - 1)];
        if (index !== undefined && name !== undefined) select(index, name);
    } else if (at && keymap.matches(event, "table.stepInto")) {
        if (children(cellAt(at.index, at.column)).length > 0) stepInto(at.column);
    } else if (at && !control && key === "enter") {
        void activate(at.index, at.column);
    } else if (keymap.matches(event, "table.embedded.hideAll")) {
        commands.hideAllEmbedded();
    } else if (keymap.matches(event, "table.embedded.showAll")) {
        commands.showAllEmbedded();
    } else if (at && keymap.matches(event, "table.embedded.show")) {
        commands.showEmbedded(at.column);
    } else if (keymap.matches(event, "table.showAll")) {
        commands.showAll();
    } else if (at && keymap.matches(event, "table.hideOthers")) {
        commands.hideOthers(at.column);
    } else if (at && keymap.matches(event, "table.hide")) {
        commands.hide(at.column);
    } else if (at && keymap.matches(event, "table.pin")) {
        commands.togglePin(at.column);
    } else if (at && keymap.matches(event, "table.sortAsc")) {
        commands.sort(at.column, false);
    } else if (at && keymap.matches(event, "table.sortDesc")) {
        commands.sort(at.column, true);
    } else if (at && keymap.matches(event, "table.moveLeft")) {
        commands.move(at.column, -1);
    } else if (at && keymap.matches(event, "table.moveRight")) {
        commands.move(at.column, 1);
    } else if (at && keymap.matches(event, "table.autosize")) {
        commands.autosize(at.column);
    } else if (keymap.matches(event, "table.autosizeAll")) {
        commands.autosizeAll();
    } else {
        return;
    }
    // Ctrl+P would print, Ctrl+J open the downloads of the web view.
    event.preventDefault();
    event.stopPropagation();
}
</script>

<template>
    <div
        ref="tableKeys"
        @keydown="onKey"
        class="outline-none"
        data-testid="result-table-keys"
        tabindex="0"
    >
        <table
            class="border-separate border-spacing-0 font-sans text-[12.5px]"
            data-testid="result-table"
        >
            <thead>
                <tr>
                    <th class="sticky top-0 left-0 z-3 w-9 bg-background" />
                    <th
                        v-for="column in columns"
                        :key="column"
                        :class="pinned.includes(column) ? 'bg-dock' : 'bg-background'"
                        :style="widthStyle(column)"
                        class="sticky top-0 z-1 px-2 pt-1 pb-0.5 text-left font-normal whitespace-nowrap align-bottom overflow-hidden"
                        data-testid="table-column"
                    >
                        <span
                            @dblclick.stop="resetWidth(column)"
                            @pointerdown.prevent="startResize($event, column)"
                            :title="$t('table.resize')"
                            class="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                            data-testid="column-resize"
                        />
                        <span class="flex items-center gap-1 font-semibold text-on-surface-strong">
                            <span
                                v-if="pinned.includes(column)"
                                class="i-lucide-pin size-3 text-on-surface-variant"
                            />
                            {{ label(column) }}
                        </span>
                        <span class="block text-[10.5px] leading-3 text-on-surface-variant/60">{{ typeLabel(column) }}</span>
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="{ value, index } in shown"
                    :key="index"
                    :class="context.marked.value.has(index) && context.marked.value.size > 1 ? 'bg-primary/15' : context.selected.value === index ? 'bg-on-surface/5' : 'hover:bg-on-surface/4'"
                    data-testid="table-row"
                >
                    <td class="sticky left-0 z-2 w-9 pr-2 h-[19px] bg-background text-right text-[11px] text-on-surface-variant/70 tabular-nums select-none">
                        {{ offset + index + 1 }}
                    </td>
                    <td
                        v-for="column in columns"
                        :key="column"
                        @click="select(index, column, $event)"
                        @contextmenu="openMenu($event, index, column)"
                        @dblclick="activate(index, column)"
                        :class="[
                            cellClass(cell(value, column)),
                            // While editing the editor draws the one frame, over the cell.
                            current?.index === index && current.column === column && !isEditing(index, column) ? 'outline outline-1 -outline-offset-1 outline-primary' : '',
                            // The editor may reach past a narrow cell; the text below it keeps the width.
                            isEditing(index, column) ? 'overflow-visible' : 'truncate'
                        ]"
                        :style="widthStyle(column)"
                        :title="cell(value, column) === undefined ? undefined : preview(cell(value, column)!, 1000)"
                        class="relative max-w-64 px-2 h-[19px] whitespace-nowrap"
                        data-testid="table-cell"
                    >
                        <ValueEditor
                            v-if="isEditing(index, column)"
                            @close="stopEditing"
                            @commit="text => commit(index, column, text)"
                            :label="column"
                            :suggest="context.suggest?.(fullPath(column))"
                            :value="cell(value, column)"
                            class="absolute! left-0 top-0 z-1 min-h-full w-max items-start! pl-2 bg-background! outline outline-1 -outline-offset-1 outline-primary"
                            testid="table-edit"
                            grow
                            inheritFont
                        />
                        <span
                            v-if="isLink(cell(value, column))"
                            @click.ctrl.exact.stop="openLink(cell(value, column) as string)"
                            :class="isEditing(index, column) ? 'invisible' : ''"
                            class="underline decoration-dotted underline-offset-2 hover:decoration-solid cursor-pointer"
                            data-testid="table-link"
                        >{{ cellText(cell(value, column)) }}</span>
                        <span
                            v-else
                            :class="isEditing(index, column) ? 'invisible' : ''"
                        >{{ cellText(cell(value, column)) }}</span>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
