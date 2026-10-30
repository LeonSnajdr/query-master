import type { TimeZone } from "./display";

/**
 * The calendar of the date picker: a moment shown and changed in local time or in UTC. MongoDB
 * keeps milliseconds since 1970 in UTC; only the parts shown depend on the zone.
 */
export interface DateParts {
    year: number;
    /** 0 = January. */
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    millisecond: number;
}

/** The parts of a moment as a clock in `zone` shows it. */
export function partsOf(milliseconds: number, zone: TimeZone): DateParts {
    const date = new Date(milliseconds);
    if (zone === "utc") {
        return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds(), millisecond: date.getUTCMilliseconds() };
    }
    return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds(), millisecond: date.getMilliseconds() };
}

/** The moment of parts read in `zone`; parts out of range carry over (day 32 is the 1st of the next month). */
export function momentOf(parts: DateParts, zone: TimeZone): number {
    const { year, month, day, hour, minute, second, millisecond } = parts;
    if (zone === "utc") return Date.UTC(year, month, day, hour, minute, second, millisecond);
    return new Date(year, month, day, hour, minute, second, millisecond).getTime();
}

/** The number of days of a month. */
export function daysIn(year: number, month: number): number {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** A day of the calendar sheet. */
export interface CalendarDay {
    year: number;
    month: number;
    day: number;
    /** Of the month shown, not of the weeks before or after it. */
    inMonth: boolean;
    /** Saturday or Sunday. */
    weekend: boolean;
}

/** Six weeks from Monday (as in Germany) that hold the month: always 42 days, so the sheet keeps its height. */
export function monthSheet(year: number, month: number): CalendarDay[] {
    const first = new Date(Date.UTC(year, month, 1));
    // Monday 0 … Sunday 6.
    const lead = (first.getUTCDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => {
        const date = new Date(Date.UTC(year, month, 1 - lead + index));
        const weekday = (date.getUTCDay() + 6) % 7;
        return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate(), inMonth: date.getUTCMonth() === month, weekend: weekday >= 5 };
    });
}

/** The same time of day on another day; the 31st becomes the last day of a shorter month. */
export function withDay(parts: DateParts, year: number, month: number, day: number): DateParts {
    return { ...parts, year, month, day: Math.min(day, daysIn(year, month)) };
}

/** The parts of a time field: their range, and the width they are written in. */
export const TIME_FIELDS = {
    hour: { max: 23, digits: 2 },
    minute: { max: 59, digits: 2 },
    second: { max: 59, digits: 2 },
    millisecond: { max: 999, digits: 3 }
} as const;
export type TimeField = keyof typeof TIME_FIELDS;

/** One step up or down in a time field, round the clock within the field (59 → 0), the day stays. */
export function stepTime(parts: DateParts, field: TimeField, by: number): DateParts {
    const size = TIME_FIELDS[field].max + 1;
    return { ...parts, [field]: (((parts[field] + by) % size) + size) % size };
}

/** A typed number for a time field, held within its range. */
export function setTime(parts: DateParts, field: TimeField, value: number): DateParts {
    return { ...parts, [field]: Math.min(TIME_FIELDS[field].max, Math.max(0, Math.trunc(value) || 0)) };
}

/** The quick choices of the picker; relative ones start from the value, the others from now. */
export const QUICK_PICKS = ["now", "today", "yesterday", "monthStart", "hourBack", "dayOn"] as const;
export type QuickPick = typeof QUICK_PICKS[number];

/** The moment a quick choice stands for, in `zone` (where "today" begins depends on it). */
export function quickPick(pick: QuickPick, value: number, now: number, zone: TimeZone): number {
    const today = partsOf(now, zone);
    const midnight = { ...today, hour: 0, minute: 0, second: 0, millisecond: 0 };
    switch (pick) {
        case "now": return now;
        case "today": return momentOf(midnight, zone);
        case "yesterday": return momentOf({ ...midnight, day: midnight.day - 1 }, zone);
        case "monthStart": return momentOf({ ...midnight, day: 1 }, zone);
        case "hourBack": return value - 3600_000;
        case "dayOn": {
            // A calendar day on, not 24 hours: the clock stays where it was across a change of summer time.
            const parts = partsOf(value, zone);
            return momentOf({ ...parts, day: parts.day + 1 }, zone);
        }
    }
}

/** A field written with its leading zeros: `5` → `05`, `7` milliseconds → `007`. */
export function padded(value: number, field: TimeField): string {
    return String(value).padStart(TIME_FIELDS[field].digits, "0");
}
