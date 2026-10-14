<script setup lang="ts">
import { ButtonRoot, SplitterHandle, SplitterPanel, SplitterRoot, TabsItem, TabsList, TabsRoot, useHotkey } from "@vuetify/v0";
import { computed, onMounted, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { inApp } from "@/api";
import AppDialogs from "@/components/AppDialogs.vue";
import AppMenuBar from "@/components/AppMenuBar.vue";
import AppSnackbars from "@/components/AppSnackbars.vue";
import BrowsePanel from "@/components/BrowsePanel.vue";
import ConnectionDock from "@/components/ConnectionDock.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import IconButton from "@/components/IconButton.vue";
import ShellPanel from "@/components/ShellPanel.vue";
import StartPage from "@/components/StartPage.vue";
import { useActions } from "@/composables/actions";
import { watchAppearance } from "@/composables/appearance";
import { useLayout } from "@/composables/layout";
import { useMessages } from "@/composables/messages";
import { appWindow } from "@/files";
import type { MenuEntry } from "@/menu";
import { useConnectionsStore } from "@/stores/connections";
import { useTabsStore } from "@/stores/tabs";
import type { ResultView, WorkTab } from "@/stores/tabs";

watchAppearance();

const { t } = useI18n();
const { report } = useMessages();
const { layout } = useLayout();
const actions = useActions();
const connections = useConnectionsStore();
const tabs = useTabsStore();
const dock = useTemplateRef("dock");
const tabMenu = useTemplateRef("tabMenu");

const TAB_ICONS = { start: "i-lucide-info", browse: "i-lucide-file-text", shell: "i-lucide-square-terminal" } as const;

/** TabsRoot wants a value; an empty one while no tab is open. */
const activeTab = computed({
    get: () => tabs.activeId ?? "",
    set: (id: string) => (tabs.activeId = id || undefined)
});

function titleOf(tab: WorkTab): string {
    if (tab.kind === "start") return t("start.title");
    return tab.kind === "browse" ? tab.collection ?? "" : tab.database;
}

/** The server the status bar names: that of the active tab, else of the selected row. */
const status = computed(() => {
    const id = tabs.active?.kind !== "start" && tabs.active ? tabs.active.connectionId : connections.selected?.connectionId;
    const profile = connections.profiles.find(item => item.id === id);
    const session = id === undefined ? undefined : connections.sessions[id];
    return profile && session ? t("status.server", { name: profile.name, version: session.version }) : t("connection.none");
});
const seconds = computed(() => ((tabs.active?.result?.milliseconds ?? 0) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 }));

function openTabMenu(event: MouseEvent, tab: WorkTab) {
    const entries: MenuEntry[] = [
        { label: t("tab.next"), hotkey: "Ctrl + Tab", action: () => tabs.step(1) },
        { label: t("tab.previous"), hotkey: "Ctrl + Shift + Tab", action: () => tabs.step(-1) },
        "separator",
        { label: t("tab.duplicate"), hotkey: "Ctrl + Shift + T", action: () => tabs.duplicate(tab), disabled: tab.kind === "start" },
        "separator",
        { label: t("tab.close.current"), hotkey: "Ctrl + W", action: () => tabs.close(tab.id) },
        { label: t("tab.close.others"), hotkey: "Ctrl + Shift + W", action: () => tabs.closeOthers(tab.id) },
        { label: t("tab.close.all"), action: () => tabs.closeAll() }
    ];
    void tabMenu.value?.open(event, entries);
}

function setView(view: ResultView) {
    if (tabs.active && tabs.active.kind !== "start") tabs.active.view = view;
}

function withActive(action: (tab: WorkTab) => void) {
    if (tabs.active) action(tabs.active);
}

