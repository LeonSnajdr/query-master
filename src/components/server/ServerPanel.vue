<script setup lang="ts">
import RolesPanel from "@/components/server/RolesPanel.vue";
import ServerLog from "@/components/server/ServerLog.vue";
import ServerStatus from "@/components/server/ServerStatus.vue";
import UsersPanel from "@/components/server/UsersPanel.vue";
import type { WorkTab } from "@/stores/tabs";

/** A tab about a server (its status, its log) or about the users or roles of a database. */
defineProps<{
    tab: WorkTab;
}>();
</script>

<template>
    <ServerLog
        v-if="tab.page === 'log'"
        :tab
    />
    <UsersPanel
        v-else-if="tab.page === 'users'"
        :tab
    />
    <RolesPanel
        v-else-if="tab.page === 'roles'"
        :tab
    />
    <ServerStatus
        v-else
        :tab
    />
</template>
