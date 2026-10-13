import { useTheme } from "@vuetify/v0";
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { LOCALES } from "../../i18n/i18n.config";
import type { AppLocale } from "../../i18n/i18n.config";
import { THEMES } from "@/plugins/vuetify";
import type { ThemeName } from "@/plugins/vuetify";

const THEME_KEY = "querymaster:theme";
const LANGUAGE_KEY = "querymaster:language";

function stored<T extends string>(key: string, choices: readonly T[], fallback: T): T {
    try {
        const value = localStorage.getItem(key);
        return choices.find(choice => choice === value) ?? fallback;
    } catch {
        return fallback;
    }
}

function store(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Without storage the choice lasts until the app closes.
    }
}

function detectLanguage(): AppLocale {
    const preferred = navigator.language.slice(0, 2);
    return (LOCALES as readonly string[]).includes(preferred) ? (preferred as AppLocale) : "en";
}

const theme = ref<ThemeName>(stored(THEME_KEY, THEMES, "one-dark"));
const language = ref<AppLocale>(stored(LANGUAGE_KEY, LOCALES, detectLanguage()));

/** The theme and the language of the app, as chosen in the View menu. */
export function useAppearance() {
    function setTheme(value: ThemeName): void {
        theme.value = value;
        store(THEME_KEY, value);
    }

    function setLanguage(value: AppLocale): void {
        language.value = value;
        store(LANGUAGE_KEY, value);
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
