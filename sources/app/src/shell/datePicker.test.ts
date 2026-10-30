import { describe, expect, it } from "vitest";
import { daysIn, momentOf, monthSheet, padded, partsOf, quickPick, setTime, stepTime, withDay } from "./datePicker";

const moment = Date.UTC(2026, 9, 19, 14, 32, 5, 120);

describe("date picker", () => {
    it("reads and writes the parts of a moment in UTC, keeping the milliseconds", () => {
        const parts = partsOf(moment, "utc");
        expect(parts).toEqual({ year: 2026, month: 9, day: 19, hour: 14, minute: 32, second: 5, millisecond: 120 });
        expect(momentOf(parts, "utc")).toBe(moment);
    });

    it("reads and writes local parts back to the same moment", () => {
        expect(momentOf(partsOf(moment, "local"), "local")).toBe(moment);
    });

    it("lays out six weeks from Monday", () => {
        const sheet = monthSheet(2026, 9);
        expect(sheet).toHaveLength(42);
        // 1 October 2026 is a Thursday: Monday 28 September starts the sheet.
        expect(sheet[0]).toMatchObject({ month: 8, day: 28, inMonth: false, weekend: false });
        expect(sheet[3]).toMatchObject({ month: 9, day: 1, inMonth: true });
        expect(sheet[5]?.weekend).toBe(true);
        expect(sheet.filter(day => day.inMonth)).toHaveLength(31);
    });

    it("keeps the time on another day and the 31st within a shorter month", () => {
        expect(daysIn(2026, 1)).toBe(28);
        expect(daysIn(2028, 1)).toBe(29);
        const last = { ...partsOf(Date.UTC(2026, 0, 31, 8), "utc") };
        expect(withDay(last, 2026, 1, 31)).toMatchObject({ month: 1, day: 28, hour: 8 });
    });

    it("steps a time field round its clock and holds typed numbers in range", () => {
        const parts = partsOf(moment, "utc");
        expect(stepTime({ ...parts, minute: 59 }, "minute", 1).minute).toBe(0);
        expect(stepTime({ ...parts, hour: 0 }, "hour", -1).hour).toBe(23);
        expect(stepTime(parts, "millisecond", -121).millisecond).toBe(999);
        expect(setTime(parts, "second", 75).second).toBe(59);
        expect(setTime(parts, "hour", Number.NaN).hour).toBe(0);
        expect(padded(5, "minute")).toBe("05");
        expect(padded(7, "millisecond")).toBe("007");
    });

    it("gives the quick choices in the zone of the picker", () => {
        const now = Date.UTC(2026, 9, 19, 1, 0, 0, 0);
        expect(quickPick("now", moment, now, "utc")).toBe(now);
        expect(quickPick("today", moment, now, "utc")).toBe(Date.UTC(2026, 9, 19));
        expect(quickPick("yesterday", moment, now, "utc")).toBe(Date.UTC(2026, 9, 18));
        expect(quickPick("monthStart", moment, now, "utc")).toBe(Date.UTC(2026, 9, 1));
        expect(quickPick("hourBack", moment, now, "utc")).toBe(moment - 3600_000);
        expect(quickPick("dayOn", moment, now, "utc")).toBe(Date.UTC(2026, 9, 20, 14, 32, 5, 120));
    });
});
