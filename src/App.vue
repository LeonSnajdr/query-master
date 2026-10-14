<script setup lang="ts">
import { ButtonRoot, SplitterHandle, SplitterPanel, SplitterRoot, TabsItem, TabsList, TabsRoot } from "@vuetify/v0";
import { computed, onMounted, shallowRef, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { inApp } from "@/api";
import AppMenuBar from "@/components/AppMenuBar.vue";
import AggregatePanel from "@/components/AggregatePanel.vue";
import AppDialogs from "@/components/AppDialogs.vue";
import NoticeBell from "@/components/NoticeBell.vue";
import NoticeStack from "@/components/NoticeStack.vue";
import StatusMessage from "@/components/StatusMessage.vue";
import BrowsePanel from "@/components/BrowsePanel.vue";
import ConnectionDock from "@/components/ConnectionDock.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import IconButton from "@/components/IconButton.vue";
import ServerPanel from "@/components/server/ServerPanel.vue";
import ShellPanel from "@/components/ShellPanel.vue";
import SqlPanel from "@/components/SqlPanel.vue";
import StartPage from "@/components/StartPage.vue";
import { useActions } from "@/composables/actions";
import { useDialogs } from "@/composables/dialogs";
import { watchAppearance } from "@/composables/appearance";
import { useFocusAreas } from "@/composables/focus";
import { useLayout } from "@/composables/layout";
import { useMessages } from "@/composables/messages";
import type { CommandId } from "@/keys/commands";
import { useShortcut } from "@/keys/keymap";
import { appWindow } from "@/files";
import type { MenuEntry } from "@/menu";
import { useConnectionsStore } from "@/stores/connections";
import { useTabsStore } from "@/stores/tabs";
import { isQueryTab } from "@/stores/tabs";
import type { ResultView, WorkTab } from "@/stores/tabs";

watchAppearance();

const { t } = useI18n();
const { report } = useMessages();
const { layout } = useLayout();
const actions = useActions();
const dialogs = useDialogs();
const connections = useConnectionsStore();
const tabs = useTabsStore();
const focus = useFocusAreas();
const dock = useTemplateRef("dock");
const tabMenu = useTemplateRef("tabMenu");

const TAB_ICONS = { start: "i-lucide-house", browse: "i-lucide-file-text", shell: "i-lucide-square-terminal", aggregate: "i-lucide-network", sql: "i-lucide-file-code-2", server: "i-lucide-activity" } as const;

const SERVER_ICONS = { status: "i-lucide-activity", log: "i-lucide-scroll-text", users: "i-lucide-users", roles: "i-lucide-shield", gridfs: "i-lucide-folder-archive" } as const;

function iconOf(tab: WorkTab): string {
    return tab.kind === "server" ? SERVER_ICONS[tab.page ?? "status"] : TAB_ICONS[tab.kind];
}

/** TabsRoot wants a value; an empty one while no tab is open. */
const activeTab = computed({
    get: () => tabs.activeId ?? "",
    set: (id: string) => (tabs.activeId = id || undefined)
});

function titleOf(tab: WorkTab): string {
    if (tab.kind === "start") return t("start.title");
    if (tab.kind === "server") return t(`server.tab.${tab.page ?? "status"}`, { name: connections.profiles.find(item => item.id === tab.connectionId)?.name ?? "", database: tab.database, bucket: tab.collection ?? "" });
    if (tab.kind === "sql") return `SQL · ${tab.database}`;
    return tab.kind === "browse" || tab.kind === "aggregate" ? tab.collection ?? "" : tab.database;
}

/** The server the status bar names: that of the active tab, else of the selected row. */
const status = computed(() => {
    const id = tabs.active?.kind !== "start" && tabs.active ? tabs.active.connectionId : connections.selected?.connectionId;
    const profile = connections.profiles.find(item => item.id === id);
    const session = id === undefined ? undefined : connections.sessions[id];
    return profile && session ? t("status.server", { name: profile.name, version: session.version }) : t("connection.none");
});
/** The field chosen in the result of the tab in front at the bottom. */
const fieldPath = computed(() => (isQueryTab(tabs.active) ? tabs.active.fieldPath : undefined));
const seconds = computed(() => ((tabs.active?.result?.milliseconds ?? 0) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 }));

function openTabMenu(event: MouseEvent, tab: WorkTab) {
    const entries: MenuEntry[] = [
        { label: t("tab.next"), command: "tab.next", action: () => tabs.step(1) },
        { label: t("tab.previous"), command: "tab.previous", action: () => tabs.step(-1) },
        "separator",
        { label: t("tab.duplicate"), command: "tab.duplicate", action: () => tabs.duplicate(tab), disabled: !isQueryTab(tab) },
        "separator",
        { label: t("tab.close.current"), command: "tab.close", action: () => tabs.close(tab.id) },
        { label: t("tab.close.others"), command: "tab.closeOthers", action: () => tabs.closeOthers(tab.id) },
        { label: t("tab.close.all"), action: () => tabs.closeAll() }
    ];
    void tabMenu.value?.open(event, entries);
}

/** The tab being dragged to another place in the row. */
const draggedId = shallowRef<string>();
/** How far the pointer moves before a press on a tab becomes a drag. */
const DRAG_DISTANCE = 4;

