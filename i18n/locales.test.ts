import { describe, expect, test } from "vitest";
import i18n from "./i18n.config";
import deApp from "./locales/de/de.json";
import deV0 from "./locales/de/de.v0.json";
import enApp from "./locales/en/en.json";
import enV0 from "./locales/en/en.v0.json";
import { ALL_ENTRIES, docKey } from "../src/shell/catalog";

const files = [
    { name: "app", en: enApp as Record<string, string>, de: deApp as Record<string, string> },
    { name: "v0", en: enV0 as Record<string, string>, de: deV0 as Record<string, string> }
];

const sorted = (keys: string[]) => [...keys].sort((a, b) => a.localeCompare(b));
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe.each(files)("locales ($name)", ({ en, de }) => {
    test("de and en have the same keys", () => {
        expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    });

    test("keys are sorted", () => {
        expect(Object.keys(en)).toEqual(sorted(Object.keys(en)));
        expect(Object.keys(de)).toEqual(sorted(Object.keys(de)));
    });

    test("placeholders match between languages", () => {
        for (const [key, text] of Object.entries(en)) {
            expect({ key, p: placeholders(de[key]!) }).toEqual({ key, p: placeholders(text) });
        }
    });

    test("no empty translations", () => {
        for (const text of [...Object.values(en), ...Object.values(de)]) expect(text.trim()).not.toBe("");
    });
});

describe("catalog descriptions", () => {
    const app = enApp as Record<string, string>;

    test("every suggestion has its description", () => {
        const missing = ALL_ENTRIES.map(docKey).filter(key => !(key in app));
        expect(missing).toEqual([]);
    });

    test("no description is left without a suggestion", () => {
        const used = new Set(ALL_ENTRIES.map(docKey));
        expect(Object.keys(app).filter(key => key.startsWith("doc.") && !used.has(key))).toEqual([]);
    });

    test("every message compiles and resolves in both languages", () => {
        for (const locale of ["en", "de"] as const) {
            i18n.global.locale.value = locale;
            for (const key of Object.keys(app)) {
                const text = i18n.global.t(key, { count: 2, name: "x", names: "x", version: "1.0", detail: "x", what: "x", text: "x", from: 1, to: 2, milliseconds: 3, number: 4, language: "x", theme: "x", database: "x", id: "x", seconds: "1" });
                expect({ key, text }).not.toEqual({ key, text: key });
            }
        }
        expect(i18n.global.t("doc.stage.set")).toBe("Fügt berechnete Felder hinzu (Alias von $addFields)");
    });
});
