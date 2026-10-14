<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogContent, DialogDescription, DialogRoot, DialogTitle } from "@vuetify/v0";
import { computed } from "vue";
import { useTask } from "@/composables/task";

/** Shown while a copy, an export or an import runs: how far it got, and a way to stop it. */
const { running, stop } = useTask();

// Closing (Escape) stops the work: it must not go on unseen.
const open = computed({ get: () => running.runId !== undefined, set: value => !value && stop() });
const share = computed(() => (running.total > 0 ? Math.min(1, running.done / running.total) : undefined));
</script>

<template>
    <DialogRoot v-model="open">
        <DialogContent class="dialog w-[min(94vw,28rem)]!">
            <div
                class="flex flex-col gap-4 text-[13px]"
                data-testid="task-progress"
            >
                <DialogTitle class="dialog-title">
                    {{ running.title }}
                </DialogTitle>
                <DialogDescription class="m-0 text-on-surface break-all">
                    {{ running.text }}
                </DialogDescription>
                <div
                    :aria-valuemax="running.total || undefined"
                    :aria-valuenow="running.done"
                    aria-valuemin="0"
                    class="h-1.5 rounded-full bg-on-surface/15 overflow-hidden"
                    role="progressbar"
                >
                    <!-- Without a known end the bar only shows that something happens. -->
                    <div
                        :class="share === undefined ? 'w-1/3 animate-pulse' : 'transition-[width]'"
                        :style="share === undefined ? undefined : { width: `${share * 100}%` }"
                        class="h-full bg-primary"
                    />
                </div>
                <span class="text-on-surface-variant tabular-nums">
                    {{ running.total > 0
                        ? $t("task.countOf", { done: running.done.toLocaleString(), total: running.total.toLocaleString() })
                        : $t("task.count", { done: running.done.toLocaleString() }, running.done) }}
                </span>
                <div class="flex justify-end">
                    <ButtonRoot
                        @click="stop"
                        class="btn-secondary"
                        data-testid="task-stop"
                    >
                        <ButtonContent>{{ $t("action.stop") }}</ButtonContent>
                    </ButtonRoot>
                </div>
            </div>
        </DialogContent>
    </DialogRoot>
</template>