// Also while an editor has the focus (`inputs`); F5 there belongs to the editor.
const everywhere = { inputs: true };
useHotkey("f2", () => dock.value?.openList(), everywhere);
useHotkey("ctrl+f2", () => actions.newConnection(), everywhere);
useHotkey("ctrl+q", () => actions.browse(), everywhere);
useHotkey("ctrl+t", () => actions.openShell(), everywhere);
useHotkey("ctrl+shift+q", () => actions.aggregation(), everywhere);
useHotkey("ctrl+h", () => void actions.createCollection(), everywhere);
useHotkey("ctrl+shift+h", () => actions.createView(), everywhere);
useHotkey("ctrl+alt+v", () => actions.editValidator(), everywhere);
useHotkey("ctrl+shift+d", () => void actions.createDatabase(), everywhere);
useHotkey("ctrl+i", () => actions.createIndex(), everywhere);
useHotkey("ctrl+alt+i", () => actions.recreateIndex(), everywhere);
useHotkey("ctrl+shift+i", () => actions.duplicateIndex(), everywhere);
useHotkey("ctrl+alt+d", () => void actions.disconnect(), everywhere);
useHotkey("ctrl+w", () => withActive(tab => tabs.close(tab.id)), everywhere);
useHotkey("ctrl+shift+w", () => withActive(tab => tabs.closeOthers(tab.id)), everywhere);
useHotkey("ctrl+shift+t", () => withActive(tab => tabs.duplicate(tab)), everywhere);
useHotkey("ctrl+tab", () => tabs.step(1), everywhere);
useHotkey("ctrl+shift+tab", () => tabs.step(-1), everywhere);
useHotkey("alt+1", () => setView("tree"), everywhere);
useHotkey("alt+2", () => setView("table"), everywhere);
useHotkey("alt+3", () => setView("json"), everywhere);
// Without these the web view would reload the app.
useHotkey("ctrl+r", () => withActive(tab => tab.kind !== "start" && void tabs.refresh(tab)), everywhere);
useHotkey("f5", () => withActive(tab => tab.kind !== "start" && void tabs.runTab(tab)));

onMounted(async () => {
    tabs.openStart();
    await connections.load().catch(report);
    // For work on the interface in a browser: `?demo` opens a collection of the made-up data right away.
    if (import.meta.env.DEV && !inApp && location.search.includes("dialog")) actions.newConnection();
    if (import.meta.env.DEV && !inApp && location.search.includes("demo")) {
        const [profile] = connections.profiles;
        if (!profile) return;
        await actions.connect(profile);
        await connections.loadCollections(profile.id, "shop");
        const shop = connections.sessions[profile.id]?.databases.find(database => database.name === "shop");
        if (shop) shop.open = true;
        actions.browse({ connectionId: profile.id, database: "shop", collection: "orders" });
        if (tabs.active && location.search.includes("table")) tabs.active.view = "table";
        if (location.search.includes("shell")) actions.openShell({ connectionId: profile.id, database: "shop", collection: "orders" });
    }
});
</script>

