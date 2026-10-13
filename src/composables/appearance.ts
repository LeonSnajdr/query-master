import { useTheme } from "@vuetify/v0";
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { LOCALES } from "../../i18n/i18n.config";
import type { AppLocale } from "../../i18n/i18n.config";
import { backend } from "@/api";
import { THEMES } from "@/plugins/vuetify";
import type { ThemeName } from "@/plugins/vuetify";

/** Where the choices lay before they moved into the app's database; read once, then removed. */
const LEGACY_KEYS = { theme: "querymaster:theme", language: "querymaster:language" };

function oneOf<T extends string>(choices: readonly T[], value: string | null | undefined): T | undefined {
    return choices.find(choice => choice === value);
}

function detectLanguage(): AppLocale {
    return oneOf(LOCALES, navigator.language.slice(0, 2)) ?? "en";
}

const theme = ref<ThemeName>("one-dark");
const language = ref<AppLocale>(detectLanguage());
/** What was chosen, as opposed to what applies: an unset language keeps following the system. */
const chosen = { language: null as string | null, theme: null as string | null };

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
    void backend.saveSetting({ ...chosen }).catch(error => console.warn("Settings were not saved", error));
}

/** Reads theme and language from the app's database (call before mounting, so nothing flickers). */
export async function loadAppearance(): Promise<void> {
    try {
        const setting = await backend.getSetting();
        chosen.language = setting.language;
        chosen.theme = setting.theme;
        // Installations from before the database: carried over once.
        const legacy = { language: takeLegacy(LEGACY_KEYS.language), theme: takeLegacy(LEGACY_KEYS.theme) };
        if (chosen.language === null && chosen.theme === null && (legacy.language || legacy.theme)) {
            chosen.language = legacy.language;
            chosen.theme = legacy.theme;
            save();
        }
    } catch (error) {
        console.warn("Settings could not be read", error);
    }
    theme.value = oneOf(THEMES, chosen.theme) ?? "one-dark";
    language.value = oneOf(LOCALES, chosen.language) ?? detectLanguage();
}

/** The theme and the language of the app, as chosen in the View menu. */
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

    return { theme, language, setTheme, setLanguage };
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
}
