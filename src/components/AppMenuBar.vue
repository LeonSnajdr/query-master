<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { LOCALES } from "../../i18n/i18n.config";
import DropMenu from "@/components/DropMenu.vue";
import { useActions } from "@/composables/actions";
import { useAppearance } from "@/composables/appearance";
import { appWindow } from "@/files";
import type { MenuEntry } from "@/menu";
import { THEMES } from "@/plugins/vuetify";
import { useTabsStore } from "@/stores/tabs";
import type { ResultView } from "@/stores/tabs";

const emit = defineEmits<{
    /** "Open connections list" was chosen. */
    connections: [];
}>();

/** The menus at the top left: File, Edit, View, Help. */
const { t } = useI18n();
const actions = useActions();
const tabs = useTabsStore();
const { theme, language, setTheme, setLanguage } = useAppearance();

const hasTab = computed(() => tabs.active !== undefined);
const hasQueryTab = computed(() => tabs.active !== undefined && tabs.active.kind !== "start");

function view(name: ResultView, hotkey: string): MenuEntry {
    return {
        label: t(`view.${name}.long`),
        hotkey,
        checked: tabs.active?.view === name && hasQueryTab.value,
        disabled: !hasQueryTab.value,
        action: () => tabs.active && (tabs.active.view = name)
    };
}

const menus = computed<{ name: string; entries: MenuEntry[] }[]>(() => [
    {
        name: t("menu.file"),
        entries: [
            { label: t("connection.list.hint"), hotkey: "F2", action: () => emit("connections") },
            { label: t("connection.add"), icon: "i-lucide-plus", hotkey: "Ctrl + F2", action: () => actions.newConnection() },
            "separator",
            { label: t("tab.browse"), icon: "i-lucide-file-text", hotkey: "Ctrl + Q", action: () => actions.browse(), disabled: !actions.hasCollection.value },
            { label: t("tab.shell"), icon: "i-lucide-square-terminal", hotkey: "Ctrl + T", action: () => actions.openShell(), disabled: !actions.hasConnection.value },
            { label: t("tab.aggregation"), icon: "i-lucide-network", hotkey: "Ctrl + Shift + Q", action: () => actions.aggregation(), disabled: !actions.hasCollection.value },
            "separator",
            { label: t("connection.disconnect"), hotkey: "Ctrl + Alt + D", action: () => void actions.disconnect(), disabled: !actions.hasConnection.value },
            "separator",
            { label: t("menu.exit"), hotkey: "Alt + F4", action: () => void appWindow.close() }
        ]
    },
    {
        name: t("menu.edit"),
        entries: [
            { label: t("database.create"), hotkey: "Ctrl + Shift + D", action: () => void actions.createDatabase(), disabled: !actions.hasConnection.value },
            "separator",
            { label: t("collection.create"), icon: "i-lucide-file-plus-2", hotkey: "Ctrl + H", action: () => void actions.createCollection(), disabled: !actions.hasDatabase.value },
            { label: t("view.create"), icon: "i-lucide-file-search", hotkey: "Ctrl + Shift + H", action: () => actions.createView(), disabled: !actions.hasDatabase.value },
            { label: t("collection.rename"), action: () => void actions.renameCollection(), disabled: !actions.hasCollection.value },
            { label: t("validator.edit"), hotkey: "Ctrl + Alt + V", action: () => actions.editValidator(), disabled: !actions.hasCollection.value },
            { label: t("collection.drop"), icon: "i-lucide-file-x-2", danger: true, action: () => void actions.dropCollection(), disabled: !actions.hasCollection.value },
            "separator",
            { label: t("index.create"), icon: "i-lucide-key-round", hotkey: "Ctrl + I", action: () => actions.createIndex(), disabled: !actions.hasCollection.value }
        ]
    },
    {
        name: t("menu.view"),
        entries: [
            view("tree", "Alt + 1"),
            view("table", "Alt + 2"),
            view("json", "Alt + 3"),
            "separator",
            { label: t("tab.next"), hotkey: "Ctrl + Tab", action: () => tabs.step(1), disabled: !hasTab.value },
            { label: t("tab.previous"), hotkey: "Ctrl + Shift + Tab", action: () => tabs.step(-1), disabled: !hasTab.value },
            { label: t("tab.duplicate"), hotkey: "Ctrl + Shift + T", action: () => tabs.active && tabs.duplicate(tabs.active), disabled: !hasQueryTab.value },
            { label: t("tab.close.current"), hotkey: "Ctrl + W", action: () => tabs.active && tabs.close(tabs.active.id), disabled: !hasTab.value },
            { label: t("tab.close.others"), hotkey: "Ctrl + Shift + W", action: () => tabs.active && tabs.closeOthers(tabs.active.id), disabled: !hasTab.value },
            "separator",
            ...THEMES.map((name): MenuEntry => ({ label: t("theme.label", { name: t(`theme.${name}`) }), checked: theme.value === name, action: () => setTheme(name) })),
            "separator",
            ...LOCALES.map((name): MenuEntry => ({ label: t("language.label", { name: t(`language.${name}`) }), checked: language.value === name, action: () => setLanguage(name) }))
        ]
    },
    {
        name: t("menu.help"),
        entries: [
            { label: t("start.title"), icon: "i-lucide-info", action: () => tabs.openStart() }
        ]
    }
]);
</script>

<template>
    <nav
        :aria-label="$t('menu.label')"
        class="flex items-center"
    >
        <DropMenu
            v-for="menu in menus"
            :key="menu.name"
            :entries="menu.entries"
            :label="menu.name"
        >
            <span
                :data-testid="`menu-${menu.name}`"
                class="h-6.5 px-2 inline-flex items-center rounded-sm text-[13px] text-on-surface hover:text-on-surface-strong hover:bg-on-surface/10"
            >{{ menu.name }}</span>
        </DropMenu>
    </nav>
</template>