<template>
    <div class="h-full overflow-hidden flex flex-col bg-background text-on-surface text-[13px]">
        <SplitterRoot
            class="grow min-h-0"
            orientation="horizontal"
        >
            <SplitterPanel
                :defaultSize="20"
                :maxSize="50"
                :minSize="12"
                class="min-w-0 flex flex-col bg-dock"
            >
                <div
                    class="h-10.5 shrink-0 flex items-center gap-2 pl-3.5"
                    data-tauri-drag-region
                >
                    <span
                        :title="'QueryMaster'"
                        class="size-6 shrink-0 inline-flex items-center justify-center rounded-full bg-on-surface/15 text-on-surface-strong"
                    >
                        <span class="i-lucide-search-code size-3.5" />
                    </span>
                    <AppMenuBar @connections="dock?.openList()" />
                </div>
                <ConnectionDock
                    ref="dock"
                    class="grow"
                />
            </SplitterPanel>
            <SplitterHandle
                :label="$t('layout.resize')"
                class="relative z-10 w-1.5 -mx-[3px] shrink-0 flex items-center justify-center cursor-col-resize text-on-surface-variant hover:bg-primary/25"
            >
                <span class="i-lucide-ellipsis-vertical size-3.5" />
            </SplitterHandle>
            <SplitterPanel
                :defaultSize="80"
                class="min-w-0 flex flex-col"
            >
                <div
                    class="h-10.5 shrink-0 flex items-end bg-dock select-none"
                    data-tauri-drag-region
                >
                    <TabsRoot
                        v-if="tabs.tabs.length > 0"
                        v-model="activeTab"
                        mandatory
                    >
                        <TabsList
                            :label="$t('tab.list')"
                            class="min-w-0 flex items-end overflow-x-auto [scrollbar-width:none]"
                        >
                            <div
                                v-for="tab in tabs.tabs"
                                :key="tab.id"
                                @auxclick.middle="tabs.close(tab.id)"
                                @contextmenu="openTabMenu($event, tab)"
                                :data-selected="tab.id === tabs.activeId || undefined"
                                class="group h-8.5 max-w-64 shrink-0 flex items-center pl-2.5 pr-1 text-on-surface hover:text-on-surface-strong data-[selected]:bg-background data-[selected]:text-on-surface-strong"
                                data-testid="tab"
                            >
                                <TabsItem
                                    :value="tab.id"
                                    class="min-w-0 h-full inline-flex items-center gap-1.5 text-[13px] text-left"
                                >
                                    <span
                                        :class="tab.running ? 'i-lucide-loader-circle animate-spin' : TAB_ICONS[tab.kind]"
                                        class="size-4 shrink-0"
                                    />
                                    <span class="truncate">{{ titleOf(tab) }}</span>
                                </TabsItem>
                                <ButtonRoot
                                    @click="tabs.close(tab.id)"
                                    :ariaLabel="$t('tab.close', { name: titleOf(tab) })"
                                    :title="$t('tab.close', { name: titleOf(tab) })"
                                    class="size-5 ml-1 shrink-0 inline-flex items-center justify-center rounded-sm hover:bg-on-surface/15"
                                    data-testid="tab-close"
                                >
                                    <span class="i-lucide-x size-3 block" />
                                </ButtonRoot>
                            </div>
                        </TabsList>
                    </TabsRoot>
                    <span
                        class="grow self-stretch"
                        data-tauri-drag-region
                    />
                    <div class="self-start flex">
                        <ButtonRoot
                            @click="appWindow.minimize()"
                            :ariaLabel="$t('window.minimize')"
                            class="w-11.5 h-9 inline-flex items-center justify-center text-on-surface-strong hover:bg-on-surface/10"
                        >
                            <span class="i-lucide-minus size-4" />
                        </ButtonRoot>
                        <ButtonRoot
                            @click="appWindow.toggleMaximize()"
                            :ariaLabel="$t('window.maximize')"
                            class="w-11.5 h-9 inline-flex items-center justify-center text-on-surface-strong hover:bg-on-surface/10"
                        >
                            <span class="i-lucide-square size-3" />
                        </ButtonRoot>
                        <ButtonRoot
                            @click="appWindow.close()"
                            :ariaLabel="$t('window.close')"
                            class="w-11.5 h-9 inline-flex items-center justify-center text-on-surface-strong hover:bg-error hover:text-white"
                        >
                            <span class="i-lucide-x size-4" />
                        </ButtonRoot>
                    </div>
                </div>

                <!-- Every open tab keeps its editors (history, cursor) while another one shows. -->
                <div
                    v-for="tab in tabs.tabs"
                    v-show="tab.id === tabs.activeId"
                    :key="tab.id"
                    class="grow min-h-0"
                    data-testid="tab-panel"
                >
                    <StartPage v-if="tab.kind === 'start'" />
                    <BrowsePanel
                        v-else-if="tab.kind === 'browse'"
                        :tabId="tab.id"
                    />
                    <ShellPanel
                        v-else
                        :tabId="tab.id"
                    />
                </div>
            </SplitterPanel>
        </SplitterRoot>

        <footer class="h-7 shrink-0 flex items-center gap-3 px-4.5 bg-dock border-t border-divider text-on-surface select-none">
            <span
                class="italic truncate"
                data-testid="status-server"
            >{{ status }}</span>
            <span class="grow" />
            <span
                class="tabular-nums text-on-surface-variant"
                data-testid="status-time"
            >{{ $t("status.seconds", { seconds }) }}</span>
            <span class="toolbar-rule" />
            <IconButton
                @click="layout = 'default'"
                :active="layout === 'default'"
                :label="$t('layout.default')"
                icon="i-lucide-rows-2"
            />
            <IconButton
                @click="layout = 'results'"
                :active="layout === 'results'"
                :label="$t('layout.results')"
                icon="i-lucide-panel-top-close"
            />
            <IconButton
                @click="layout = 'editor'"
                :active="layout === 'editor'"
                :label="$t('layout.editor')"
                icon="i-lucide-panel-bottom-close"
            />
        </footer>

        <ContextMenu ref="tabMenu" />
        <AppDialogs />
        <AppSnackbars />
    </div>
</template>
