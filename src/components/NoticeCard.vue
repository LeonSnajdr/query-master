<script setup lang="ts">
import { ButtonContent, ButtonRoot, useResizeObserver, useTimer } from "@vuetify/v0";
import { computed, onMounted, useTemplateRef, watch } from "vue";
import { useNotices } from "@/composables/notices";
import type { Notice, NoticeAction } from "@/composables/notices";

const emit = defineEmits<{
    height: [id: number, height: number];
}>();
/** One card of the notice stack: symbol, title, detail, actions, progress, and the time it has left. */
const props = defineProps<{
    notice: Notice;
    /** The pointer rests on the stack: the time stands still. */
    paused: boolean;
}>();
const notices = useNotices();
const card = useTemplateRef("card");

const ICONS: Record<Notice["kind"], string> = {
    success: "i-lucide-circle-check text-success",
    info: "i-lucide-info text-primary",
    warning: "i-lucide-triangle-alert text-warning",
    error: "i-lucide-circle-x text-error",
    progress: "i-lucide-loader-circle animate-spin text-primary"
};

const timer = useTimer(() => notices.dismiss(props.notice.id), { duration: () => props.notice.lifetime });
onMounted(() => {
    if (props.notice.lifetime > 0) timer.start();
    if (props.paused) timer.pause();
});
watch(() => props.paused, paused => (paused ? timer.pause() : timer.resume()));

/** What is left of the card's time, for the thin line at its foot. */
const left = computed(() => (props.notice.lifetime > 0 ? timer.remaining.value / props.notice.lifetime : 1));
const share = computed(() => (props.notice.total ? Math.min(1, (props.notice.done ?? 0) / props.notice.total) : undefined));

useResizeObserver(card, (entries) => {
    const height = entries[0]?.borderBoxSize?.[0]?.blockSize ?? card.value?.offsetHeight ?? 0;
    emit("height", props.notice.id, height);
});

async function act(action: NoticeAction) {
    await action.run();
    if (!action.keep) notices.dismiss(props.notice.id);
}
</script>

<template>
    <div
        ref="card"
        :class="notice.kind === 'error' ? 'border-error/45' : 'border-divider'"
        :data-kind="notice.kind"
        :role="notice.kind === 'error' ? 'alert' : 'status'"
        class="relative overflow-hidden grid grid-cols-[1rem_1fr_auto] gap-x-2.5 gap-y-0.5 items-start pl-3 pr-2 py-2.5 rounded-lg bg-dock border shadow-[0_8px_24px_rgb(0_0_0/0.45)] text-[13px]"
        data-testid="notice"
    >
        <span
            :class="ICONS[notice.kind]"
            class="size-4 mt-px"
        />
        <span
            class="min-w-0 text-on-surface-strong break-words"
            data-testid="notice-title"
        >{{ notice.title }}</span>
        <button
            @click="notices.dismiss(notice.id)"
            :aria-label="$t('action.close')"
            class="size-5 -mt-0.5 inline-flex items-center justify-center rounded-sm text-on-surface-variant hover:text-on-surface-strong hover:bg-on-surface/10"
            data-testid="notice-close"
            type="button"
        >
            <span class="i-lucide-x size-3.5" />
        </button>
        <span
            v-if="notice.detail"
            class="col-start-2 col-span-2 text-[12px] text-on-surface-variant break-words whitespace-pre-line line-clamp-4"
        >{{ notice.detail }}</span>
        <div
            v-if="notice.kind === 'progress'"
            :aria-valuemax="notice.total || undefined"
            :aria-valuenow="notice.done"
            aria-valuemin="0"
            class="col-start-2 col-span-2 h-1 mt-1.5 rounded-full bg-on-surface/15 overflow-hidden"
            role="progressbar"
        >
            <!-- Without a known end the bar only shows that something happens. -->
            <div
                :class="share === undefined ? 'w-1/3 animate-pulse' : 'transition-[width]'"
                :style="share === undefined ? undefined : { width: `${share * 100}%` }"
                class="h-full bg-primary"
            />
        </div>
        <div
            v-if="notice.actions.length > 0"
            class="col-start-2 col-span-2 flex flex-wrap gap-1.5 mt-1.5"
        >
            <ButtonRoot
                v-for="(action, index) in notice.actions"
                :key="action.label"
                @click="act(action)"
                :class="index === 0 && notice.kind !== 'error' ? 'btn-primary' : 'btn-secondary'"
                class="h-6.5! px-2.5! text-[12px]!"
                data-testid="notice-action"
            >
                <ButtonContent>{{ action.label }}</ButtonContent>
            </ButtonRoot>
        </div>
        <!-- The time the card has left. -->
        <span
            v-if="notice.lifetime > 0"
            :class="notice.kind === 'success' ? 'text-success' : 'text-primary'"
            :style="{ width: `${left * 100}%` }"
            class="absolute left-0 bottom-0 h-0.5 bg-current opacity-30"
        />
    </div>
</template>
