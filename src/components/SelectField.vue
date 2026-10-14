<script setup lang="ts" generic="T extends string | number">
import { computed } from "vue";
import DropMenu from "@/components/DropMenu.vue";
import type { MenuEntry } from "@/menu";

/** A choice among a few values, drawn as a field with a drop-down selects. */
const props = defineProps<{
    options: { value: T; label: string }[];
    label: string;
}>();
const model = defineModel<T>({ required: true });

const entries = computed<MenuEntry[]>(() => props.options.map(option => ({
    label: option.label,
    checked: option.value === model.value,
    action: () => (model.value = option.value)
})));
const current = computed(() => props.options.find(option => option.value === model.value)?.label ?? "");
</script>

<template>
    <DropMenu
        :entries
        :label
        positionArea="bottom span-right"
    >
        <span
            class="field w-full flex items-center justify-between gap-2 text-left"
            data-testid="select-field"
        >
            <span class="truncate">{{ current }}</span>
            <span class="i-lucide-chevron-down size-4 shrink-0 text-on-surface-variant" />
        </span>
    </DropMenu>
</template>
