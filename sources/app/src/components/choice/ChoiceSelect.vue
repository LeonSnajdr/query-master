<script setup lang="ts" generic="T extends string | number">
import { SelectActivator, SelectContent, SelectCue, SelectItem, SelectRoot, SelectValue } from "@vuetify/v0";
import { computed } from "vue";
import type { Choice } from "@/choice";
import ChoiceLabel from "./ChoiceLabel.vue";

/**
 * A choice among fixed values (v0 `Select`): arrow keys, Enter and Esc as in a native select,
 * typing jumps to the entry starting with it, as in Windows. No value of its own comes about.
 */
const props = defineProps<{
    options: Choice<T>[];
    label: string;
    compact?: boolean;
    loading?: boolean;
    placeholder?: string;
    disabled?: boolean;
}>();
const model = defineModel<T>({ required: true });
defineOptions({ inheritAttrs: false });

const current = computed(() => props.options.find(option => option.value === model.value));
</script>

<template>
    <SelectRoot
        v-model="model"
        :disabled
        mandatory
    >
        <SelectActivator
            v-bind="$attrs"
            :class="compact ? 'h-7!' : ''"
            :label
            :title="current?.label ?? label"
            class="field choice-field w-full flex items-center justify-between gap-2 text-left cursor-default disabled:opacity-60"
        >
            <SelectValue
                :class="current ? '' : 'text-on-surface-variant'"
                class="truncate"
            >
                {{ current?.label ?? placeholder }}
            </SelectValue>
            <SelectCue class="i-lucide-chevron-down size-4 shrink-0 text-on-surface-variant transition-transform data-[state=open]:rotate-180" />
        </SelectActivator>
        <SelectContent class="choice-list">
            <div
                v-if="loading"
                class="choice-option text-on-surface-variant"
            >
                <span class="i-lucide-loader-circle size-4 shrink-0 animate-spin" />{{ $t("choice.loading") }}
            </div>
            <SelectItem
                v-for="option in options"
                :key="option.value"
                v-slot="{ attrs, isSelected, isHighlighted }"
                :disabled="option.disabled"
                :value="option.value"
                renderless
            >
                <div
                    v-bind="attrs"
                    :data-highlighted="isHighlighted ? '' : undefined"
                    class="choice-option"
                    data-testid="choice-option"
                >
                    <ChoiceLabel
                        :choice="option"
                        :current="isSelected"
                    />
                </div>
            </SelectItem>
        </SelectContent>
    </SelectRoot>
</template>
