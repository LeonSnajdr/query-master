<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import DropMenu from "@/components/DropMenu.vue";
import type { MenuEntry } from "@/menu";
import { useTabsStore } from "@/stores/tabs";

const emit = defineEmits<{
    /** A statement of the history was chosen. */
    choose: [statement: string];
}>();

/** The statements that ran, newest first, as a menu behind the clock button. */
const { t } = useI18n();
const tabs = useTabsStore();

const entries = computed<MenuEntry[]>(() => {
    if (tabs.history.length === 0) return [{ label: t("history.empty"), action: () => undefined, disabled: true }];
    return tabs.history.slice(0, 25).map(statement => ({
        label: statement.replace(/\s+/g, " ").slice(0, 90),
        action: () => emit("choose", statement)
    }));
});
</script>

<template>
    <DropMenu
        :entries
        :label="$t('history.title')"
    >
        <span
            class="h-6.5 min-w-6 px-1 inline-flex items-center justify-center rounded-sm text-on-surface hover:text-on-surface-strong hover:bg-on-surface/10"
            data-testid="history"
        >
            <span class="i-lucide-history size-4" />
        </span>
    </DropMenu>
</template>
