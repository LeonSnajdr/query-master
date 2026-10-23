<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { computed, nextTick, onMounted, ref, shallowRef, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import type { TimeZone } from "@/shell/display";
import { QUICK_PICKS, TIME_FIELDS, momentOf, monthSheet, padded, partsOf, quickPick, setTime, stepTime, withDay } from "@/shell/datePicker";
import type { CalendarDay, DateParts, QuickPick, TimeField } from "@/shell/datePicker";

const emit = defineEmits<{
    apply: [milliseconds: number];
    cancel: [];
}>();
/**
 * The calendar of a date value (variant A): a month from Monday, the time in segments down to the
 * millisecond, local time or UTC, and quick choices. Keys: arrows move the day, Page Up/Down the
 * month, ↑/↓ or the wheel change a time segment, Enter takes the value, Esc goes back.
 */
const props = defineProps<{
    /** Milliseconds since 1970 (UTC). */
    value: number;
    /** The zone it opens in: that of the display settings. */
    zone: TimeZone;
}>();
const { t, locale } = useI18n();

const zone = shallowRef<TimeZone>(props.zone);
const parts = ref<DateParts>(partsOf(props.value, zone.value));
/** The month on the sheet; the arrows move it without changing the value. */
const shown = ref({ year: parts.value.year, month: parts.value.month });
const moment = computed(() => momentOf(parts.value, zone.value));

const sheet = computed(() => monthSheet(shown.value.year, shown.value.month));
const today = computed(() => partsOf(Date.now(), zone.value));
const title = computed(() => new Intl.DateTimeFormat(locale.value, { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(shown.value.year, shown.value.month, 1)));
/** Mo … So in the language of the app; 1 January 2024 was a Monday. */
const weekdays = computed(() => Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale.value, { weekday: "short", timeZone: "UTC" }).format(Date.UTC(2024, 0, 1 + index)).replace(".", "")));

function same(day: CalendarDay, of: DateParts): boolean {
    return day.year === of.year && day.month === of.month && day.day === of.day;
}

/** A new value: the sheet follows it to its month. */
function setMoment(milliseconds: number) {
    parts.value = partsOf(milliseconds, zone.value);
    shown.value = { year: parts.value.year, month: parts.value.month };
}

function chooseDay(day: CalendarDay) {
    parts.value = withDay(parts.value, day.year, day.month, day.day);
    shown.value = { year: day.year, month: day.month };
}

function moveMonth(by: number) {
    const next = new Date(Date.UTC(shown.value.year, shown.value.month + by, 1));
    shown.value = { year: next.getUTCFullYear(), month: next.getUTCMonth() };
}

function showToday() {
    shown.value = { year: today.value.year, month: today.value.month };
}

/** The same moment, its parts as the other zone shows them. */
function switchZone(next: TimeZone) {
    if (next === zone.value) return;
    const at = moment.value;
    zone.value = next;
    setMoment(at);
}

function pick(choice: QuickPick) {
    setMoment(quickPick(choice, moment.value, Date.now(), zone.value));
}

/** Arrows: a day or a week; Page Up/Down: a month; Enter: take it; Esc: back. */
function onSheetKey(event: KeyboardEvent) {
    const days: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in days) {
        setMoment(momentOf({ ...parts.value, day: parts.value.day + days[event.key]! }, zone.value));
    } else if (event.key === "PageUp" || event.key === "PageDown") {
        const by = event.key === "PageUp" ? -1 : 1;
        const next = new Date(Date.UTC(parts.value.year, parts.value.month + by, 1));
        parts.value = withDay(parts.value, next.getUTCFullYear(), next.getUTCMonth(), parts.value.day);
        shown.value = { year: parts.value.year, month: parts.value.month };
    } else {
        return;
    }
    event.preventDefault();
}

const FIELDS = Object.keys(TIME_FIELDS) as TimeField[];
const segments = useTemplateRef<HTMLInputElement[]>("segments");
/** What is typed into a segment before it is complete. */
const typing = ref<Partial<Record<TimeField, string>>>({});

