<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { SavedQuery } from "@/api";
import DropMenu from "@/components/DropMenu.vue";
import { useMessages } from "@/composables/messages";
import type { MenuEntry } from "@/menu";
import { scopeOf, useQueriesStore } from "@/stores/queries";
import { useTabsStore } from "@/stores/tabs";

const emit = defineEmits<{
    /** A statement of the history was chosen. */
    choose: [statement: string];
}>();
/**
 * The clock button: the queries saved for where the tab is, then the statements that ran on the
 * connection, newest first; a field on top filters both (stage 20).
 */
const props = defineProps<{
    connectionId: string;
    /** The tab the menu belongs to: its saved queries come first, and a chosen one runs in it. */
    tabId?: string;
}>();

/** Statements the menu shows; the database keeps more. */
const SHOWN = 25;

const { t, locale } = useI18n();
const { report } = useMessages();
const tabs = useTabsStore();
const queries = useQueriesStore();

const tab = computed(() => tabs.tabs.find(item => item.id === props.tabId));

/** A saved query as a line: its folder before the name, when it last ran on the right. */
function savedEntry(query: SavedQuery): MenuEntry {
    return {
        label: query.folder ? `${query.folder} › ${query.name}` : query.name,
        icon: "i-lucide-star",
        hotkey: query.dateUsed ? new Date(query.dateUsed).toLocaleDateString(locale.value) : undefined,
        action: () => {
            // In this tab when it is of the same kind; else in a tab of its own.
            if (tab.value && tab.value.kind === query.kind && scopeOf(query, tab.value)) queries.apply(tab.value, query);
            else queries.open(query);
        }
    };
}

const entries = computed<MenuEntry[]>(() => {
    const saved = queries.of(props.connectionId);
    const here = tab.value ? saved.filter(query => query.kind === tab.value!.kind && scopeOf(query, tab.value!)) : [];
    const elsewhere = saved.filter(query => !here.includes(query));
    const statements = tabs.historyOf(props.connectionId);
    const result: MenuEntry[] = [];
    if (here.length > 0) result.push(...here.map(savedEntry));
    if (elsewhere.length > 0) result.push({ label: t("savedQuery.all", { count: elsewhere.length }), icon: "i-lucide-stars", children: elsewhere.map(savedEntry) });
    if (result.length > 0) result.push("separator");
    if (statements.length === 0) {
        result.push({ label: t("history.empty"), action: () => undefined, disabled: true });
        return result;
    }
    result.push(
        ...statements.slice(0, SHOWN).map((statement): MenuEntry => ({
            label: statement.replace(/\s+/g, " ").slice(0, 90),
            icon: "i-lucide-history",
            action: () => emit("choose", statement)
        })),
        "separator",
        { label: t("history.clear"), icon: "i-lucide-trash-2", action: () => void tabs.clearHistory(props.connectionId).catch(report) }
    );
    return result;
});
</script>

<template>
    <DropMenu
        :entries
        :filterAbove="8"
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
