<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import DropMenu from "@/components/DropMenu.vue";
import { useMessages } from "@/composables/messages";
import type { MenuEntry } from "@/menu";
import { useTabsStore } from "@/stores/tabs";

const emit = defineEmits<{
    /** A statement of the history was chosen. */
    choose: [statement: string];
}>();
/** The statements that ran on a connection, newest first, as a menu behind the clock button. */
const props = defineProps<{
    connectionId: string;
}>();

/** Statements the menu shows; the database keeps more. */
const SHOWN = 25;

const { t } = useI18n();
const { report } = useMessages();
const tabs = useTabsStore();

const entries = computed<MenuEntry[]>(() => {
    const statements = tabs.historyOf(props.connectionId);
    if (statements.length === 0) return [{ label: t("history.empty"), action: () => undefined, disabled: true }];
    return [
        ...statements.slice(0, SHOWN).map((statement): MenuEntry => ({
            label: statement.replace(/\s+/g, " ").slice(0, 90),
            action: () => emit("choose", statement)
        })),
        "separator",
        { label: t("history.clear"), icon: "i-lucide-trash-2", action: () => void tabs.clearHistory(props.connectionId).catch(report) }
    ];
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