function segmentText(field: TimeField): string {
    return typing.value[field] ?? padded(parts.value[field], field);
}

/** Digits only; a full segment moves on to the next one, as in a time field of the system. */
function onSegmentInput(field: TimeField, event: Event) {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, "").slice(-TIME_FIELDS[field].digits);
    typing.value = { ...typing.value, [field]: digits };
    if (digits.length === TIME_FIELDS[field].digits) {
        finishSegment(field);
        segments.value?.[FIELDS.indexOf(field) + 1]?.select();
    }
}

function finishSegment(field: TimeField) {
    const digits = typing.value[field];
    if (digits !== undefined) parts.value = setTime(parts.value, field, Number(digits));
    const rest = { ...typing.value };
    delete rest[field];
    typing.value = rest;
}

function onSegmentKey(field: TimeField, event: KeyboardEvent) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        finishSegment(field);
        parts.value = stepTime(parts.value, field, event.key === "ArrowUp" ? 1 : -1);
        event.preventDefault();
    } else if (event.key === "Enter") {
        finishSegment(field);
        apply();
        event.preventDefault();
    }
}

function onSegmentWheel(field: TimeField, event: WheelEvent) {
    finishSegment(field);
    parts.value = stepTime(parts.value, field, event.deltaY < 0 ? 1 : -1);
}

function apply() {
    for (const field of FIELDS) finishSegment(field);
    emit("apply", moment.value);
}

function onKey(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    emit("cancel");
}

const sheetElement = useTemplateRef<HTMLElement>("sheetElement");
onMounted(() => void nextTick(() => sheetElement.value?.focus()));
</script>

