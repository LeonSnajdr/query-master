import { useTheme } from "@vuetify/v0";
import { reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { LOCALES } from "../../i18n/i18n.config";
import type { AppLocale } from "../../i18n/i18n.config";
import { backend } from "@/api";
import type { Setting } from "@/api";
import { warnOnce } from "@/composables/unseen";
import { THEMES } from "@/plugins/vuetify";
import type { ThemeName } from "@/plugins/vuetify";

/** Where the choices lay before they moved into the app's database; read once, then removed. */
const LEGACY_KEYS = { theme: "querymaster:theme", language: "querymaster:language" };

/** The views a result can start in, and the page sizes offered (as in the results toolbar). */
export const RESULT_VIEWS = ["tree", "table", "json"] as const;
export type StartView = typeof RESULT_VIEWS[number];
export const DEFAULTS = { pageSize: 20, resultView: "tree" as StartView, editorFontSize: 13 };

function oneOf<T extends string>(choices: readonly T[], value: string | null | undefined): T | undefined {
    return choices.find(choice => choice === value);
}

function detectLanguage(): AppLocale {
    return oneOf(LOCALES, navigator.language.slice(0, 2)) ?? "en";
}

const theme = ref<ThemeName>("one-dark");
const language = ref<AppLocale>(detectLanguage());
/** What new tabs start with, and the code font; read by the tabs store and the editor. */
export const preferences = reactive({ ...DEFAULTS });
/** What was chosen, as opposed to what applies: an unset language keeps following the system. */
const chosen: Setting = { language: null, theme: null, pageSize: null, resultView: null, editorFontSize: null, startup: null };

/** What the start does with the tabs of the last session (stage 20). */
export const STARTUPS = ["ask", "restore", "empty"] as const;
export type Startup = typeof STARTUPS[number];

/** The choice for the start; asking is the default. */
export function startupChoice(): Startup {
    return oneOf(STARTUPS, chosen.startup) ?? "ask";
}

function takeLegacy(key: string): string | null {
    try {
        const value = localStorage.getItem(key);
        localStorage.removeItem(key);
        return value;
    } catch {
        return null;
    }
}

function save(): void {
    void backend.saveSetting({ ...chosen }).catch(error => warnOnce("unseen.settingsNotSaved", error));
}

function apply(): void {
    theme.value = oneOf(THEMES, chosen.theme) ?? "one-dark";
    language.value = oneOf(LOCALES, chosen.language) ?? detectLanguage();
    preferences.pageSize = chosen.pageSize ?? DEFAULTS.pageSize;
    preferences.resultView = oneOf(RESULT_VIEWS, chosen.resultView) ?? DEFAULTS.resultView;
    preferences.editorFontSize = chosen.editorFontSize ?? DEFAULTS.editorFontSize;
}

/** Reads the settings from the app's database (call before mounting, so nothing flickers). */
export async function loadAppearance(): Promise<void> {
    try {
        Object.assign(chosen, await backend.getSetting());
        // Installations from before the database: carried over once.
        const legacy = { language: takeLegacy(LEGACY_KEYS.language), theme: takeLegacy(LEGACY_KEYS.theme) };
        if (chosen.language === null && chosen.theme === null && (legacy.language || legacy.theme)) {
            chosen.language = legacy.language;
            chosen.theme = legacy.theme;
            save();
        }
    } catch (error) {
        warnOnce("unseen.settingsNotRead", error);
    }
    apply();
}

/** The settings of the app, as chosen in the View menu and the settings dialog. */
export function useAppearance() {
    function setTheme(value: ThemeName): void {
        theme.value = value;
        chosen.theme = value;
        save();
    }

    function setLanguage(value: AppLocale): void {
        language.value = value;
        chosen.language = value;
        save();
    }

    /** What new tabs start with and the code font; `null` returns to the app's default. */
    function setPreferences(change: Partial<Pick<Setting, "pageSize" | "resultView" | "editorFontSize" | "startup">>): void {
        Object.assign(chosen, change);
        apply();
        save();
    }

    return { theme, language, preferences, setTheme, setLanguage, setPreferences };
}

/** Applies the chosen look and language to the app (call once, in `App.vue`). */
export function watchAppearance(): void {
    const selected = useTheme();
    const { locale } = useI18n();
    watch(theme, value => selected.select(value), { immediate: true });
    watch(language, (value) => {
        locale.value = value;
        document.documentElement.lang = value;
    }, { immediate: true });
    watch(() => preferences.editorFontSize, size => document.documentElement.style.setProperty("--editor-font-size", `${size}px`), { immediate: true });
}
