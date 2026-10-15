<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { computed, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import ChoiceField from "@/components/ChoiceField.vue";
import IconButton from "@/components/IconButton.vue";
import { useDialogs } from "@/composables/dialogs";
import { preview, toShell } from "@/shell/ejson";
import type { Json, ValueType } from "@/shell/ejson";
import { BINS, filterOf, gaps, mainType, mixedTypes, SAMPLE_SIZES, typeFilter, unique, validatorOf } from "@/shell/schema";
import type { Bin, ChartPick, FieldStats } from "@/shell/schema";
import { useConnectionsStore } from "@/stores/connections";
import { useTabsStore } from "@/stores/tabs";

/**
 * The schema of a collection (stage 23): figures on top, below a card per field with the share of
 * its types and a chart that fits them. A click on a bar sets the filter, Shift adds to it.
 * Types are named as text; warnings only as an icon and a short line, never as a colored area.
 */
const props = defineProps<{
    tabId: string;
}>();

/** Values shown as bars per field; the rest are counted. */
const SHOWN_VALUES = 6;
/** The last class of a histogram includes its upper bound. */
const BINS_LAST = BINS - 1;

const { t, te, locale } = useI18n();
const dialogs = useDialogs();
const tabs = useTabsStore();
const connections = useConnectionsStore();

const tab = computed(() => tabs.tabs.find(item => item.id === props.tabId)!);
const profile = computed(() => connections.profiles.find(item => item.id === tab.value.connectionId));
const schema = computed(() => tab.value.schema);
const picks = computed(() => tab.value.picks ?? []);
/** Objects whose fields are unfolded as cards of their own. */
const unfolded = shallowRef(new Set<string>());

const format = (n: number) => n.toLocaleString(locale.value);
const percent = (part: number, whole: number) => `${Math.round((part / Math.max(1, whole)) * 100)} %`;

const sizeOptions = computed(() => SAMPLE_SIZES.map(size => ({ value: size, label: size === 0 ? t("schema.sample.all") : format(size) })));
const size = computed({
    get: () => schema.value?.size ?? 1000,
    set: (value: number) => void tabs.analyzeSchema(tab.value, value)
});

/** Top-level fields, and the fields of unfolded objects right after them. */
const cards = computed<FieldStats[]>(() => {
    const fields = schema.value?.result.fields ?? [];
    const result: FieldStats[] = [];
    const add = (parent: string | undefined) => {
        for (const field of fields) {
            const inside = parent === undefined ? field.depth === 0 : field.path.startsWith(`${parent}.`) && field.depth === parent.split(".").length;
            if (!inside) continue;
            result.push(field);
            if (unfolded.value.has(field.path)) add(field.path);
        }
    };
    add(undefined);
    return result;
});

const sampled = computed(() => schema.value?.result.sampled ?? 0);
const mixedCount = computed(() => schema.value?.result.fields.filter(mixedTypes).length ?? 0);
const gapCount = computed(() => schema.value?.result.fields.filter(field => gaps(field, field.depth === 0 ? sampled.value : field.present) > 0).length ?? 0);
const filterText = computed(() => (picks.value.length > 0 ? preview(filterOf(picks.value), Number.POSITIVE_INFINITY) : ""));

function toggleFold(path: string) {
    const next = new Set(unfolded.value);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    unfolded.value = next;
}

function samePick(a: ChartPick, b: ChartPick): boolean {
    return a.field === b.field && JSON.stringify("value" in a ? a.value : a.range) === JSON.stringify("value" in b ? b.value : b.range);
}

function picked(pick: ChartPick): boolean {
    return picks.value.some(item => samePick(item, pick));
}

/** A click sets the filter to this bar (again: takes it away); with Shift it is added to the others. */
function choose(pick: ChartPick, event: MouseEvent | KeyboardEvent) {
    const current = picks.value;
    if (event.shiftKey) tab.value.picks = picked(pick) ? current.filter(item => !samePick(item, pick)) : [...current, pick];
    else tab.value.picks = picked(pick) && current.length === 1 ? [] : [pick];
}

function openFiltered(filter = filterOf(picks.value)) {
    tabs.browseFiltered({ connectionId: tab.value.connectionId, database: tab.value.database, collection: tab.value.collection ?? "" }, filter);
}

function asValidator() {
    if (!schema.value) return;
    dialogs.editCollection({ mode: "validator", connectionId: tab.value.connectionId, database: tab.value.database, collection: tab.value.collection, validator: toShell(validatorOf(schema.value.result)) });
}

const typeName = (type: ValueType) => (te(`result.type.${type}`) ? t(`result.type.${type}`) : type);

/** The whole of a field: documents of the sample (top level) or of its parent. */
function wholeOf(field: FieldStats): number {
    if (field.depth === 0) return sampled.value;
    const parent = schema.value?.result.fields.find(item => item.path === field.path.slice(0, field.path.lastIndexOf(".")));
    return parent?.present ?? field.present;
}

/** The share of each type, and of documents without the field (hatched). */
function typeParts(field: FieldStats): { label: string; share: number; kind: "main" | "other" | "gap" }[] {
    const main = mainType(field);
    const whole = wholeOf(field);
    const parts = field.types.map(entry => ({
        label: typeName(entry.type),
        share: entry.count,
        kind: entry.type === "null" ? "gap" as const : entry.type === main ? "main" as const : "other" as const
    }));
    const missing = whole - field.present;
    if (missing > 0) parts.push({ label: t("schema.missing"), share: missing, kind: "gap" });
    return parts;
}

type Chart = "unique" | "values" | "numbers" | "dates" | "lengths" | "texts" | "none";

function chartOf(field: FieldStats): Chart {
    const main = mainType(field);
    if (main === "objectId" || unique(field)) return "unique";
    if (main === "date" && field.dates) return "dates";
    if (main === "array" && field.lengths) return "lengths";
    if ((main === "int" || main === "long" || main === "double" || main === "decimal") && field.numbers && field.distinct > SHOWN_VALUES) return "numbers";
    if (field.values) return "values";
    if (main === "string") return "texts";
    return "none";
}

function bars(field: FieldStats): { value: Json; count: number }[] {
    return (field.values ?? []).slice(0, SHOWN_VALUES);
}

function maxCount(items: { count: number }[]): number {
    return Math.max(1, ...items.map(item => item.count));
}

function binLabel(bin: Bin, date: boolean): string {
    if (date) return new Date(bin.from).toLocaleDateString(locale.value);
    return Number(bin.from.toPrecision(4)).toLocaleString(locale.value);
}

/** The type of the values that differ from the main type, for "Show these". */
function otherType(field: FieldStats): { type: ValueType; count: number } | undefined {
    const main = mainType(field);
    return field.types.find(entry => entry.type !== main && entry.type !== "null");
}
</script>

<template>
    <section
        class="h-full min-h-0 flex flex-col"
        data-testid="schema-panel"
    >
        <h1 class="m-0 shrink-0 h-13 flex items-end gap-2 px-5.5 pb-1.5 text-[21px] font-normal text-on-surface-strong whitespace-nowrap overflow-hidden">
            {{ tab.collection }}
            <span class="text-on-surface/80">{{ $t("schema.subtitle", { database: tab.database, name: profile?.name ?? "" }) }}</span>
        </h1>

        <div class="h-8 shrink-0 flex items-center gap-1 px-5 text-[13px]">
            <IconButton
                @click="tabs.analyzeSchema(tab)"
                :disabled="tab.running"
                :icon="tab.running ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-refresh-cw'"
                :label="$t('schema.analyze')"
                data-testid="schema-analyze"
            >
                {{ $t("schema.analyze") }}
            </IconButton>
            <span class="toolbar-rule" />
            <span class="ml-1 text-on-surface-variant">{{ $t("schema.sample") }}</span>
            <ChoiceField
                v-model="size"
                :label="$t('schema.sample')"
                :options="sizeOptions"
                class="w-28"
                data-testid="schema-sample"
                size="compact"
            />
            <span class="toolbar-rule" />
            <IconButton
                @click="asValidator"
                :disabled="!schema"
                :label="$t('schema.asValidator')"
                data-testid="schema-validator"
                icon="i-lucide-shield-check"
            >
                {{ $t("schema.asValidator") }}
            </IconButton>
            <span class="toolbar-rule" />
            <template v-if="picks.length > 0">
                <code
                    class="min-w-0 truncate px-2 py-0.5 rounded-sm bg-on-surface/6 font-mono text-[12px] text-on-surface-strong"
                    data-testid="schema-filter"
                >{{ filterText }}</code>
                <ButtonRoot
                    @click="openFiltered()"
                    class="btn-primary h-6.5! px-2.5! text-[12px]"
                    data-testid="schema-open"
                >
                    <ButtonContent>{{ $t("schema.openIn", { name: tab.collection }) }}</ButtonContent>
                </ButtonRoot>
                <IconButton
                    @click="tab.picks = []"
                    :label="$t('schema.clearFilter')"
                    icon="i-lucide-x"
                />
            </template>
            <span
                v-else
                class="ml-1 italic text-on-surface-variant truncate"
            >{{ $t("schema.clickHint") }}</span>
        </div>

        <p
            v-if="tab.error"
            class="m-0 shrink-0 mx-5 my-1 px-3 py-2 rounded-sm bg-error/12 text-error font-mono text-[13px]"
            role="alert"
        >
            {{ typeof tab.error === "string" ? tab.error : $t(tab.error.key, tab.error.params ?? {}) }}
        </p>

        <div class="grow min-h-0 overflow-auto px-5 pb-4">
            <p
                v-if="!schema"
                class="m-0 py-3 text-on-surface-variant"
            >
                {{ tab.running ? $t("schema.reading") : $t("schema.notYet") }}
            </p>
            <template v-else>
                <!-- The figures: sample, fields, mixed types, gaps, time. -->
                <div
                    class="flex flex-wrap gap-x-7 gap-y-1 py-3 text-[13px] text-on-surface-variant"
                    data-testid="schema-overview"
                >
                    <span>
                        <b class="mr-1.5 text-[17px] font-semibold text-on-surface-strong">{{ format(sampled) }}</b>
                        {{ schema.total === undefined ? $t("schema.documents") : $t("schema.ofTotal", { total: format(schema.total) }) }}
                    </span>
                    <span><b class="mr-1.5 text-[17px] font-semibold text-on-surface-strong">{{ format(schema.result.fields.length) }}</b>{{ $t("schema.fields") }}</span>
                    <span><b class="mr-1.5 text-[17px] font-semibold text-on-surface-strong">{{ format(mixedCount) }}</b>{{ $t("schema.mixed") }}</span>
                    <span><b class="mr-1.5 text-[17px] font-semibold text-on-surface-strong">{{ format(gapCount) }}</b>{{ $t("schema.withGaps") }}</span>
                    <span><b class="mr-1.5 text-[17px] font-semibold text-on-surface-strong">{{ (schema.milliseconds / 1000).toLocaleString(locale, { maximumFractionDigits: 1 }) }} s</b>{{ $t("schema.duration") }}</span>
                    <span
                        v-if="schema.sampledInstead"
                        class="flex items-center gap-1 text-warning"
                    ><span class="i-lucide-triangle-alert size-3.5" />{{ $t("schema.timeLimit") }}</span>
                </div>

                <div class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                    <article
                        v-for="field in cards"
                        :key="field.path"
                        class="min-w-0 p-3 rounded-sm border border-divider bg-dock flex flex-col gap-2"
                        data-testid="schema-card"
                    >
                        <header class="flex items-baseline gap-2 min-w-0">
                            <span
                                :title="field.path"
                                class="truncate font-mono font-semibold text-on-surface-strong"
                                data-testid="schema-field"
                            >{{ field.path }}</span>
                            <span class="truncate text-[12px] text-on-surface-variant">{{ field.types.map(entry => typeName(entry.type)).join(" · ") }}</span>
                            <span
                                v-if="mixedTypes(field)"
                                :title="$t('schema.mixedTypes')"
                                class="i-lucide-triangle-alert size-3.5 shrink-0 text-warning"
                            />
                            <span class="grow" />
                            <span class="shrink-0 text-[12px] text-on-surface-variant tabular-nums">{{ percent(field.present, wholeOf(field)) }}</span>
                        </header>

                        <!-- Share of the types: the main one in the accent color, others grey, missing hatched. -->
                        <div
                            class="h-1.5 flex gap-0.5"
                            data-testid="schema-types"
                        >
                            <span
                                v-for="part in typeParts(field)"
                                :key="part.label"
                                :class="part.kind === 'main' ? 'bg-primary' : part.kind === 'other' ? 'bg-on-surface/35' : 'bg-[repeating-linear-gradient(135deg,rgb(128_128_128/0.45)_0_2px,transparent_2px_5px)]'"
                                :style="{ flex: part.share }"
                                :title="`${part.label} · ${percent(part.share, wholeOf(field))}`"
                                class="rounded-[3px]"
                            />
                        </div>
                        <div
                            v-if="typeParts(field).length > 1"
                            class="flex flex-wrap gap-x-3 text-[11.5px] text-on-surface-variant"
                        >
                            <span
                                v-for="part in typeParts(field)"
                                :key="part.label"
                            >{{ part.label }} {{ percent(part.share, wholeOf(field)) }}</span>
                        </div>

                        <p
                            v-if="chartOf(field) === 'unique'"
                            class="m-0 text-[12px] text-on-surface-variant"
                        >
                            {{ $t("schema.unique", { count: format(field.present) }) }}
                        </p>
                        <p
                            v-else-if="chartOf(field) === 'texts'"
                            class="m-0 text-[12px] text-on-surface-variant"
                        >
                            {{ $t("schema.manyTexts") }}
                        </p>

                        <!-- Frequent values as bars; a click filters by the value. -->
                        <div
                            v-else-if="chartOf(field) === 'values' || chartOf(field) === 'lengths'"
                            class="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-x-2 gap-y-1 text-[12px]"
                        >
                            <template
                                v-for="item in chartOf(field) === 'lengths' ? (field.lengths ?? []).slice(0, SHOWN_VALUES) : bars(field)"
                                :key="String(item.value)"
                            >
                                <span class="truncate font-mono text-on-surface-strong">{{ chartOf(field) === 'lengths' ? $t("schema.entries", { count: item.value }, Number(item.value)) : preview(item.value, 40) }}</span>
                                <ButtonRoot
                                    @click="choose(chartOf(field) === 'lengths' ? { field: field.path, value: { $size: item.value } } : { field: field.path, value: item.value }, $event)"
                                    :aria-pressed="picked(chartOf(field) === 'lengths' ? { field: field.path, value: { $size: item.value } } : { field: field.path, value: item.value })"
                                    :title="$t('schema.barTip', { value: preview(item.value, 40), count: format(item.count) })"
                                    class="h-3 rounded-[3px] bg-on-surface/8 overflow-hidden text-left"
                                    data-testid="schema-bar"
                                >
                                    <span
                                        :class="picked(chartOf(field) === 'lengths' ? { field: field.path, value: { $size: item.value } } : { field: field.path, value: item.value }) ? 'opacity-100' : 'opacity-55'"
                                        :style="{ width: `${(item.count / maxCount(chartOf(field) === 'lengths' ? field.lengths ?? [] : bars(field))) * 100}%` }"
                                        class="block h-full rounded-[3px] bg-primary"
                                    />
                                </ButtonRoot>
                                <span class="tabular-nums text-on-surface-variant">{{ format(item.count) }}</span>
                            </template>
                        </div>

                        <!-- Numbers and dates in ten classes; a click filters by the range. -->
                        <div v-else-if="chartOf(field) === 'numbers' || chartOf(field) === 'dates'">
                            <div class="h-16 flex items-end gap-0.5">
                                <ButtonRoot
                                    v-for="(bin, index) in (chartOf(field) === 'dates' ? field.dates : field.numbers) ?? []"
                                    :key="index"
                                    @click="choose({ field: field.path, range: bin, last: index === BINS_LAST, date: chartOf(field) === 'dates' }, $event)"
                                    :aria-label="$t('schema.binTip', { from: binLabel(bin, chartOf(field) === 'dates'), count: format(bin.count) })"
                                    :title="$t('schema.binTip', { from: binLabel(bin, chartOf(field) === 'dates'), count: format(bin.count) })"
                                    class="grow h-full flex items-end"
                                    data-testid="schema-bin"
                                >
                                    <span
                                        :class="picked({ field: field.path, range: bin, last: index === BINS_LAST, date: chartOf(field) === 'dates' }) ? 'opacity-100' : 'opacity-55'"
                                        :style="{ height: `${Math.max(2, (bin.count / maxCount((chartOf(field) === 'dates' ? field.dates : field.numbers) ?? [])) * 100)}%` }"
                                        class="block w-full rounded-t-[3px] bg-primary"
                                    />
                                </ButtonRoot>
                            </div>
                            <div class="flex justify-between text-[11px] text-on-surface-variant">
                                <span>{{ binLabel(((chartOf(field) === 'dates' ? field.dates : field.numbers) ?? [])[0]!, chartOf(field) === 'dates') }}</span>
                                <span>{{ chartOf(field) === 'dates' ? new Date(((field.dates ?? []).at(-1)?.to ?? 0)).toLocaleDateString(locale) : Number(((field.numbers ?? []).at(-1)?.to ?? 0).toPrecision(4)).toLocaleString(locale) }}</span>
                            </div>
                        </div>

                        <p
                            v-if="field.values && field.distinct > SHOWN_VALUES && chartOf(field) === 'values'"
                            class="m-0 text-[11.5px] text-on-surface-variant"
                        >
                            {{ $t("schema.more", { count: field.distinct - SHOWN_VALUES }) }}
                        </p>

                        <!-- Mixed types: one neutral line, and the documents behind it. -->
                        <p
                            v-if="mixedTypes(field) && otherType(field)"
                            class="m-0 text-[11.5px] text-on-surface-variant"
                        >
                            {{ $t("schema.otherValues", { count: format(otherType(field)!.count), type: typeName(otherType(field)!.type) }) }}
                            <ButtonRoot
                                @click="openFiltered(typeFilter(field.path, otherType(field)!.type))"
                                class="text-primary hover:underline"
                                data-testid="schema-show-other"
                            >
                                <ButtonContent>{{ $t("schema.showThese") }}</ButtonContent>
                            </ButtonRoot>
                        </p>

                        <p
                            v-if="field.children.length > 0"
                            class="m-0 text-[11.5px] text-on-surface-variant"
                        >
                            {{ $t("schema.subfields") }}
                            <ButtonRoot
                                @click="toggleFold(field.path)"
                                class="text-primary hover:underline"
                                data-testid="schema-unfold"
                            >
                                <ButtonContent>{{ unfolded.has(field.path) ? $t("schema.foldFields") : field.children.map(child => child.slice(field.path.length + 1)).join(", ") }}</ButtonContent>
                            </ButtonRoot>
                        </p>
                    </article>
                </div>
            </template>
        </div>
    </section>
</template>
