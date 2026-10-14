<script setup lang="ts">
import { DialogClose, DialogContent, DialogRoot, DialogTitle } from "@vuetify/v0";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { LOCALES } from "../../i18n/i18n.config";
import type { AppLocale } from "../../i18n/i18n.config";
import SelectField from "@/components/SelectField.vue";
import { RESULT_VIEWS, useAppearance } from "@/composables/appearance";
import type { StartView } from "@/composables/appearance";
import { THEMES } from "@/plugins/vuetify";
import type { ThemeName } from "@/plugins/vuetify";
import { PAGE_SIZES } from "@/stores/tabs";

/** The settings of the app; each change applies and is kept at once. */
const open = defineModel<boolean>({ default: false });

const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18];

const { t } = useI18n();
const { theme, language, preferences, setTheme, setLanguage, setPreferences } = useAppearance();

const languageModel = computed({ get: () => language.value, set: (value: AppLocale) => setLanguage(value) });
const themeModel = computed({ get: () => theme.value, set: (value: ThemeName) => setTheme(value) });
const pageSize = computed({ get: () => preferences.pageSize, set: (value: number) => setPreferences({ pageSize: value }) });
const resultView = computed({ get: () => preferences.resultView, set: (value: StartView) => setPreferences({ resultView: value }) });
const fontSize = computed({ get: () => preferences.editorFontSize, set: (value: number) => setPreferences({ editorFontSize: value }) });

const languageOptions = computed(() => LOCALES.map(value => ({ value, label: t(`language.${value}`) })));
const themeOptions = computed(() => THEMES.map(value => ({ value, label: t(`theme.${value}`) })));
const pageSizeOptions = PAGE_SIZES.map(value => ({ value, label: String(value) }));
const viewOptions = computed(() => RESULT_VIEWS.map(value => ({ value, label: t(`view.${value}.long`) })));
const fontSizeOptions = FONT_SIZES.map(value => ({ value, label: `${value} px` }));
</script>

<template>
    <DialogRoot v-model="open">
        <DialogContent class="dialog w-[min(94vw,30rem)]!">
            <div
                class="flex flex-col gap-4 text-[13px]"
                data-testid="settings"
            >
                <DialogTitle class="dialog-title text-[21px]!">
                    {{ $t("settings.title") }}
                </DialogTitle>
                <div class="form-grid grid-cols-[11rem_1fr]!">
                    <span>{{ $t("settings.language") }}:</span>
                    <SelectField
                        v-model="languageModel"
                        :label="$t('settings.language')"
                        :options="languageOptions"
                    />
                    <span>{{ $t("settings.theme") }}:</span>
                    <SelectField
                        v-model="themeModel"
                        :label="$t('settings.theme')"
                        :options="themeOptions"
                    />
                    <span class="pt-3 border-t border-divider">{{ $t("settings.pageSize") }}:</span>
                    <span class="pt-3 border-t border-divider">
                        <SelectField
                            v-model="pageSize"
                            :label="$t('settings.pageSize')"
                            :options="pageSizeOptions"
                            data-testid="settings-page-size"
                        />
                    </span>
                    <span>{{ $t("settings.view") }}:</span>
                    <SelectField
                        v-model="resultView"
                        :label="$t('settings.view')"
                        :options="viewOptions"
                        data-testid="settings-view"
                    />
                    <span>{{ $t("settings.fontSize") }}:</span>
                    <SelectField
                        v-model="fontSize"
                        :label="$t('settings.fontSize')"
                        :options="fontSizeOptions"
                    />
                </div>
                <p class="m-0 text-on-surface-variant">
                    {{ $t("settings.note") }}
                </p>
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
