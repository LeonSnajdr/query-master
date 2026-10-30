<script setup lang="ts">
/**
 * The text of a copy button that turns into "✓ Copied" for a moment (as GitHub and VS Code). Both
 * texts lie on top of each other, so the button keeps its width; a screen reader hears "Copied".
 */
defineProps<{
    copied: boolean;
    /** The button's own text; "Copy" when not given. */
    label?: string;
}>();
</script>

<template>
    <span class="inline-grid [&>*]:[grid-area:1/1]">
        <span :class="copied ? 'invisible' : ''">{{ label ?? $t("action.copy") }}</span>
        <span
            :class="copied ? '' : 'invisible'"
            aria-hidden="true"
            class="inline-flex items-center justify-center gap-1 text-success"
            data-testid="copied"
        >
            <span class="i-lucide-check size-3.5 shrink-0" />
            {{ $t("action.copied") }}
        </span>
        <span
            aria-live="polite"
            class="sr-only"
        >{{ copied ? $t("action.copied") : "" }}</span>
    </span>
</template>
