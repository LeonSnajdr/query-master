<script setup lang="ts">
import ServerLog from "@/components/server/ServerLog.vue";
import ServerStatus from "@/components/server/ServerStatus.vue";
import type { WorkTab } from "@/stores/tabs";

/** A tab about a server: its status or its log. */
defineProps<{
    tab: WorkTab;
}>();
</script>

<template>
    <ServerLog
        v-if="tab.page === 'log'"
        :tab
    />
    <ServerStatus
        v-else
        :tab
    />
</template>
