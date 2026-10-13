<script setup lang="ts">
import { SnackbarClose, SnackbarContent, SnackbarPortal, SnackbarQueue, SnackbarRoot } from "@vuetify/v0";
</script>

<template>
    <!-- App-wide toasts; send them with `useNotifications().send(...)`. -->
    <SnackbarPortal>
        <SnackbarQueue
            v-slot="{ items }"
            class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-[min(92vw,30rem)]"
        >
            <SnackbarRoot
                v-for="item in items"
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
