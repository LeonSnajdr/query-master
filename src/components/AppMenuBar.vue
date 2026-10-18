<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { LOCALES } from "../../i18n/i18n.config";
import DropMenu from "@/components/DropMenu.vue";
import { useActions } from "@/composables/actions";
import { useDialogs } from "@/composables/dialogs";
import { useAppearance } from "@/composables/appearance";
import { useFocusAreas } from "@/composables/focus";
import { appWindow } from "@/files";
import type { MenuEntry } from "@/menu";
import { THEMES } from "@/plugins/vuetify";
import { isQueryTab, useTabsStore } from "@/stores/tabs";
import type { ResultView } from "@/stores/tabs";

const emit = defineEmits<{
    /** "Open connections list" was chosen. */
    connections: [];
    /** "Search everything" was chosen. */
    palette: [];
}>();

/** The menus at the top left: File, Edit, View, Help. */
const { t } = useI18n();
const actions = useActions();
const dialogs = useDialogs();
const tabs = useTabsStore();
const { theme, language, setTheme, setLanguage } = useAppearance();
const focus = useFocusAreas();

const hasTab = computed(() => tabs.active !== undefined);
const hasQueryTab = computed(() => isQueryTab(tabs.active));

function view(name: ResultView): MenuEntry {
    return {
        label: t(`view.${name}.long`),
        command: `view.${name}`,
        checked: tabs.active?.view === name && hasQueryTab.value,
        disabled: !hasQueryTab.value,
        action: () => isQueryTab(tabs.active) && (tabs.active.view = name)
    };
}

const menus = computed<{ name: string; entries: MenuEntry[] }[]>(() => [
    {
        name: t("menu.file"),
        entries: [
            { label: t("connection.list.hint"), command: "connection.list", action: () => emit("connections") },
            { label: t("connection.add"), icon: "i-lucide-plus", command: "connection.add", action: () => actions.newConnection() },
            "separator",
            { label: t("tab.browse"), icon: "i-lucide-file-text", command: "tab.browse", action: () => actions.browse(), disabled: !actions.hasCollection.value },
            { label: t("tab.shell"), icon: "i-lucide-square-terminal", command: "tab.shell", action: () => actions.openShell(), disabled: !actions.hasConnection.value },
            { label: t("tab.aggregation"), icon: "i-lucide-network", command: "tab.aggregation", action: () => actions.aggregation(), disabled: !actions.hasCollection.value },
            { label: t("tab.sql"), icon: "i-lucide-file-code-2", command: "tab.sql", action: () => actions.openSql(), disabled: !actions.hasConnection.value },
            "separator",
            { label: t("export.menu"), icon: "i-lucide-upload", command: "export.wizard", action: () => void actions.exportWizard(), disabled: !actions.hasConnection.value },
            { label: t("import.menu"), icon: "i-lucide-download", command: "import.wizard", action: () => actions.importWizard(), disabled: actions.onView.value },
            "separator",
            { label: t("connection.disconnect"), command: "connection.disconnect", action: () => void actions.disconnect(), disabled: !actions.hasConnection.value },
            "separator",
            { label: t("menu.exit"), hotkey: "Alt + F4", action: () => void appWindow.close() }
        ]
    },
    {
        name: t("menu.edit"),
        entries: [
            { label: t("database.create"), command: "database.create", action: () => void actions.createDatabase(), disabled: !actions.hasConnection.value },
            { label: t("folder.add"), icon: "i-lucide-folder-plus", command: "folder.add", action: () => void actions.addFolder(), disabled: !actions.hasConnection.value },
            "separator",
            { label: t("collection.create"), icon: "i-lucide-file-plus-2", command: "collection.create", action: () => void actions.createCollection(), disabled: !actions.hasDatabase.value },
            { label: t("view.create"), icon: "i-lucide-file-search", command: "view.create", action: () => actions.createView(), disabled: !actions.hasDatabase.value },
            { label: t("gridfs.create"), icon: "i-lucide-folder-archive", action: () => void actions.createBucket(), disabled: !actions.hasDatabase.value },
            { label: t("collection.rename"), action: () => void actions.renameCollection(), disabled: !actions.hasCollection.value },
            { label: t("validator.edit"), command: "validator.edit", action: () => actions.editValidator(), disabled: !actions.hasCollection.value || actions.onView.value },
            { label: t("collection.drop"), icon: "i-lucide-file-x-2", danger: true, action: () => void actions.dropCollection(), disabled: !actions.hasCollection.value },
            "separator",
            { label: t("index.create"), icon: "i-lucide-key-round", command: "index.create", action: () => actions.createIndex(), disabled: !actions.hasCollection.value || actions.onView.value },
            "separator",
            { label: t("users.manage"), icon: "i-lucide-users", command: "users.manage", action: () => actions.manageUsers(), disabled: !actions.hasConnection.value },
            { label: t("roles.manage"), icon: "i-lucide-shield", command: "roles.manage", action: () => actions.manageRoles(), disabled: !actions.hasConnection.value },
            "separator",
            { label: t("settings.open"), icon: "i-lucide-settings", command: "settings.open", action: () => dialogs.openSettings() }
        ]
    },
    {
        name: t("menu.view"),
        entries: [
            { label: t("focus.tree"), command: "focus.tree", action: () => focus.focusTree() },
            { label: t("focus.editor"), command: "focus.editor", action: () => focus.focusEditor(), disabled: !hasQueryTab.value },
            { label: t("focus.results"), command: "focus.results", action: () => focus.focusResults(), disabled: !hasQueryTab.value },
            "separator",
            view("tree"),
            view("table"),
            view("json"),
            "separator",
            { label: t("tab.next"), command: "tab.next", action: () => tabs.step(1), disabled: !hasTab.value },
            { label: t("tab.previous"), command: "tab.previous", action: () => tabs.step(-1), disabled: !hasTab.value },
            { label: t("tab.duplicate"), command: "tab.duplicate", action: () => tabs.active && tabs.duplicate(tabs.active), disabled: !hasQueryTab.value },
            { label: t("tab.close.current"), command: "tab.close", action: () => tabs.active && tabs.close(tabs.active.id), disabled: !hasTab.value },
            { label: t("tab.close.others"), command: "tab.closeOthers", action: () => tabs.active && tabs.closeOthers(tabs.active.id), disabled: !hasTab.value },
            "separator",
            ...THEMES.map((name): MenuEntry => ({ label: t("theme.label", { name: t(`theme.${name}`) }), checked: theme.value === name, action: () => setTheme(name) })),
            "separator",
            ...LOCALES.map((name): MenuEntry => ({ label: t("language.label", { name: t(`language.${name}`) }), checked: language.value === name, action: () => setLanguage(name) }))
        ]
    },
    {
        name: t("menu.help"),
        entries: [
            { label: t("palette.open"), icon: "i-lucide-search", command: "palette.open", action: () => emit("palette") },
            { label: t("help.shortcuts"), icon: "i-lucide-keyboard", command: "help.shortcuts", action: () => dialogs.openHelp("shortcuts") },
            { label: t("start.title"), icon: "i-lucide-house", action: () => tabs.openStart() },
            "separator",
            { label: t("help.about"), icon: "i-lucide-info", action: () => dialogs.openHelp("about") }
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
