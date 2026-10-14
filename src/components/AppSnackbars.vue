<script setup lang="ts">
import { SnackbarClose, SnackbarContent, SnackbarPortal, SnackbarQueue, SnackbarRoot } from "@vuetify/v0";

/** Toasts shown at once; the older ones wait or time out unseen. */
const VISIBLE = 3;
</script>

<template>
    <!-- App-wide toasts; send them with `useNotifications().send(...)`. Bottom left, away from the
         buttons dialogs keep on the right, and only the newest few, so a run of them stays low. -->
    <SnackbarPortal>
        <SnackbarQueue
            v-slot="{ items }"
            class="fixed bottom-10 left-4 z-50 flex flex-col gap-2 w-[min(92vw,26rem)]"
        >
            <SnackbarRoot
                v-for="item in items.slice(0, VISIBLE)"
                :id="item.id"
                :key="item.id"
                :class="item.severity === 'error' ? 'bg-error text-on-error' : 'bg-on-surface text-surface'"
                :urgent="item.severity === 'error'"
                class="flex items-center gap-3 px-4 py-2.5 rounded-lg shadow-xl text-sm"
            >
                <SnackbarContent class="grow break-words min-w-0">
                    {{ item.subject }}
                </SnackbarContent>
                <SnackbarClose class="size-7 shrink-0 inline-flex items-center justify-center rounded-md hover:bg-white/16">
                    <span class="i-lucide-x size-4" />
                </SnackbarClose>
            </SnackbarRoot>
        </SnackbarQueue>
    </SnackbarPortal>
</template>
