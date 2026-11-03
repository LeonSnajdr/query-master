<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import ChoiceField from "@/components/ChoiceField.vue";
import { COLLATION_CHOICES, COLLATION_LOCALES, COLLATION_OPTIONS, optionApplies } from "@/shell/collation";
import type { CollationForm, CollationOption } from "@/shell/collation";

/**
 * The collation form, for collections, views and indexes: the locale (one of MongoDB's
 * or typed) and every option, each with "default" to leave it to the server. Without a locale, or
 * with `simple`, the options are greyed: the server takes none then.
 */
const form = defineModel<CollationForm>({ required: true });

const { t } = useI18n();

const localeOptions = computed(() => [
    { value: "", label: t("collectionDialog.locale.none") },
    ...COLLATION_LOCALES.map(value => ({ value, label: value }))
]);

function choices(option: CollationOption) {
    return COLLATION_CHOICES[option].map(value => ({ value, label: value === "" ? t("collation.default") : t(`collation.${option}.${value}`) }));
}

function set(option: CollationOption | "locale", value: string) {
    form.value = { ...form.value, [option]: value };
}
</script>

<template>
    <div
        class="form-grid grid-cols-[12rem_1fr]!"
        data-testid="collation-fields"
    >
        <span>{{ $t("collectionDialog.locale") }}:</span>
        <ChoiceField
            @update:modelValue="(value: string) => set('locale', value)"
            :label="$t('collectionDialog.locale')"
            :modelValue="form.locale"
            :options="localeOptions"
            :placeholder="$t('collectionDialog.locale.none')"
            data-testid="collation-locale"
            free
        />
        <template
            v-for="option in COLLATION_OPTIONS"
            :key="option"
        >
            <span :class="optionApplies(form, option) ? '' : 'opacity-50'">{{ $t(`collation.${option}`) }}:</span>
            <ChoiceField
                @update:modelValue="(value: string) => set(option, value)"
                :data-testid="`collation-${option}`"
                :disabled="!optionApplies(form, option)"
                :label="$t(`collation.${option}`)"
                :modelValue="form[option]"
                :options="choices(option)"
            />
        </template>
    </div>
</template>
