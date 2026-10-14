<script setup lang="ts">
import { useTimer } from "@vuetify/v0";
import { shallowRef, watch } from "vue";
import { useNotices } from "@/composables/notices";

/** The answer to what was just clicked ("Copied", "3 documents"), in the status bar for a moment. */
const notices = useNotices();
const visible = shallowRef(false);
const timer = useTimer(() => (visible.value = false), { duration: 4000 });

watch(() => notices.state.status?.id, (id) => {
    if (id === undefined) return;
    visible.value = true;
    timer.start();
});
</script>

<template>
    <span
        v-if="notices.state.status"
        :class="visible ? 'opacity-100' : 'opacity-0'"
        aria-live="polite"
        class="min-w-0 flex items-center gap-1.5 transition-opacity duration-300"
        data-testid="status-message"
    >
        <span
            :class="notices.state.status.kind === 'success' ? 'i-lucide-circle-check text-success' : 'i-lucide-info text-primary'"
            class="size-3.5 shrink-0"
        />
        <span class="truncate">{{ notices.state.status.text }}</span>
    </span>
</template>
