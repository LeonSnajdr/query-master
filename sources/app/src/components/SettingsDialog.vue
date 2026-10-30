<script setup lang="ts">
import { DialogClose, DialogContent, DialogRoot, DialogTitle, TabsItem, TabsList, TabsPanel, TabsRoot } from "@vuetify/v0";
import { computed, nextTick, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { LOCALES } from "../../i18n/i18n.config";
import type { AppLocale } from "../../i18n/i18n.config";
import ChoiceField from "@/components/ChoiceField.vue";
import KeybindingsTab from "@/components/KeybindingsTab.vue";
import { AUTO_EXPANDS, DATE_FORMATS, DEFAULT_TABS, JSON_VIEWS, LEGACY_UUIDS, RESULT_VIEWS, STARTUPS, startupChoice, TAB_WIDTHS, TIME_ZONES, useAppearance } from "@/composables/appearance";
import type { DisplaySetting } from "@/composables/appearance";
import type { Startup, StartView } from "@/composables/appearance";
import type { SettingsPage } from "@/composables/dialogs";
import { THEMES } from "@/plugins/vuetify";
import type { ThemeName } from "@/plugins/vuetify";
import { PAGE_SIZES } from "@/stores/tabs";

/** The settings of the app in two tabs, General and Keyboard shortcuts; each change applies and is kept at once. */
const open = defineModel<boolean>({ default: false });
const page = defineModel<SettingsPage>("page", { default: "general" });
const PAGES: SettingsPage[] = ["general", "display", "keys"];

// A tab only selects once it is there; on opening the tabs choose the first, so the page asked for is set again.
watch(open, async (isOpen) => {
    if (!isOpen) return;
    const wanted = page.value;
    await nextTick();
    page.value = wanted;
});

const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18];

const { t } = useI18n();
const { theme, language, preferences, setTheme, setLanguage, setPreferences } = useAppearance();

const languageModel = computed({ get: () => language.value, set: (value: AppLocale) => setLanguage(value) });
const themeModel = computed({ get: () => theme.value, set: (value: ThemeName) => setTheme(value) });
const pageSize = computed({ get: () => preferences.pageSize, set: (value: number) => setPreferences({ pageSize: value }) });
const resultView = computed({ get: () => preferences.resultView, set: (value: StartView) => setPreferences({ resultView: value }) });
const fontSize = computed({ get: () => preferences.editorFontSize, set: (value: number) => setPreferences({ editorFontSize: value }) });
/** Read anew when the dialog opens: the card at the start may have changed it. */
const startupVersion = shallowRef(0);
watch(open, () => startupVersion.value++);
const startup = computed({
    get: () => (startupVersion.value, startupChoice()),
    set: (value: Startup) => {
        setPreferences({ startup: value });
        startupVersion.value++;
    }
});
/**
 * A choice of the tab *Display*, in the preferences: the setting it changes, its
 * values (labels from `settings.<key>.<value>`) and a model for its field.
 */
function displayChoice(key: DisplaySetting, values: readonly (string | number | boolean)[]) {
    return {
        key,
        options: values.map(value => ({ value: String(value), label: t(`settings.${key}.${String(value)}`) })),
        model: computed({
            get: () => String((preferences as Record<string, unknown>)[key]),
            set: (value: string) => setPreferences({ [key]: typeof values[0] === "number" ? Number(value) : typeof values[0] === "boolean" ? value === "true" : value })
        })
    };
}
const DISPLAY = [
    displayChoice("defaultTab", DEFAULT_TABS),
    displayChoice("autoExpand", AUTO_EXPANDS),
    displayChoice("jsonView", JSON_VIEWS),
    displayChoice("dateFormat", DATE_FORMATS),
    displayChoice("timeZone", TIME_ZONES),
    displayChoice("legacyUuid", LEGACY_UUIDS),
    displayChoice("numberGrouping", [false, true]),
    displayChoice("typeColors", [true, false])
];
const EDITOR = [displayChoice("tabWidth", TAB_WIDTHS), displayChoice("autoClose", [true, false])];

const startupOptions = computed(() => STARTUPS.map(value => ({ value, label: t(`settings.startup.${value}`) })));

const languageOptions = computed(() => LOCALES.map(value => ({ value, label: t(`language.${value}`) })));
const themeOptions = computed(() => THEMES.map(value => ({ value, label: t(`theme.${value}`) })));
const pageSizeOptions = PAGE_SIZES.map(value => ({ value, label: String(value) }));
const viewOptions = computed(() => RESULT_VIEWS.map(value => ({ value, label: t(`view.${value}.long`) })));
const fontSizeOptions = FONT_SIZES.map(value => ({ value, label: `${value} px` }));
</script>

