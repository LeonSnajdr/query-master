<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import IconButton from "@/components/IconButton.vue";
import { notePathLabel, useNotesStore } from "@/stores/notes";
import { useTabsStore } from "@/stores/tabs";

/**
 * The lock of a tab. A row of the tree marked read-only locks it, and it can not be opened here;
 * its label says which row. A row marked writable leaves the lock to the tab.
 */
const props = defineProps<{
    tabId: string;
}>();

const { t } = useI18n();
const tabs = useTabsStore();
const notes = useNotesStore();
// The store's own object: the lock is changed here.
const tab = computed(() => tabs.tabs.find(item => item.id === props.tabId)!);
const byTree = computed(() => tabs.lockedByTree(tab.value));
const locked = computed(() => tab.value.readonly || byTree.value);
const label = computed(() => {
    const { connectionId, database, collection } = tab.value;
    const source = notes.readonlySource({ connectionId, database, collection });
    if (source.from === undefined) return t("query.readonly");
    const name = notePathLabel(source.from);
    if (!source.readonly) return t("query.readonly.writable", { name: name ?? "" });
    return name === undefined ? t("query.readonly.tree.connection") : t("query.readonly.tree", { name });
});
</script>

<template>
    <IconButton
        @click="tab.readonly = !tab.readonly"
        :active="locked"
        :disabled="byTree"
        :icon="locked ? 'i-lucide-lock' : 'i-lucide-lock-open'"
        :label
        data-testid="query-readonly"
    />
</template>
