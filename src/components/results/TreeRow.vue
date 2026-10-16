<script setup lang="ts">
import { ButtonRoot } from "@vuetify/v0";
import { computed, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { isLink, openLink } from "@/links";
import { isDoc, scalar, typeOf } from "@/shell/ejson";
import type { Json, ValueType } from "@/shell/ejson";
import { dateFormat, dateText, displayText, foldReaches, useResultContext } from "./result-context";
import ValueEditor from "./ValueEditor.vue";

/** A line of the result tree: a document, or a field with what lies below it. */
const props = withDefaults(defineProps<{
    /** Field name; absent for the line of the document itself. */
    name?: string;
    value: Json;
    /** Index of the document on the page, and its number in the whole result. */
    index: number;
    number: number;
    /** Dotted path of the field in its document. */
    path?: string;
    depth?: number;
    /** Starts unfolded. */
    expanded?: boolean;
}>(), {
    name: undefined,
    path: "",
    depth: 0
});

/** Children shown at first; documents and arrays can be far larger. */
const CHUNK = 200;

const COLORS: Partial<Record<ValueType, string>> = {
    string: "text-code-string",
    int: "text-code-number",
    long: "text-code-number",
    double: "text-code-number",
    decimal: "text-code-number",
    bool: "text-code-keyword",
    null: "text-code-comment",
    undefined: "text-code-comment",
    objectId: "text-code-type",
    date: "text-code-call",
    uuid: "text-code-type",
    binary: "text-code-type",
    regex: "text-code-type",
    timestamp: "text-code-call"
};

const { t, te, locale } = useI18n();
const context = useResultContext();
// A line that appears while "Expand node recursively" unfolds the node above it unfolds as well.
const deep = context.fold.value.path !== undefined && foldReaches(context.fold.value, props.index, props.path);
const open = shallowRef(deep ? context.fold.value.open : props.expanded);
const shown = shallowRef(CHUNK);
const root = computed(() => props.name === undefined);
const leaf = computed(() => scalar(props.value));
const type = computed(() => typeOf(props.value));
/** The path of a line below this one. */
function childPath(key: string): string {
    return props.path ? `${props.path}.${key}` : key;
}

/** Fields and elements; pinned fields come first, in the order they were pinned. */
const children = computed<[string, Json][]>(() => {
    if (leaf.value) return [];
    if (Array.isArray(props.value)) return props.value.map((item, index) => [String(index), item]);
    const entries = Object.entries(props.value as Record<string, Json>);
    const pinned = context.pinned.value;
    const first = pinned.flatMap(path => entries.filter(([key]) => childPath(key) === path));
    return first.length === 0 ? entries : [...first, ...entries.filter(entry => !first.includes(entry))];
});
const isPinned = computed(() => !root.value && context.pinned.value.includes(props.path));
const count = computed(() => {
    const size = children.value.length;
    return Array.isArray(props.value) ? `[${t("result.count.elements", { count: size }, size)}]` : `{${t("result.count.elements", { count: size }, size)}}`;
});
const typeName = computed(() => (te(`result.type.${type.value}`) ? t(`result.type.${type.value}`) : ""));
/** The document's line shows its id in place of a field name. */
const title = computed(() => {
    if (!root.value) return props.name ?? "";
    return isDoc(props.value) && "_id" in props.value ? displayText(props.value._id!) : "";
});
const target = computed(() => ({ index: props.index, path: props.path, value: props.value }));
const selected = computed(() => context.selected.value === props.index);

watch(context.fold, (fold) => {
    if (foldReaches(fold, props.index, props.path)) open.value = fold.open;
});

const dates = computed(() => dateFormat(locale.value));
/** Dates as the table shows them; everything else as `displayText`. */
const text = computed(() => (type.value === "date" ? dateText(props.value, dates.value) : undefined) ?? displayText(props.value));

// Editing in place: fields of documents that can be written back, also arrays and documents.
const editing = shallowRef(false);
const canEdit = computed(() => context.editable.value && props.path !== "" && props.path !== "_id");

function startEdit() {
    if (!canEdit.value) {
        if (root.value) context.open(props.index);
        return;
    }
    editing.value = true;
}
</script>

<template>
    <div role="treeitem">
        <div
            @click="context.choose(index, $event, path)"
            @contextmenu="context.menu($event, target)"
            @dblclick="startEdit"
            :class="root && selected ? 'outline outline-1 -outline-offset-1 outline-primary/70 bg-on-surface/4' : root && context.marked.value.has(index) && context.marked.value.size > 1 ? 'bg-primary/15' : 'hover:bg-on-surface/4'"
            :data-root="root || undefined"
            class="flex items-center h-[19px] pr-3 whitespace-nowrap"
            data-testid="tree-row"
        >
            <span
                :class="root ? 'text-on-surface-strong' : 'text-on-surface-variant/45'"
                class="w-9 shrink-0 pr-3 text-right tabular-nums select-none"
            >{{ number }}</span>
            <span
                :style="{ width: `${depth * 15}px` }"
                class="shrink-0"
            />
            <ButtonRoot
                @click.stop="open = !open"
                :ariaLabel="title"
                :class="leaf ? 'invisible' : ''"
                class="size-4 shrink-0 inline-flex items-center justify-center text-on-surface-variant hover:text-on-surface-strong"
                tabindex="-1"
            >
                <span
                    :class="open ? 'rotate-90' : ''"
                    class="i-lucide-chevron-right size-3.5 block"
                />
            </ButtonRoot>
            <span class="ml-1 font-semibold text-on-surface-strong">{{ title }}</span>
            <span
                v-if="isPinned"
                :title="$t('result.pinned')"
                class="i-lucide-pin size-3 ml-1 shrink-0 text-on-surface-variant"
                data-testid="tree-pin"
            />
            <span
                v-if="!root"
                class="mx-1.5 text-on-surface-variant"
            >:</span>
            <ValueEditor
                v-if="editing"
                @close="editing = false"
                @commit="text => context.commit(target, text)"
                :label="title"
                :suggest="context.suggest?.(path)"
                :value
                class="grow min-w-40 h-[19px] outline outline-1 -outline-offset-1 outline-primary"
                testid="tree-edit"
            />
            <template v-else>
                <!-- A web address: Ctrl+click opens it; a plain click still selects the row. -->
                <span
                    v-if="leaf && isLink(value)"
                    @click.ctrl.exact.stop="openLink(value)"
                    :class="COLORS[type]"
                    :title="$t('result.link')"
                    class="truncate underline decoration-dotted underline-offset-2 hover:decoration-solid cursor-pointer"
                    data-testid="tree-link"
                >{{ text }}</span>
                <span
                    v-else-if="leaf"
                    :class="COLORS[type]"
                    class="truncate"
                    data-testid="tree-value"
                >{{ text }}</span>
                <span
                    v-else
                    :class="root ? 'ml-1.5' : ''"
                    class="text-on-surface"
                >{{ count }}</span>
                <span class="ml-1.5 shrink-0 text-[11px] text-on-surface-variant/70 font-sans">{{ typeName }}</span>
            </template>
        </div>
        <div
            v-if="open && !leaf"
            role="group"
        >
            <TreeRow
                v-for="[key, item] in children.slice(0, shown)"
                :key="key"
                :depth="depth + 1"
                :index
                :name="key"
                :number
                :path="childPath(key)"
                :value="item"
            />
            <ButtonRoot
                v-if="children.length > shown"
                @click="shown += CHUNK"
                :style="{ marginLeft: `${36 + (depth + 1) * 15 + 20}px` }"
                class="h-[19px] text-primary hover:underline"
            >
                {{ $t("result.more", { count: children.length - shown }) }}
            </ButtonRoot>
        </div>
    </div>
</template>