<template>
    <div
        @keydown="onKey"
        class="w-[17.5rem] flex flex-col gap-2 p-2 text-[12.5px] font-sans text-on-surface"
        data-testid="date-picker"
    >
        <!-- Quick choices (from variant C). -->
        <div class="flex flex-wrap gap-1">
            <ButtonRoot
                v-for="choice in QUICK_PICKS"
                :key="choice"
                @click="pick(choice)"
                :data-testid="`date-quick-${choice}`"
                class="h-5 px-2 rounded-full border border-divider text-[11.5px] text-on-surface-variant hover:text-on-surface-strong hover:border-on-surface-variant/70"
            >
                <ButtonContent>{{ t(`date.quick.${choice}`) }}</ButtonContent>
            </ButtonRoot>
        </div>

        <div class="flex items-center justify-between">
            <span
                class="text-[13px] font-semibold text-on-surface-strong capitalize"
                data-testid="date-title"
            >{{ title }}</span>
            <span class="flex items-center gap-0.5">
                <ButtonRoot
                    @click="moveMonth(-1)"
                    :ariaLabel="t('date.previous')"
                    :title="t('date.previous')"
                    class="size-6 inline-flex items-center justify-center rounded-sm text-on-surface-variant hover:text-on-surface-strong hover:bg-on-surface/10"
                    data-testid="date-previous"
                >
                    <span class="i-lucide-chevron-left size-4" />
                </ButtonRoot>
                <ButtonRoot
                    @click="showToday"
                    class="h-6 px-1.5 rounded-sm text-[12px] text-on-surface-variant hover:text-on-surface-strong hover:bg-on-surface/10"
                >
                    <ButtonContent>{{ t("date.goToday") }}</ButtonContent>
                </ButtonRoot>
                <ButtonRoot
                    @click="moveMonth(1)"
                    :ariaLabel="t('date.next')"
                    :title="t('date.next')"
                    class="size-6 inline-flex items-center justify-center rounded-sm text-on-surface-variant hover:text-on-surface-strong hover:bg-on-surface/10"
                    data-testid="date-next"
                >
                    <span class="i-lucide-chevron-right size-4" />
                </ButtonRoot>
            </span>
        </div>

        <!-- The month from Monday: arrows move the day, Page Up/Down the month. -->
        <div
            ref="sheetElement"
            @keydown="onSheetKey"
            :aria-label="title"
            class="grid grid-cols-7 gap-px text-center outline-none rounded-sm focus-visible:ring-1 focus-visible:ring-primary/60"
            data-testid="date-sheet"
            role="grid"
            tabindex="0"
        >
            <span
                v-for="weekday in weekdays"
                :key="weekday"
                class="h-5 leading-5 text-[11px] text-on-surface-variant"
            >{{ weekday }}</span>
            <ButtonRoot
                v-for="day in sheet"
                :key="`${day.year}-${day.month}-${day.day}`"
                @click="chooseDay(day)"
                :aria-selected="same(day, parts)"
                :class="[
                    same(day, parts) ? 'bg-primary text-on-primary font-semibold' : day.inMonth ? (day.weekend ? 'text-on-surface-variant' : 'text-on-surface-strong') : 'text-on-surface-variant/45',
                    !same(day, parts) && same(day, today) ? 'ring-1 ring-inset ring-primary/70' : '',
                    same(day, parts) ? '' : 'hover:bg-on-surface/10'
                ]"
                class="h-6 rounded-sm tabular-nums"
                data-testid="date-day"
                role="gridcell"
                tabindex="-1"
            >
                <ButtonContent>{{ day.day }}</ButtonContent>
            </ButtonRoot>
        </div>

        <!-- The time down to the millisecond; the zone it is read in. -->
        <div class="flex items-center gap-1 font-mono">
            <template
                v-for="(field, index) in FIELDS"
                :key="field"
            >
                <span
                    v-if="index > 0"
                    class="text-on-surface-variant"
                >{{ field === "millisecond" ? "." : ":" }}</span>
                <input
                    ref="segments"
                    @blur="finishSegment(field)"
                    @focus="($event.target as HTMLInputElement).select()"
                    @input="onSegmentInput(field, $event)"
                    @keydown="onSegmentKey(field, $event)"
                    @wheel.prevent="onSegmentWheel(field, $event)"
                    :aria-label="t(`date.field.${field}`)"
                    :class="field === 'millisecond' ? 'w-9' : 'w-7'"
                    :data-testid="`date-${field}`"
                    :value="segmentText(field)"
                    class="h-6 px-1 text-center rounded-sm bg-background border border-divider outline-none focus:border-primary text-on-surface-strong tabular-nums"
                    inputmode="numeric"
                    spellcheck="false"
                />
            </template>
            <span class="grow" />
            <span
                :aria-label="t('date.zone')"
                class="inline-flex rounded-sm border border-divider overflow-hidden font-sans text-[11px]"
                role="radiogroup"
            >
                <ButtonRoot
                    v-for="option in (['local', 'utc'] as const)"
                    :key="option"
                    @click="switchZone(option)"
                    :aria-checked="zone === option"
                    :class="zone === option ? 'bg-primary/20 text-on-surface-strong' : 'text-on-surface-variant hover:text-on-surface-strong'"
                    :data-testid="`date-zone-${option}`"
                    class="h-6 px-2"
                    role="radio"
                >
                    <ButtonContent>{{ t(`date.zone.${option}`) }}</ButtonContent>
                </ButtonRoot>
            </span>
        </div>

        <div class="flex items-center justify-end gap-1.5 pt-1.5 border-t border-divider">
            <ButtonRoot
                @click="emit('cancel')"
                class="btn-secondary h-7! text-[12px]"
                data-testid="date-cancel"
            >
                <ButtonContent>{{ t("action.cancel") }}</ButtonContent>
            </ButtonRoot>
            <ButtonRoot
                @click="apply"
                class="btn-primary h-7! text-[12px]"
                data-testid="date-apply"
            >
                <ButtonContent>{{ t("date.apply") }}</ButtonContent>
            </ButtonRoot>
        </div>
    </div>
</template>
