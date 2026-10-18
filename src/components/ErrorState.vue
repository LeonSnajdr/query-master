<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import CopiedLabel from "@/components/CopiedLabel.vue";
import { useCopy } from "@/composables/clipboard";

/**
 * What went wrong, in place of what could not be shown (the result of a run, the content of a page):
 * centred, with the text to copy and the buttons of the slot. Never above the content, so nothing
 * moves. A note (`info`), e.g. a lock that refused a write, is not red.
 */
const props = withDefaults(defineProps<{
    title: string;
    detail?: string;
    kind?: "error" | "info";
}>(), { detail: undefined, kind: "error" });

const { copied, copy } = useCopy();
</script>

<template>
    <div
        :data-kind="kind"
        class="h-full min-h-32 flex flex-col items-center justify-center gap-1.5 px-6 py-4 text-center font-sans"
        data-testid="error-state"
        role="alert"
    >
        <span
            :class="kind === 'error' ? 'i-lucide-circle-alert text-error' : 'i-lucide-info text-primary'"
            class="size-5.5 shrink-0"
        />
        <p class="m-0 text-[14px] text-on-surface-strong">
            {{ title }}
        </p>
        <p
            v-if="detail"
            class="m-0 max-w-[60rem] max-h-40 overflow-y-auto font-mono text-[12.5px] text-on-surface whitespace-pre-wrap break-words select-text"
            data-testid="error-detail"
        >
            {{ detail }}
        </p>
        <div class="mt-1.5 flex flex-wrap justify-center gap-2">
            <slot />
            <ButtonRoot
                v-if="props.detail"
                @click="copy(props.detail)"
                class="btn-secondary h-7! text-[12px]"
            >
                <ButtonContent>
                    <CopiedLabel :copied />
                </ButtonContent>
            </ButtonRoot>
        </div>
    </div>
</template>