/** Dragging a tab sideways moves it in the row, past the middle of each tab it crosses. */
function startTabDrag(event: PointerEvent, tab: WorkTab): void {
    if (event.button !== 0) return;
    const list = (event.currentTarget as HTMLElement).parentElement!;
    const start = event.clientX;
    const move = (moved: PointerEvent) => {
        if (!draggedId.value) {
            if (Math.abs(moved.clientX - start) < DRAG_DISTANCE) return;
            draggedId.value = tab.id;
            tabs.activeId = tab.id;
        }
        const others = [...list.querySelectorAll<HTMLElement>("[data-tab-id]")].filter(item => item.dataset.tabId !== tab.id);
        const index = others.filter((item) => {
            const box = item.getBoundingClientRect();
            return box.left + box.width / 2 < moved.clientX;
        }).length;
        tabs.move(tab.id, index);
    };
    const end = () => {
        draggedId.value = undefined;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
}

function setView(view: ResultView) {
    if (isQueryTab(tabs.active)) tabs.active.view = view;
}

function withActive(action: (tab: WorkTab) => void) {
    if (tabs.active) action(tabs.active);
}

/** What the global shortcuts do; their keys come from the command list and the user's changes. */
const SHORTCUTS: Partial<Record<CommandId, () => void>> = {
    "connection.list": () => dock.value?.openList(),
    "connection.add": () => actions.newConnection(),
    "connection.uri": () => void actions.viewUri(),
    "connection.disconnect": () => void actions.disconnect(),
    "tab.browse": () => actions.browse(),
    "tab.shell": () => actions.openShell(),
    "tab.aggregation": () => actions.aggregation(),
    "tab.sql": () => actions.openSql(),
    "tab.refresh": () => withActive(tab => isQueryTab(tab) && void tabs.refresh(tab)),
    "tab.next": () => tabs.step(1),
    "tab.previous": () => tabs.step(-1),
    "tab.duplicate": () => withActive(tab => tabs.duplicate(tab)),
    "tab.close": () => withActive(tab => tabs.close(tab.id)),
    "tab.closeOthers": () => withActive(tab => tabs.closeOthers(tab.id)),
    "database.create": () => void actions.createDatabase(),
    "folder.add": () => void actions.addFolder(),
    "collection.create": () => void actions.createCollection(),
    "view.create": () => actions.createView(),
    "validator.edit": () => actions.editValidator(),
    "index.create": () => actions.createIndex(),
    "index.recreate": () => actions.recreateIndex(),
    "index.duplicate": () => actions.duplicateIndex(),
    "users.manage": () => actions.manageUsers(),
    "roles.manage": () => actions.manageRoles(),
    "export.wizard": () => void actions.exportWizard(),
    "import.wizard": () => actions.importWizard(),
    "tree.collapse": () => connections.collapseAll(),
    "settings.open": () => dialogs.openSettings(),
    "view.tree": () => setView("tree"),
    "view.table": () => setView("table"),
    "view.json": () => setView("json"),
    "help.shortcuts": () => dialogs.openHelp("shortcuts"),
    "keys.open": () => dialogs.openSettings("keys"),
    "focus.tree": () => focus.focusTree(),
    "focus.editor": () => focus.focusEditor(),
    "focus.results": () => focus.focusResults(),
    // Outside the editor; inside it its own keymap runs the statement.
    "query.run": () => withActive(tab => isQueryTab(tab) && void tabs.runTab(tab))
};
for (const [id, run] of Object.entries(SHORTCUTS) as [CommandId, () => void][]) useShortcut(id, run);

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
            <!-- As wide (about 320 of 1280 pixels): the toolbar of the dock fits. -->
            <SplitterPanel
                :defaultSize="25"
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
                :defaultSize="75"
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
                                @pointerdown="startTabDrag($event, tab)"
                                :data-dragged="tab.id === draggedId || undefined"
                                :data-selected="tab.id === tabs.activeId || undefined"
                                :data-tab-id="tab.id"
                                class="group data-[dragged]:opacity-70 data-[dragged]:cursor-grabbing h-8.5 max-w-64 shrink-0 flex items-center pl-2.5 pr-1 text-on-surface hover:text-on-surface-strong data-[selected]:bg-background data-[selected]:text-on-surface-strong"
                                data-testid="tab"
                            >
                                <TabsItem
                                    :value="tab.id"
                                    class="min-w-0 h-full inline-flex items-center gap-1.5 text-[13px] text-left"
                                >
                                    <span
                                        :class="tab.running ? 'i-lucide-loader-circle animate-spin' : iconOf(tab)"
                                        class="size-4 shrink-0"
                                    />
                                    <span class="truncate">{{ titleOf(tab) }}</span>
                                </TabsItem>
                                <ButtonRoot
                                    @click="tabs.close(tab.id)"
                                    @pointerdown.stop
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
                    <AggregatePanel
                        v-else-if="tab.kind === 'aggregate'"
                        :tabId="tab.id"
                    />
                    <SqlPanel
                        v-else-if="tab.kind === 'sql'"
                        :tabId="tab.id"
                    />
                    <ServerPanel
                        v-else-if="tab.kind === 'server'"
                        :tab
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
            <span
                v-if="fieldPath"
                class="min-w-0 flex items-center gap-1.5"
                data-testid="status-path"
            >
                <span class="i-lucide-house size-3.5 shrink-0 text-on-surface-variant" />
                <span class="text-on-surface-variant">»</span>
                <span class="truncate">{{ fieldPath }}</span>
            </span>
            <StatusMessage />
            <span class="grow" />
            <NoticeBell />
            <span class="toolbar-rule" />
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
        <NoticeStack />
    </div>
</template>
