/**
 * How values are shown in the results, in the preferences set it: dates in a time zone
 * and format, numbers with or without thousands separators, binary subtype 3 as the UUID of a
 * driver. Without Vue; `src/components/results/result-context.ts` applies the chosen settings.
 */

export type TimeZone = "local" | "utc";
export type DateFormat = "local" | "iso" | "dmy" | "mdy";
export type LegacyUuid = "raw" | "dotnet" | "java" | "python";

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** The parts of a moment in a time zone; `offset` in minutes east of UTC. */
function partsOf(milliseconds: number, zone: TimeZone) {
    const date = new Date(milliseconds);
    if (zone === "utc") {
        return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds(), ms: date.getUTCMilliseconds(), offset: 0 };
    }
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds(), ms: date.getMilliseconds(), offset: -date.getTimezoneOffset() };
}

/** A date as the settings write it; `local` follows the language of the app. */
export function formatDate(milliseconds: number, format: DateFormat, zone: TimeZone, locale: string): string {
    if (Number.isNaN(milliseconds)) return "";
    if (format === "local") {
        const text = new Intl.DateTimeFormat(locale, {
            day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
            ...(zone === "utc" ? { timeZone: "UTC" } : {})
        }).format(milliseconds);
        // Date and time side by side, without the comma some locales put between.
        return text.replace(", ", " ");
    }
    const p = partsOf(milliseconds, zone);
    const time = `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
    if (format === "dmy") return `${pad(p.day)}-${pad(p.month)}-${p.year} ${time}`;
    if (format === "mdy") return `${pad(p.month)}-${pad(p.day)}-${p.year} ${time}`;
    const sign = p.offset < 0 ? "-" : "+";
    const offset = zone === "utc" ? "Z" : `${sign}${pad(Math.floor(Math.abs(p.offset) / 60))}:${pad(Math.abs(p.offset) % 60)}`;
    return `${p.year}-${pad(p.month)}-${pad(p.day)}T${time}.${pad(p.ms, 3)}${offset}`;
}

/** Digits of a number with the thousands separator of the locale; the rest of the text stays. */
export function groupDigits(text: string, locale: string): string {
    const match = /^(-?)(\d+)(\.\d+)?(e[+-]?\d+)?$/i.exec(text);
    if (!match) return text;
    const parts = new Intl.NumberFormat(locale).formatToParts(1234.5);
    const group = parts.find(part => part.type === "group")?.value ?? ",";
    const decimal = parts.find(part => part.type === "decimal")?.value ?? ".";
    const [, sign = "", whole = "", fraction = "", exponent = ""] = match;
    return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, group)}${fraction ? decimal + fraction.slice(1) : ""}${exponent}`;
}

const NAMES: Record<Exclude<LegacyUuid, "raw">, string> = { dotnet: "CSUUID", java: "JUUID", python: "PYUUID" };

/**
 * Binary subtype 3 as the UUID the driver that wrote it means: .NET swaps the first three
 * groups, Java each half, Python keeps the order. `undefined` for `raw` or not 16 bytes.
 */
export function legacyUuidText(base64: string, kind: LegacyUuid): string | undefined {
    if (kind === "raw") return undefined;
    let bytes: number[];
    try {
        bytes = [...atob(base64)].map(char => char.charCodeAt(0));
    } catch {
        return undefined;
    }
    if (bytes.length !== 16) return undefined;
    if (kind === "dotnet") bytes = [...bytes.slice(0, 4).reverse(), ...bytes.slice(4, 6).reverse(), ...bytes.slice(6, 8).reverse(), ...bytes.slice(8)];
    if (kind === "java") bytes = [...bytes.slice(0, 8).reverse(), ...bytes.slice(8).reverse()];
    const hex = bytes.map(byte => byte.toString(16).padStart(2, "0")).join("");
    return `${NAMES[kind]}("${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}")`;
}

/**
 * Canonical Extended JSON (as results hold their documents) in the relaxed form `mongoexport`
 * writes: plain numbers where JSON keeps them exactly, dates as ISO text between 1970 and 9999.
 */
export function toRelaxed(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(toRelaxed);
    if (value === null || typeof value !== "object") return value;
    const doc = value as Record<string, unknown>;
    const keys = Object.keys(doc);
    if (keys.length === 1) {
        const [key] = keys;
        const inner = doc[key!];
        if (key === "$numberInt" && typeof inner === "string") return Number(inner);
        if (key === "$numberDouble" && typeof inner === "string" && Number.isFinite(Number(inner))) return Number(inner);
        if (key === "$numberLong" && typeof inner === "string" && Number.isSafeInteger(Number(inner))) return Number(inner);
        if (key === "$date" && inner !== null && typeof inner === "object") {
            const milliseconds = Number((inner as { $numberLong?: string }).$numberLong);
            if (milliseconds >= 0 && milliseconds < 253402300800000) return { $date: new Date(milliseconds).toISOString() };
        }
    }
    return Object.fromEntries(keys.map(key => [key, toRelaxed(doc[key])]));
}
