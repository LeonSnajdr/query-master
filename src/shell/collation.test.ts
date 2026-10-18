import { describe, expect, it } from "vitest";
import { collationDoc, collationFormOf, COLLATION_LOCALES, emptyCollation, optionsApply } from "./collation";

describe("collation", () => {
    it("knows the locales of MongoDB with their variants", () => {
        expect(COLLATION_LOCALES).toContain("de@collation=phonebook");
        expect(COLLATION_LOCALES).toContain("zh@collation=pinyin");
        expect(COLLATION_LOCALES.length).toBeGreaterThan(140);
    });

    it("writes the locale and the options chosen, in their types", () => {
        expect(collationDoc(emptyCollation())).toBeUndefined();
        const form = { ...emptyCollation(), locale: "de", strength: "2", caseFirst: "upper", numericOrdering: "true", backwards: "false" };
        expect(collationDoc(form)).toEqual({ locale: "de", strength: 2, caseFirst: "upper", numericOrdering: true, backwards: false });
    });

    it("takes no options for simple, as the server", () => {
        const form = { ...emptyCollation(), locale: "simple", strength: "1" };
        expect(optionsApply(form)).toBe(false);
        expect(collationDoc(form)).toEqual({ locale: "simple" });
    });

    it("reads a collation as the server lists it, so saving again changes nothing", () => {
        const listed = { locale: "de", caseLevel: false, caseFirst: "off", strength: { $numberInt: "3" }, numericOrdering: true, alternate: "non-ignorable", maxVariable: "punct", normalization: false, backwards: false, version: "57.1" };
        const form = collationFormOf(listed);
        expect(form).toMatchObject({ locale: "de", strength: "3", caseLevel: "false", numericOrdering: "true", alternate: "non-ignorable", maxVariable: "punct" });
        expect(collationDoc(form)).toEqual({ locale: "de", caseLevel: false, caseFirst: "off", strength: 3, numericOrdering: true, alternate: "non-ignorable", maxVariable: "punct", normalization: false, backwards: false });
        expect(collationFormOf(undefined)).toEqual(emptyCollation());
    });
});
