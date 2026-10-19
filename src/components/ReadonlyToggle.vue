<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import IconButton from "@/components/IconButton.vue";
import { useTabsStore } from "@/stores/tabs";

/** The lock of a tab. A row of the tree marked read-only locks it, and it can not be opened here. */
const props = defineProps<{
    tabId: string;
}>();

const { t } = useI18n();
const tabs = useTabsStore();
// The store's own object: the lock is changed here.
const tab = computed(() => tabs.tabs.find(item => item.id === props.tabId)!);
const byTree = computed(() => tabs.lockedByTree(tab.value));
const locked = computed(() => tab.value.readonly || byTree.value);
</script>

<template>
    <IconButton
        @click="tab.readonly = !tab.readonly"
        :active="locked"
        :disabled="byTree"
        :icon="locked ? 'i-app-lock' : 'i-lucide-lock-open'"
        :label="byTree ? t('query.readonly.tree') : t('query.readonly')"
        data-testid="query-readonly"
    />
</template>
