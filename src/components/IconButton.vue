<script setup lang="ts">
import { ButtonContent, ButtonIcon, ButtonRoot } from "@vuetify/v0";

/** A button of a toolbar: an icon, with a text behind it when the default slot is filled. */
defineProps<{
    icon: string;
    /** Tooltip and accessible name. */
    label: string;
    disabled?: boolean;
    /** Drawn as switched on. */
    active?: boolean;
    /** Color class of the icon, for the few that carry one (run, add, delete). */
    tint?: string;
}>();
</script>

<template>
    <ButtonRoot
        :aria-pressed="active === undefined ? undefined : active"
        :ariaLabel="label"
        :class="active ? 'bg-primary/25 text-on-surface-strong' : 'text-on-surface hover:text-on-surface-strong hover:bg-on-surface/10'"
        :disabled
        :title="label"
        class="h-6.5 min-w-6 px-1 shrink-0 inline-flex items-center justify-center gap-1.5 rounded-sm text-[13px] whitespace-nowrap disabled:opacity-35 disabled:hover:bg-transparent"
    >
        <ButtonIcon>
            <span
                :class="[icon, disabled ? '' : tint]"
                class="size-4 block"
            />
        </ButtonIcon>
        <ButtonContent
            v-if="$slots.default"
            class="pr-1 text-on-surface-strong"
        >
            <slot />
        </ButtonContent>
    </ButtonRoot>
</template>