<template>
    <DialogRoot v-model="open">
        <DialogContent class="dialog w-[min(94vw,52rem)]!">
            <div
                class="flex flex-col gap-3 text-[13px]"
                data-testid="settings"
            >
                <DialogTitle class="dialog-title text-[21px]!">
                    {{ $t("settings.title") }}
                </DialogTitle>
                <!-- Manual: when a confirmation over the dialog closes, the focus comes back to the first tab without choosing it. -->
                <TabsRoot
                    v-model="page"
                    activation="manual"
                    mandatory
                >
                    <TabsList
                        :label="$t('settings.title')"
                        class="flex border-b border-divider"
                    >
                        <TabsItem
                            v-for="item in PAGES"
                            :key="item"
                            :data-testid="`settings-tab-${item}`"
                            :value="item"
                            class="h-8 px-3 text-[13px] text-on-surface border-b-2 border-transparent hover:text-on-surface-strong data-[selected]:text-primary data-[selected]:border-primary"
                        >
                            {{ $t(`settings.tab.${item}`) }}
                        </TabsItem>
                    </TabsList>
                    <TabsPanel
                        class="pt-4 max-w-[30rem] flex flex-col gap-4"
                        value="general"
                    >
                        <div class="form-grid grid-cols-[11rem_1fr]!">
                            <span>{{ $t("settings.language") }}:</span>
                            <ChoiceField
                                v-model="languageModel"
                                :label="$t('settings.language')"
                                :options="languageOptions"
                            />
                            <span>{{ $t("settings.theme") }}:</span>
                            <ChoiceField
                                v-model="themeModel"
                                :label="$t('settings.theme')"
                                :options="themeOptions"
                            />
                            <span class="pt-3 border-t border-divider">{{ $t("settings.pageSize") }}:</span>
                            <span class="pt-3 border-t border-divider">
                                <ChoiceField
                                    v-model="pageSize"
                                    :label="$t('settings.pageSize')"
                                    :options="pageSizeOptions"
                                    data-testid="settings-page-size"
                                />
                            </span>
                            <span>{{ $t("settings.view") }}:</span>
                            <ChoiceField
                                v-model="resultView"
                                :label="$t('settings.view')"
                                :options="viewOptions"
                                data-testid="settings-view"
                            />
                            <span>{{ $t("settings.fontSize") }}:</span>
                            <ChoiceField
                                v-model="fontSize"
                                :label="$t('settings.fontSize')"
                                :options="fontSizeOptions"
                            />
                            <span class="pt-3 border-t border-divider">{{ $t("settings.startup") }}:</span>
                            <span class="pt-3 border-t border-divider">
                                <ChoiceField
                                    v-model="startup"
                                    :label="$t('settings.startup')"
                                    :options="startupOptions"
                                    data-testid="settings-startup"
                                />
                            </span>
                        </div>
                        <p class="m-0 text-on-surface-variant">
                            {{ $t("settings.note") }}
                        </p>
                    </TabsPanel>
                    <TabsPanel
                        class="pt-4 max-w-[34rem] flex flex-col gap-4"
                        value="display"
                    >
                        <div class="form-grid grid-cols-[13rem_1fr]!">
                            <template
                                v-for="choice in DISPLAY"
                                :key="choice.key"
                            >
                                <span>{{ $t(`settings.${choice.key}`) }}:</span>
                                <ChoiceField
                                    v-model="choice.model.value"
                                    :data-testid="`settings-${choice.key}`"
                                    :label="$t(`settings.${choice.key}`)"
                                    :options="choice.options"
                                />
                            </template>
                            <span class="pt-3 border-t border-divider col-span-2 text-on-surface-variant">{{ $t("settings.editor") }}</span>
                            <template
                                v-for="choice in EDITOR"
                                :key="choice.key"
                            >
                                <span>{{ $t(`settings.${choice.key}`) }}:</span>
                                <ChoiceField
                                    v-model="choice.model.value"
                                    :label="$t(`settings.${choice.key}`)"
                                    :options="choice.options"
                                />
                            </template>
                        </div>
                        <p class="m-0 text-on-surface-variant">
                            {{ $t("settings.display.note") }}
                        </p>
                    </TabsPanel>
                    <TabsPanel
                        class="pt-3"
                        value="keys"
                    >
                        <KeybindingsTab v-if="open && page === 'keys'" />
                    </TabsPanel>
                </TabsRoot>
                <div class="flex justify-end">
                    <DialogClose
                        class="btn-secondary"
                        data-testid="settings-close"
                    >
                        {{ $t("action.close") }}
                    </DialogClose>
                </div>
            </div>
        </DialogContent>
    </DialogRoot>
</template>
