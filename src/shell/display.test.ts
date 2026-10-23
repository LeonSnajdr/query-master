import { describe, expect, it } from "vitest";
import { formatDate, groupDigits, legacyUuidText, toRelaxed } from "./display";

const AT = Date.UTC(2026, 6, 22, 7, 26, 0, 123);

describe("display of values", () => {
    it("writes dates in the format and zone chosen", () => {
        expect(formatDate(AT, "iso", "utc", "de")).toBe("2026-07-22T07:26:00.123Z");
        expect(formatDate(AT, "dmy", "utc", "de")).toBe("22-07-2026 07:26:00");
        expect(formatDate(AT, "mdy", "utc", "en")).toBe("07-22-2026 07:26:00");
        expect(formatDate(AT, "local", "utc", "de")).toBe("22.07.2026 07:26:00");
        // Local time carries its offset in ISO.
        expect(formatDate(AT, "iso", "local", "de")).toMatch(/^2026-07-2\dT\d\d:26:00\.123[+-]\d\d:\d\d$/);
    });

    it("groups digits as the locale does", () => {
        expect(groupDigits("12345678.9", "en")).toBe("12,345,678.9");
        expect(groupDigits("-9007199254740993", "de")).toBe("-9.007.199.254.740.993");
        expect(groupDigits("123", "de")).toBe("123");
        expect(groupDigits("NaN", "de")).toBe("NaN");
    });

    it("relaxes canonical Extended JSON as mongoexport does", () => {
        expect(toRelaxed({ a: { $numberInt: "1" }, b: { $numberLong: "9007199254740993" }, c: { $date: { $numberLong: "0" } }, d: [{ $numberDouble: "NaN" }] }))
            .toEqual({ a: 1, b: { $numberLong: "9007199254740993" }, c: { $date: "1970-01-01T00:00:00.000Z" }, d: [{ $numberDouble: "NaN" }] });
    });

    it("reads binary subtype 3 as the UUID of each driver", () => {
        // The bytes 00 01 … 0f.
        const base64 = btoa(String.fromCharCode(...Array.from({ length: 16 }, (_, index) => index)));
        expect(legacyUuidText(base64, "python")).toBe("PYUUID(\"00010203-0405-0607-0809-0a0b0c0d0e0f\")");
        expect(legacyUuidText(base64, "dotnet")).toBe("CSUUID(\"03020100-0504-0706-0809-0a0b0c0d0e0f\")");
        expect(legacyUuidText(base64, "java")).toBe("JUUID(\"07060504-0302-0100-0f0e-0d0c0b0a0908\")");
        expect(legacyUuidText(base64, "raw")).toBeUndefined();
        expect(legacyUuidText(btoa("short"), "java")).toBeUndefined();
    });
});
