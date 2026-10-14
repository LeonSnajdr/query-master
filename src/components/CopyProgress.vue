<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogContent, DialogDescription, DialogRoot, DialogTitle } from "@vuetify/v0";
import { computed } from "vue";
import { useCopy } from "@/composables/copy";

/** Shown while a collection is copied: how far it got, and a way to stop it. */
const { running, stop } = useCopy();

// Closing (Escape) stops the copy: it must not go on unseen.
const open = computed({ get: () => running.runId !== undefined, set: value => !value && stop() });
const share = computed(() => (running.total > 0 ? Math.min(1, running.copied / running.total) : 0));
</script>

<template>
    <DialogRoot v-model="open">
        <DialogContent class="dialog w-[min(94vw,28rem)]!">
            <div
                class="flex flex-col gap-4 text-[13px]"
                data-testid="copy-progress"
            >
                <DialogTitle class="dialog-title">
                    {{ $t("copy.running.title") }}
                </DialogTitle>
                <DialogDescription class="m-0 text-on-surface break-all">
                    {{ $t("copy.running.text", { source: running.source, target: running.target }) }}
                </DialogDescription>
                <div
                    :aria-valuemax="running.total"
                    :aria-valuenow="running.copied"
                    aria-valuemin="0"
                    class="h-1.5 rounded-full bg-on-surface/15 overflow-hidden"
                    role="progressbar"
                >
                    <div
                        :style="{ width: `${share * 100}%` }"
                        class="h-full bg-primary transition-[width]"
                    />
                </div>
                <span class="text-on-surface-variant tabular-nums">
                    {{ $t("copy.running.count", { copied: running.copied.toLocaleString(), total: running.total.toLocaleString() }) }}
                </span>
                <div class="flex justify-end">
                    <ButtonRoot
                        @click="stop"
                        class="btn-secondary"
                        data-testid="copy-stop"
                    >
                        <ButtonContent>{{ $t("action.stop") }}</ButtonContent>
                    </ButtonRoot>
                </div>
            </div>
        </DialogContent>
    </DialogRoot>
</template>
