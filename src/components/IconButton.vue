<script setup lang="ts">
import { ButtonContent, ButtonIcon, ButtonRoot } from "@vuetify/v0";

/** A button of a toolbar: an icon, with a text behind it when the default slot is filled. */
withDefaults(defineProps<{
    icon: string;
    /** Tooltip and accessible name. */
    label: string;
    disabled?: boolean;
    /** Drawn as switched on; given at all, the button is a toggle and says whether it is pressed. */
    active?: boolean;
    /** Color class of the icon, for the few that carry one (run, add, delete). */
    tint?: string;
}>(), { active: undefined, tint: undefined });

// Click handlers and test ids go to the button element itself.
defineOptions({ inheritAttrs: false });
</script>

<template>
    <!-- Renderless: outside a button group v0 leaves `aria-pressed` unset, so the element is our own. -->
    <ButtonRoot
        v-slot="{ attrs }"
        :ariaLabel="label"
        :disabled
        renderless
    >
        <button
            v-bind="{ ...attrs, ...$attrs }"
            :aria-pressed="active"
            :class="active ? 'bg-primary/25 text-on-surface-strong' : 'text-on-surface hover:text-on-surface-strong hover:bg-on-surface/10'"
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
        </button>
    </ButtonRoot>
</template>
