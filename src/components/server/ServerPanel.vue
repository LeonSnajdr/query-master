<script setup lang="ts">
import GridFsPanel from "@/components/server/GridFsPanel.vue";
import RolesPanel from "@/components/server/RolesPanel.vue";
import ServerLog from "@/components/server/ServerLog.vue";
import ReplicaSetPanel from "@/components/server/ReplicaSetPanel.vue";
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
    <GridFsPanel
        v-else-if="tab.page === 'gridfs'"
        :tab
    />
    <ReplicaSetPanel
        v-else-if="tab.page === 'replicaSet'"
        :tab
    />
    <ServerStatus
        v-else
        :tab
    />
</template>
