<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import IconButton from "@/components/IconButton.vue";
import { useDialogs } from "@/composables/dialogs";
import { useKeymap } from "@/keys/keymap";
import { useQueriesStore } from "@/stores/queries";
import { useTabsStore } from "@/stores/tabs";

/** The star beside the history: empty while the query of the tab is not saved, filled when it is. */
const props = defineProps<{
    tabId: string;
}>();

const { t } = useI18n();
const dialogs = useDialogs();
const keymap = useKeymap();
const queries = useQueriesStore();
const tabs = useTabsStore();

const tab = computed(() => tabs.tabs.find(item => item.id === props.tabId));
const saved = computed(() => (tab.value ? queries.savedFor(tab.value) : undefined));
</script>

<template>
    <IconButton
        @click="dialogs.saveQuery(tabId)"
        :active="saved !== undefined"
        :label="keymap.titled(saved ? t('savedQuery.edit', { name: saved.name }) : t('savedQuery.title'), 'query.save')"
        :tint="saved ? 'text-warning' : undefined"
        data-testid="save-query-star"
        icon="i-lucide-star"
    />
</template>
