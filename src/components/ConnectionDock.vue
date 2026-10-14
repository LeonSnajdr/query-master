<script setup lang="ts">
import { ButtonContent, ButtonRoot, PopoverActivator, PopoverContent, PopoverRoot } from "@vuetify/v0";
import { computed, shallowRef, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import type { Profile } from "@/api";
import ContextMenu from "@/components/ContextMenu.vue";
import DropMenu from "@/components/DropMenu.vue";
import IconButton from "@/components/IconButton.vue";
import NoteMarks from "@/components/NoteMarks.vue";
import { useActions } from "@/composables/actions";
import { useCopy } from "@/composables/copy";
import { useDialogs } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";
import type { MenuEntry } from "@/menu";
import { useConnectionsStore } from "@/stores/connections";
import type { DatabaseNode, TreeSelection } from "@/stores/connections";
import { NOTE_COLORS, useNotesStore } from "@/stores/notes";
import type { NotePlace } from "@/stores/notes";

/** The dock at the left: saved connections, the toolbar, and the tree of what is connected. */
const { t } = useI18n();
const { report } = useMessages();
const dialogs = useDialogs();
const actions = useActions();
const copying = useCopy();
const connections = useConnectionsStore();
const notes = useNotesStore();
const menu = useTemplateRef("menu");

/** The icon of a row takes the color noted for it. */
function tint(place: NotePlace): string {
    const color = notes.noteOf(place)?.color;
    return color ? `note-fg-${color}` : "text-on-surface";
}

/** Color, comment and read-only of a row, for its context menu. */
function noteEntries(at: TreeSelection): MenuEntry[] {
    const place = { connectionId: at.connectionId, database: at.database, collection: at.collection };
    const note = notes.noteOf(place);
    const entries: MenuEntry[] = [
        "separator",
        { label: t("note.color"), swatches: NOTE_COLORS, current: note?.color ?? null, choose: color => void actions.setColor(at, color) },
        { label: t(note?.comment ? "note.comment.edit" : "note.comment.add"), icon: "i-lucide-message-square-text", action: () => void actions.editComment(at) }
    ];
    if (note?.comment) entries.push({ label: t("note.comment.remove"), action: () => void actions.removeComment(at) });
    entries.push({ label: t("note.readonly"), icon: "i-lucide-lock", checked: note?.readonly === true, action: () => void actions.toggleReadonly(at) });
    return entries;
}

const listOpen = shallowRef(false);
const searching = shallowRef(false);
const search = shallowRef("");
const connected = computed(() => connections.profiles.filter(profile => connections.sessions[profile.id]));

function matches(name: string): boolean {
    return !search.value.trim() || name.toLowerCase().includes(search.value.trim().toLowerCase());
}

/** Databases that match the search, or have a collection that does. */
function shownDatabases(profile: Profile): DatabaseNode[] {
    return (connections.sessions[profile.id]?.databases ?? []).filter(database => matches(database.name) || (database.collections ?? []).some(matches));
}

function shownCollections(database: DatabaseNode): string[] {
    const all = database.collections ?? [];
    return matches(database.name) ? all : all.filter(matches);
}

function isSelected(at: TreeSelection): boolean {
    const selected = connections.selected;
    return selected?.connectionId === at.connectionId && selected.database === at.database && selected.collection === at.collection && selected.index === at.index;
}

function select(at: TreeSelection) {
    connections.selected = at;
}

function toggleConnection(profile: Profile) {
    const session = connections.sessions[profile.id];
    if (session) session.open = !session.open;
}

async function toggleDatabase(profile: Profile, database: DatabaseNode) {
    database.open = !database.open;
    if (database.open && !database.collections) await connections.loadCollections(profile.id, database.name).catch(report);
}

async function toggleCollection(profile: Profile, database: DatabaseNode, collection: string) {
    const detail = database.details[collection] ??= { open: false, loading: false };
    detail.open = !detail.open;
    if (detail.open && !detail.indexes) await connections.loadIndexes(profile.id, database.name, collection).catch(report);
}

async function choose(profile: Profile) {
    listOpen.value = false;
    await actions.connect(profile);
}

const createEntries = computed<MenuEntry[]>(() => [
    { label: t("database.create"), hotkey: "Ctrl + Shift + D", action: () => void actions.createDatabase(), disabled: !actions.hasConnection.value },
    { label: t("collection.create"), icon: "i-lucide-file-plus-2", hotkey: "Ctrl + H", action: () => void actions.createCollection(), disabled: !actions.hasDatabase.value },
    { label: t("index.create"), icon: "i-lucide-key-round", hotkey: "Ctrl + I", action: () => actions.createIndex(), disabled: !actions.hasCollection.value }
]);

const manageEntries = computed<MenuEntry[]>(() => [
    { label: t("index.list"), icon: "i-lucide-key-round", action: () => actions.indexes(), disabled: !actions.hasCollection.value },
    { label: t("collection.stats"), action: () => actions.collectionStats(), disabled: !actions.hasCollection.value },
    { label: t("database.stats"), action: () => actions.databaseStats(), disabled: !actions.hasDatabase.value },
    { label: t("database.collectionsStats"), action: () => actions.collectionsStats(), disabled: !actions.hasDatabase.value },
    { label: t("connection.status"), icon: "i-lucide-activity", action: () => actions.serverStatus(), disabled: !actions.hasConnection.value },
    { label: t("connection.log"), icon: "i-lucide-scroll-text", action: () => actions.serverLog(), disabled: !actions.hasConnection.value },
    "separator",
    { label: t("users.manage"), icon: "i-lucide-users", hotkey: "Ctrl + Alt + U", action: () => actions.manageUsers(), disabled: !actions.hasConnection.value },
    { label: t("roles.manage"), icon: "i-lucide-shield", hotkey: "Ctrl + Alt + R", action: () => actions.manageRoles(), disabled: !actions.hasConnection.value }
]);

/** Keys on a focused row act on the selected one: Del drops, Ctrl+C copies, Ctrl+V pastes. */
function onTreeKey(event: KeyboardEvent) {
    const at = connections.selected;
    if (!at || event.altKey || event.shiftKey) return;
    const control = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (!control && key === "delete") {
        if (at.index !== undefined) {
            if (at.index !== "_id_") void actions.dropIndex(at);
        } else if (at.collection !== undefined) {
            void actions.dropCollection(at);
        } else if (at.database !== undefined) {
            void actions.dropDatabase(at);
        } else {
            return;
        }
    } else if (control && key === "c" && at.database !== undefined && at.collection !== undefined && at.index === undefined) {
        copying.copy({ connectionId: at.connectionId, database: at.database, collection: at.collection });
    } else if (control && key === "v" && at.database !== undefined) {
        void copying.paste(at.connectionId, at.database);
    } else {
        return;
    }
    event.preventDefault();
}

function openMenu(event: MouseEvent, at: TreeSelection) {
    select(at);
    // Pasting goes into the database of the row; the copy may come from another connection.
    const paste = (database: string): MenuEntry => ({
        label: copying.copied.value ? t("collection.pasteNamed", { name: copying.copied.value.collection }) : t("collection.paste"),
        icon: "i-lucide-clipboard-paste",
        hotkey: "Ctrl + V",
        action: () => void copying.paste(at.connectionId, database),
        disabled: !copying.copied.value || copying.running.runId !== undefined
    });
    const tail: MenuEntry[] = [
        "separator",
        { label: t("action.refresh"), icon: "i-lucide-refresh-cw", hotkey: "Ctrl + R", action: () => void actions.refresh(at) },
        { label: t("connection.disconnect"), hotkey: "Ctrl + Alt + D", action: () => void actions.disconnect(at) }
    ];
    let entries: MenuEntry[];
    if (at.index !== undefined) {
        entries = [
            { label: t("tab.shell"), icon: "i-lucide-square-terminal", hotkey: "Ctrl + T", action: () => actions.openShell(at) },
            "separator",
            { label: t("index.create"), icon: "i-lucide-key-round", hotkey: "Ctrl + I", action: () => actions.createIndex(at) },
            { label: t("index.recreate"), hotkey: "Ctrl + Alt + I", action: () => actions.recreateIndex(at), disabled: at.index === "_id_" },
            { label: t("index.duplicate"), icon: "i-lucide-copy", hotkey: "Ctrl + Shift + I", action: () => actions.duplicateIndex(at), disabled: at.index === "_id_" },
            // The index on _id belongs to the collection: it can be neither dropped nor hidden.
            { label: t(actions.indexOf(at)?.hidden === true ? "index.unhide" : "index.hide"), action: () => void actions.toggleIndexHidden(at), disabled: at.index === "_id_" },
            { label: t("index.drop"), hotkey: "Del", danger: true, action: () => void actions.dropIndex(at), disabled: at.index === "_id_" },
            "separator",
            { label: t("index.info.show"), action: () => actions.indexInfo(at) },
            ...tail
        ];
    } else if (at.collection !== undefined) {
        entries = [
            { label: t("tab.browse"), icon: "i-lucide-file-text", hotkey: "Ctrl + Q", action: () => actions.browse(at) },
            "separator",
            { label: t("tab.shell"), icon: "i-lucide-square-terminal", hotkey: "Ctrl + T", action: () => actions.openShell(at) },
            { label: t("tab.aggregation"), icon: "i-lucide-network", hotkey: "Ctrl + Shift + Q", action: () => actions.aggregation(at) },
            "separator",
            { label: t("collection.create"), icon: "i-lucide-file-plus-2", hotkey: "Ctrl + H", action: () => void actions.createCollection(at) },
            { label: t("view.create"), icon: "i-lucide-file-search", hotkey: "Ctrl + Shift + H", action: () => actions.createView(at) },
            "separator",
            { label: t("collection.copy"), icon: "i-lucide-copy", hotkey: "Ctrl + C", action: () => copying.copy({ connectionId: at.connectionId, database: at.database!, collection: at.collection! }) },
            paste(at.database!),
            { label: t("collection.rename"), action: () => void actions.renameCollection(at) },
            { label: t("collection.drop"), icon: "i-lucide-file-x-2", hotkey: "Del", danger: true, action: () => void actions.dropCollection(at) },
            "separator",
            { label: t("index.create"), icon: "i-lucide-key-round", hotkey: "Ctrl + I", action: () => actions.createIndex(at) },
            { label: t("index.list"), action: () => actions.indexes(at) },
            { label: t("validator.edit"), hotkey: "Ctrl + Alt + V", action: () => actions.editValidator(at) },
            "separator",
            { label: t("collection.stats"), action: () => actions.collectionStats(at) },
            ...noteEntries(at),
            ...tail
        ];
    } else if (at.database !== undefined) {
        entries = [
            { label: t("tab.shell"), icon: "i-lucide-square-terminal", hotkey: "Ctrl + T", action: () => actions.openShell(at) },
            "separator",
            { label: t("database.create"), hotkey: "Ctrl + Shift + D", action: () => void actions.createDatabase(at) },
            { label: t("collection.create"), icon: "i-lucide-file-plus-2", hotkey: "Ctrl + H", action: () => void actions.createCollection(at) },
            { label: t("view.create"), icon: "i-lucide-file-search", hotkey: "Ctrl + Shift + H", action: () => actions.createView(at) },
            paste(at.database),
            "separator",
            { label: t("database.drop"), hotkey: "Del", danger: true, action: () => void actions.dropDatabase(at) },
            "separator",
            { label: t("database.stats"), action: () => actions.databaseStats(at) },
            { label: t("database.collectionsStats"), action: () => actions.collectionsStats(at) },
            "separator",
            { label: t("users.manage"), icon: "i-lucide-users", hotkey: "Ctrl + Alt + U", action: () => actions.manageUsers(at) },
            { label: t("roles.manage"), icon: "i-lucide-shield", hotkey: "Ctrl + Alt + R", action: () => actions.manageRoles(at) },
            ...noteEntries(at),
            ...tail
        ];
    } else {
        entries = [
            { label: t("tab.shell"), icon: "i-lucide-square-terminal", hotkey: "Ctrl + T", action: () => actions.openShell(at) },
            "separator",
            { label: t("database.create"), hotkey: "Ctrl + Shift + D", action: () => void actions.createDatabase(at) },
            "separator",
            { label: t("connection.status"), icon: "i-lucide-activity", action: () => actions.serverStatus(at) },
            { label: t("connection.log"), icon: "i-lucide-scroll-text", action: () => actions.serverLog(at) },
            { label: t("users.manage"), icon: "i-lucide-users", hotkey: "Ctrl + Alt + U", action: () => actions.manageUsers(at) },
            { label: t("roles.manage"), icon: "i-lucide-shield", hotkey: "Ctrl + Alt + R", action: () => actions.manageRoles(at) },
            "separator",
            { label: t("action.refresh"), icon: "i-lucide-refresh-cw", hotkey: "Ctrl + R", action: () => void actions.refresh(at) },
            "separator",
            { label: t("connection.settings"), action: () => actions.connectionSettings(at) },
            { label: t("connection.uri"), hotkey: "Ctrl + Alt + F2", action: () => void actions.viewUri(at) },
            ...noteEntries(at),
            "separator",
            { label: t("connection.disconnect"), hotkey: "Ctrl + Alt + D", action: () => void actions.disconnect(at) }
        ];
    }
    void menu.value?.open(event, entries);
}

defineExpose({
    /** Opens the list of saved connections (F2). */
    openList: () => (listOpen.value = true)
});
</script>

<template>
    <aside class="h-full min-w-0 flex flex-col bg-dock select-none">
        <header class="h-13 shrink-0 flex items-end justify-between pl-5.5 pr-4 pb-2.5">
            <PopoverRoot v-model="listOpen">
                <PopoverActivator
                    :title="$t('connection.list.hint')"
                    class="inline-flex items-center gap-1 text-[13px] font-bold tracking-wide uppercase text-primary hover:brightness-125"
                    data-testid="connection-list"
                >
                    {{ $t("connection.connect") }}
                    <span class="i-lucide-chevron-down size-3.5" />
                </PopoverActivator>
                <PopoverContent
                    class="menu-panel w-80"
                    positionArea="bottom span-right"
                >
                    <p
                        v-if="connections.profiles.length === 0"
                        class="m-0 px-3 py-3 text-[13px] text-on-surface-variant"
                    >
                        {{ $t("connection.empty") }}
                    </p>
                    <div
                        v-for="profile in connections.profiles"
                        :key="profile.id"
                        class="group flex items-center hover:bg-primary/25"
                        data-testid="connection-item"
                    >
                        <ButtonRoot
                            @click="choose(profile)"
                            class="grow min-w-0 h-8 pl-2.5 flex items-center gap-2 text-left text-[13px]"
                        >
                            <span
                                :class="connections.sessions[profile.id] ? 'text-success' : 'text-on-surface'"
                                class="i-lucide-server size-4 shrink-0"
                            />
                            <ButtonContent class="truncate text-on-surface-strong">
                                {{ profile.name }}
                            </ButtonContent>
                            <span class="truncate italic text-on-surface-variant">{{ profile.address.replace(/^mongodb(\+srv)?:\/\//, "") }}</span>
                        </ButtonRoot>
                        <IconButton
                            @click="listOpen = false; dialogs.editConnection(profile)"
                            :label="$t('connection.edit')"
                            icon="i-lucide-pencil"
                        />
                        <IconButton
                            @click="listOpen = false; actions.deleteConnection(profile)"
                            :label="$t('action.delete')"
                            class="mr-1"
                            icon="i-lucide-trash-2"
                        />
                    </div>
                    <div class="my-1 mx-2 border-t border-divider" />
                    <ButtonRoot
                        @click="listOpen = false; actions.newConnection()"
                        class="w-full h-8 px-2.5 mb-1 flex items-center gap-2 text-left text-[13px] text-on-surface-strong hover:bg-primary/25"
                    >
                        <span class="i-lucide-plus size-4 text-success" />
                        <ButtonContent>{{ $t("connection.add") }}</ButtonContent>
                    </ButtonRoot>
                </PopoverContent>
            </PopoverRoot>
            <IconButton
                @click="actions.newConnection()"
                :label="`${$t('connection.add')} (Ctrl + F2)`"
                data-testid="connection-add"
                icon="i-lucide-plus"
                tint="text-success"
            />
        </header>

        <div class="h-8 shrink-0 flex items-center gap-0.5 px-4">
            <IconButton
                @click="actions.openShell()"
                :disabled="!actions.hasConnection.value"
                :label="`${$t('tab.shell')} (Ctrl + T)`"
                data-testid="dock-shell"
                icon="i-lucide-square-terminal"
            >
                {{ $t("tab.shell.short") }}
            </IconButton>
            <span class="toolbar-rule" />
            <IconButton
                @click="actions.browse()"
                :disabled="!actions.hasCollection.value"
                :label="`${$t('tab.browse')} (Ctrl + Q)`"
                data-testid="dock-browse"
                icon="i-lucide-file-text"
            />
            <IconButton
                @click="actions.aggregation()"
                :disabled="!actions.hasCollection.value"
                :label="`${$t('tab.aggregation')} (Ctrl + Shift + Q)`"
                icon="i-lucide-network"
            />
            <span class="toolbar-rule" />
            <DropMenu
                :entries="createEntries"
                :label="$t('action.create')"
            >
                <span class="h-6.5 px-1 inline-flex items-center gap-0.5 rounded-sm text-on-surface hover:bg-on-surface/10">
                    <span class="i-lucide-file-plus-2 size-4" />
                    <span class="i-lucide-chevron-down size-3" />
                </span>
            </DropMenu>
            <DropMenu
                :entries="manageEntries"
                :label="$t('action.manage')"
            >
                <span class="h-6.5 px-1 inline-flex items-center gap-0.5 rounded-sm text-on-surface hover:bg-on-surface/10">
                    <span class="i-lucide-chart-column size-4" />
                    <span class="i-lucide-chevron-down size-3" />
                </span>
            </DropMenu>
            <span class="toolbar-rule" />
            <IconButton
                @click="searching = !searching; search = ''"
                :active="searching"
                :disabled="connected.length === 0"
                :label="$t('tree.search')"
                icon="i-lucide-search"
            />
        </div>

        <input
            v-if="searching"
            v-model="search"
            :aria-label="$t('tree.search')"
            :placeholder="$t('tree.search')"
            class="mx-4 mt-1 h-7 px-2 rounded-sm bg-surface-variant border border-divider outline-none focus:border-primary text-[13px] text-on-surface-strong"
            data-testid="tree-search"
            type="search"
        />

        <div
            @keydown="onTreeKey"
            class="grow min-h-0 overflow-y-auto pt-2 pb-2 text-[13px]"
            role="tree"
        >
            <div
                v-if="connected.length === 0"
                class="pt-14 flex flex-col items-center gap-1 text-center"
            >
                <span class="text-lg text-on-surface-variant">{{ $t("connection.none") }}</span>
                <span class="text-on-surface-variant/70">{{ $t("connection.none.hint") }}</span>
            </div>

            <div
                v-for="profile in connected"
                :key="profile.id"
                data-testid="connection"
            >
                <div
                    @click="select({ connectionId: profile.id })"
                    @contextmenu="openMenu($event, { connectionId: profile.id })"
                    @dblclick="toggleConnection(profile)"
                    @keydown.enter.self="toggleConnection(profile)"
                    :class="isSelected({ connectionId: profile.id }) ? 'tree-row-on' : ''"
                    class="tree-row pl-3.5"
                    data-testid="connection-row"
                    role="treeitem"
                    tabindex="0"
                >
                    <span
                        @click.stop="toggleConnection(profile)"
                        :class="connections.sessions[profile.id]?.open ? 'rotate-90' : ''"
                        class="i-lucide-chevron-right size-3.5 shrink-0 text-on-surface-variant"
                    />
                    <span
                        :class="tint({ connectionId: profile.id })"
                        class="i-lucide-server size-4 shrink-0"
                    />
                    <span class="truncate text-on-surface-strong">{{ profile.name }}</span>
                    <NoteMarks :place="{ connectionId: profile.id }" />
                    <span class="truncate italic text-on-surface-variant">{{ profile.address.replace(/^mongodb(\+srv)?:\/\//, "") }}</span>
                    <span class="grow" />
                    <span
                        class="shrink-0 text-[11px] text-on-surface-variant"
                        data-testid="connection-version"
                    >{{ connections.sessions[profile.id]?.version }}</span>
                </div>

                <template v-if="connections.sessions[profile.id]?.open">
                    <template
                        v-for="database in shownDatabases(profile)"
                        :key="database.name"
                    >
                        <div
                            @click="select({ connectionId: profile.id, database: database.name })"
                            @contextmenu="openMenu($event, { connectionId: profile.id, database: database.name })"
                            @dblclick="toggleDatabase(profile, database)"
                            @keydown.enter.self="toggleDatabase(profile, database)"
                            :class="isSelected({ connectionId: profile.id, database: database.name }) ? 'tree-row-on' : ''"
                            class="tree-row pl-7.5"
                            data-testid="database-row"
                            role="treeitem"
                            tabindex="0"
                        >
                            <span
                                @click.stop="toggleDatabase(profile, database)"
                                :class="[database.loading ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-chevron-right', database.open ? 'rotate-90' : '']"
                                class="size-3.5 shrink-0 text-on-surface-variant"
                                data-testid="database-toggle"
                            />
                            <span
                                :class="tint({ connectionId: profile.id, database: database.name })"
                                class="i-lucide-database size-4 shrink-0"
                            />
                            <span class="truncate text-on-surface-strong">{{ database.name }}</span>
                            <NoteMarks :place="{ connectionId: profile.id, database: database.name }" />
                            <span class="grow" />
                            <span
                                v-if="database.collections"
                                class="shrink-0 text-[11px] text-on-surface-variant"
                            >{{ database.collections.length }}</span>
                        </div>

                        <template v-if="database.open">
                            <template
                                v-for="collection in shownCollections(database)"
                                :key="collection"
                            >
                                <div
                                    @click="select({ connectionId: profile.id, database: database.name, collection })"
                                    @contextmenu="openMenu($event, { connectionId: profile.id, database: database.name, collection })"
                                    @dblclick="actions.browse({ connectionId: profile.id, database: database.name, collection })"
                                    @keydown.enter="actions.browse({ connectionId: profile.id, database: database.name, collection })"
                                    :class="isSelected({ connectionId: profile.id, database: database.name, collection }) ? 'tree-row-on' : ''"
                                    class="tree-row pl-11.5"
                                    data-testid="collection-row"
                                    role="treeitem"
                                    tabindex="0"
                                >
                                    <span
                                        @click.stop="toggleCollection(profile, database, collection)"
                                        @dblclick.stop
                                        :class="[
                                            database.details[collection]?.loading ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-chevron-right',
                                            database.details[collection]?.open ? 'rotate-90' : ''
                                        ]"
                                        class="size-3.5 shrink-0 text-on-surface-variant"
                                        data-testid="collection-toggle"
                                    />
                                    <span
                                        :class="tint({ connectionId: profile.id, database: database.name, collection })"
                                        class="i-lucide-file-text size-4 shrink-0"
                                    />
                                    <span class="truncate text-on-surface-strong">{{ collection }}</span>
                                    <NoteMarks :place="{ connectionId: profile.id, database: database.name, collection }" />
                                </div>

                                <!-- Unfolded, a collection shows its indexes. -->
                                <template v-if="database.details[collection]?.open">
                                    <div
                                        v-for="index in database.details[collection]?.indexes"
                                        :key="String(index.name)"
                                        @click="select({ connectionId: profile.id, database: database.name, collection, index: String(index.name) })"
                                        @contextmenu="openMenu($event, { connectionId: profile.id, database: database.name, collection, index: String(index.name) })"
                                        @dblclick="actions.indexInfo({ connectionId: profile.id, database: database.name, collection, index: String(index.name) })"
                                        :class="isSelected({ connectionId: profile.id, database: database.name, collection, index: String(index.name) }) ? 'tree-row-on' : ''"
                                        class="tree-row pl-20"
                                        data-testid="index-row"
                                        role="treeitem"
                                        tabindex="0"
                                    >
                                        <span class="i-lucide-key-round size-3.5 shrink-0 text-on-surface" />
                                        <span
                                            :class="index.hidden === true ? 'opacity-55' : ''"
                                            class="truncate text-on-surface-strong"
                                        >{{ index.name }}</span>
                                        <span
                                            v-if="index.hidden === true"
                                            class="shrink-0 text-[11px] italic text-on-surface-variant"
                                        >{{ $t("index.hiddenMark") }}</span>
                                    </div>
                                </template>
                            </template>
                        </template>
                    </template>
                </template>
            </div>
        </div>

        <ContextMenu ref="menu" />
    </aside>
</template>
