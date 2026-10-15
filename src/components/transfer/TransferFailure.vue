<script setup lang="ts">
import { ButtonContent, ButtonRoot, useTimer } from "@vuetify/v0";
import { computed, shallowRef } from "vue";
import type { RowProgress } from "@/transfer/progress";

/**
 * The message of a failed row, in one line next to the buttons of the wizard: of the row clicked
 * last, else of the first that failed. The rows keep their height; the whole message is in the
 * tooltip and can be copied.
 */
const props = defineProps<{
    rows: { source: string }[];
    progress: RowProgress[];
    selected?: number;
    kind: string;
}>();

const shown = computed(() => {
    const failed = (index: number | undefined) => index !== undefined && props.progress[index]?.state === "failed" && props.progress[index]?.error;
    const index = failed(props.selected) ? props.selected : props.progress.findIndex((_, item) => failed(item));
    if (index === undefined || index < 0) return undefined;
    return { source: props.rows[index]?.source ?? "", error: props.progress[index]!.error! };
});

const copied = shallowRef(false);
const copiedTimer = useTimer(() => (copied.value = false), { duration: 1500 });

async function copy() {
    if (!shown.value) return;
    await navigator.clipboard.writeText(shown.value.error);
    copied.value = true;
    copiedTimer.start();
}
</script>

<template>
    <div class="grow min-w-0 flex items-center gap-2">
        <template v-if="shown">
            <span class="i-lucide-circle-x size-4 shrink-0 text-error" />
            <span class="shrink-0 text-on-surface-strong">{{ shown.source }}</span>
            <span
                :data-testid="`${kind}-failure`"
                :title="shown.error"
                class="min-w-0 truncate text-error"
            >{{ shown.error }}</span>
            <ButtonRoot
                @click="copy"
                class="shrink-0 text-primary hover:underline"
            >
                <ButtonContent>{{ $t(copied ? "action.copied" : "action.copy") }}</ButtonContent>
            </ButtonRoot>
        </template>
    </div>
</template>
