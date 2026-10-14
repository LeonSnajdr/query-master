<script setup lang="ts">
import { computed } from "vue";
import { highlight } from "@/choice";
import type { Choice } from "@/choice";

/** An entry of the list: a check when it is the current value, its text with the typed part marked, its hint. */
const props = defineProps<{
    choice: Choice<unknown>;
    /** What was typed; empty marks nothing. */
    query?: string;
    /** The field holds this entry. */
    current?: boolean;
}>();

const parts = computed(() => highlight(props.choice.label, props.query ?? ""));
</script>

<template>
    <span
        :class="current ? 'i-lucide-check text-primary' : ''"
        class="size-4 shrink-0"
    />
    <span
        :title="choice.label"
        class="grow min-w-0 truncate"
    >
        <template
            v-for="(part, index) in parts"
            :key="index"
        >
            <mark
                v-if="part.match"
                class="bg-transparent text-inherit font-semibold underline decoration-primary underline-offset-3"
            >{{ part.text }}</mark>
            <template v-else>{{ part.text }}</template>
        </template>
    </span>
    <span
        v-if="choice.hint"
        class="shrink-0 pl-4 text-[12px] text-on-surface-variant"
    >{{ choice.hint }}</span>
</template>
