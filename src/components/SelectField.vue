<script setup lang="ts" generic="T extends string | number">
import { SelectActivator, SelectContent, SelectCue, SelectItem, SelectRoot, SelectValue } from "@vuetify/v0";
import { computed } from "vue";

/**
 * A choice among a few values, drawn: a field with a chevron,
 * and below it a list as wide as the field, the current value highlighted. Arrow keys, Enter and
 * typing work as in a native select (v0 `Select`).
 */
const props = defineProps<{
    options: { value: T; label: string }[];
    label: string;
}>();
const model = defineModel<T>({ required: true });

const current = computed(() => props.options.find(option => option.value === model.value)?.label ?? "");
</script>

<template>
    <SelectRoot
        v-model="model"
        mandatory
    >
        <SelectActivator
            :label
            :title="label"
            class="field w-full flex items-center justify-between gap-2 text-left cursor-default data-[state=open]:border-primary data-[state=open]:rounded-b-none"
            data-testid="select-field"
        >
            <SelectValue class="truncate">
                {{ current }}
            </SelectValue>
            <SelectCue class="i-lucide-chevron-down size-4 shrink-0 text-on-surface-variant transition-transform data-[state=open]:rotate-180" />
        </SelectActivator>
        <SelectContent class="select-list">
            <SelectItem
                v-for="option in options"
                :key="option.value"
                v-slot="{ attrs, isSelected, isHighlighted }"
                :value="option.value"
                renderless
            >
                <div
                    v-bind="attrs"
                    :class="isHighlighted ? 'bg-primary/25 text-on-surface-strong' : isSelected ? 'bg-on-surface/8 text-on-surface-strong' : 'text-on-surface'"
                    class="px-2.5 py-1 text-[13px] cursor-default truncate"
                    data-testid="select-option"
                >
                    {{ option.label }}
                </div>
            </SelectItem>
        </SelectContent>
    </SelectRoot>
</template>
