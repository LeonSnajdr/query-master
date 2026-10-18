import { isDoc, toNumber } from "./ejson";
import type { Doc, Json } from "./ejson";

/**
 * A collation form edits it, for collections, views and indexes: the locale
 * and every option MongoDB knows. An empty choice leaves the option out (the server's default).
 */

/** The locales MongoDB supports, with their variants (`de@collation=phonebook`). */
export const COLLATION_LOCALES = [
    "simple", "af", "am", "ar", "ar@collation=compat", "as", "az", "az@collation=search", "be", "bg", "bn", "bn@collation=traditional",
    "bo", "bs", "bs@collation=search", "bs_Cyrl", "ca", "ca@collation=search", "chr", "cs", "cs@collation=search", "cy", "da",
    "da@collation=search", "de", "de@collation=eor", "de@collation=phonebook", "de@collation=search", "de_AT", "de_AT@collation=phonebook",
    "dsb", "dz", "ee", "el", "en", "en_US", "en_US_POSIX", "eo", "es", "es@collation=search", "es@collation=traditional", "et", "fa",
    "fa_AF", "fi_FI", "fi_FI@collation=search", "fi_FI@collation=traditional", "fil", "fo", "fr", "fr_CA", "ga", "gl", "gl@collation=search",
    "gu", "ha", "haw", "he", "he@collation=search", "hi", "hr", "hr@collation=search", "hsb", "hu", "hy", "id", "ig", "is",
    "is@collation=search", "it", "ja", "ja@collation=unihan", "ka", "kk", "kl", "kl@collation=search", "km", "kn", "kn@collation=traditional",
    "ko", "ko@collation=search", "ko@collation=searchjl", "ko@collation=unihan", "kok", "ky", "lb", "li", "li@collation=phonetic", "lk", "lo",
    "lt", "lv", "mk", "ml", "mn", "mr", "ms", "mt", "my", "nb", "nb@collation=search", "ne", "nl", "nn", "nn@collation=search", "om", "or",
    "pa", "pl", "ps", "pt", "ro", "ru", "se", "se@collation=search", "si", "si@collation=search", "sk", "sk@collation=search", "sl", "smn",
    "smn@collation=search", "sq", "sr", "sr_Latn", "sr_Latn@collation=search", "sv", "sv@collation=search", "sw", "ta", "te", "th", "to",
    "tr", "tr@collation=search", "ug", "uk", "ur", "vi", "vi@collation=traditional", "wae", "yi", "yi@collation=search", "yo", "zh",
    "zh@collation=big5han", "zh@collation=gb2312han", "zh@collation=pinyin", "zh@collation=unihan", "zh@collation=zhuyin", "zh_Hant",
    "zh_Hant@collation=stroke", "zu"
] as const;

/** Choices of the options; `""` leaves the option out. */
export const COLLATION_CHOICES = {
    strength: ["", "1", "2", "3", "4", "5"],
    caseLevel: ["", "true", "false"],
    caseFirst: ["", "upper", "lower", "off"],
    numericOrdering: ["", "true", "false"],
    alternate: ["", "non-ignorable", "shifted"],
    maxVariable: ["", "punct", "space"],
    backwards: ["", "true", "false"],
    normalization: ["", "true", "false"]
} as const;

export type CollationOption = keyof typeof COLLATION_CHOICES;
export const COLLATION_OPTIONS = Object.keys(COLLATION_CHOICES) as CollationOption[];

/** The form: the locale (empty for no collation) and each option as the text of its choice. */
export type CollationForm = { locale: string } & Record<CollationOption, string>;

export function emptyCollation(): CollationForm {
    return { locale: "", strength: "", caseLevel: "", caseFirst: "", numericOrdering: "", alternate: "", maxVariable: "", backwards: "", normalization: "" };
}

/** Options apply to a locale; with none or `simple` (binary comparison) MongoDB takes none. */
export function optionsApply(form: CollationForm): boolean {
    const locale = form.locale.trim();
    return locale !== "" && locale !== "simple";
}

/**
 * Whether an option can be set with the others as chosen: `caseFirst` needs the case level or a
 * strength above 2 (the server refuses it otherwise), `maxVariable` takes effect only with
 * `alternate: shifted`.
 */
export function optionApplies(form: CollationForm, option: CollationOption): boolean {
    if (!optionsApply(form)) return false;
    if (option === "caseFirst") return form.caseLevel === "true" || form.strength === "" || Number(form.strength) > 2;
    if (option === "maxVariable") return form.alternate === "shifted";
    return true;
}

const BOOLEAN_OPTIONS: CollationOption[] = ["caseLevel", "numericOrdering", "backwards", "normalization"];

/** The collation document of the form; undefined without a locale. */
export function collationDoc(form: CollationForm): Doc | undefined {
    const locale = form.locale.trim();
    if (!locale) return undefined;
    const doc: Doc = { locale };
    if (!optionsApply(form)) return doc;
    for (const option of COLLATION_OPTIONS) {
        const value = form[option];
        if (value === "" || !optionApplies(form, option)) continue;
        if (option === "strength") doc.strength = Number(value);
        else if (BOOLEAN_OPTIONS.includes(option)) doc[option] = value === "true";
        else doc[option] = value;
    }
    return doc;
}

/**
 * The form for a collation as the server gives it (`listIndexes`, `listCollections` list every
 * option with its value): each is kept as given, so saving again changes nothing. `version` is
 * the server's own and left out.
 */
export function collationFormOf(value: Json | undefined): CollationForm {
    const form = emptyCollation();
    if (!isDoc(value) || typeof value.locale !== "string") return form;
    form.locale = value.locale;
    for (const option of COLLATION_OPTIONS) {
        const given = value[option];
        if (given === undefined || given === null) continue;
        if (option === "strength") form.strength = String(toNumber(given) ?? "");
        else form[option] = String(given);
    }
    return form;
}
