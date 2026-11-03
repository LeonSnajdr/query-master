<script setup lang="ts">
import { ButtonRoot, SplitterHandle, SplitterPanel, SplitterRoot, TabsItem, TabsList, TabsRoot } from "@vuetify/v0";
import { computed, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import CodeEditor from "@/components/CodeEditor.vue";
import DropMenu from "@/components/DropMenu.vue";
import IconButton from "@/components/IconButton.vue";
import QueryHistory from "@/components/QueryHistory.vue";
import SaveQueryStar from "@/components/SaveQueryStar.vue";
import ReadonlyToggle from "@/components/ReadonlyToggle.vue";
import ResultsPanel from "@/components/results/ResultsPanel.vue";
import { useLayout } from "@/composables/layout";
import { useMessages } from "@/composables/messages";
import { useNotices } from "@/composables/notices";
import { fileName, useRecentFiles } from "@/composables/recentFiles";
import { useValueSearch, useValueSources } from "@/composables/values";
import { backend, inApp } from "@/api";
import { SCRIPT_FILES, openTextFile, pickOpenPath, pickSavePath, saveTextFile } from "@/files";
import type { MenuEntry } from "@/menu";
import type { Environment } from "@/shell/complete";
import { ShellError } from "@/shell/message";
import { parseStatements, statementAt } from "@/shell/parse";
import { optionsOf, stagesOf } from "@/shell/pipeline";
import { useConnectionsStore } from "@/stores/connections";
import { useTabsStore } from "@/stores/tabs";
import { useKeymap, useShortcut } from "@/keys/keymap";

/** A shell: a script above, the output of the statement that ran below. */
const props = defineProps<{
    tabId: string;
}>();

const { t } = useI18n();
const { report } = useMessages();
const notices = useNotices();
const recent = useRecentFiles();
void recent.load();
const { layout } = useLayout();
const connections = useConnectionsStore();
const tabs = useTabsStore();
const keymap = useKeymap();
// The store's own object: the text, the database and the read-only switch are changed here.
const tab = computed(() => tabs.tabs.find(item => item.id === props.tabId)!);
const profile = computed(() => connections.profiles.find(item => item.id === tab.value.connectionId));
const editor = useTemplateRef("editor");

const databases = computed<MenuEntry[]>(() => {
    const names = connections.sessions[tab.value.connectionId]?.databases.map(database => database.name) ?? [];
    // A database that does not exist yet (it is created with its first document) stays selectable.
    return (names.includes(tab.value.database) ? names : [tab.value.database, ...names]).map(name => ({
        label: name,
        checked: name === tab.value.database,
        action: () => (tab.value.database = name)
    }));
});

/** Which statement's result shows, when several ran together. */
const shownResult = computed({
    get: () => tab.value.resultIndex ?? 0,
    set: (index: number) => tabs.showResult(tab.value, index)
});

/**
 * The tab *Text*: what the script printed, on the whole height. It shows by
 * itself when a run printed and gave no result; a new run shows its result again.
 */
const textShown = shallowRef(false);
watch(() => [tab.value.output, tab.value.results, tab.value.result] as const, ([output, , result]) => {
    textShown.value = output !== undefined && result === undefined;
});
const shownTab = computed<number | "text">({
    get: () => (textShown.value && tab.value.output !== undefined ? "text" : shownResult.value),
    set: (value) => {
        textShown.value = value === "text";
        if (value !== "text") shownResult.value = value;
    }
});
const hasTabs = computed(() => tab.value.output !== undefined || (tab.value.results?.length ?? 0) > 1);

/** The output on the whole tab (*Maximize*); again: both halves. */
function toggleMaximized() {
    layout.value = layout.value === "results" ? "default" : "results";
}

const values = useValueSources(() => tab.value);
const search = useValueSearch(() => tab.value);

/** What the editor completes with; read anew on every request for suggestions. */
const environment = computed<Environment>(() => ({
    serverVersion: connections.sessions[tab.value.connectionId]?.version,
    databases: databases.value.map(entry => (entry === "separator" ? "" : entry.label)),
    collections: connections.collectionsOf(tab.value.connectionId, tab.value.database),
    fields: collection => connections.fieldsOf(tab.value.connectionId, tab.value.database, collection),
    values,
    search
}));

/** "Run": the selected text if there is one, else the whole script. */
function run(position?: number, selection?: string) {
    const cursor = editor.value?.cursor();
    void tabs.run(tab.value, position ?? cursor?.position ?? 0, selection ?? cursor?.selection, true);
}

function runSelection() {
    const cursor = editor.value?.cursor();
    if (cursor) void tabs.run(tab.value, cursor.position, cursor.selection);
}

/** Reads a script file into the tab, which then carries its name and saves back to it. */
async function openPath(path: string) {
    try {
        tab.value.text = await backend.readTextFile(path);
    } catch {
        // A file that moved or went away leaves the list.
        notices.notify({ kind: "warning", title: t("script.recent.missing", { path }) });
        void recent.remove(path).catch(() => undefined);
        return;
    }
    tab.value.file = path;
    tab.value.fileText = tab.value.text;
    void recent.add(path).catch(report);
}

async function openScript() {
    try {
        if (!inApp) {
            const text = await openTextFile(SCRIPT_FILES);
            if (text !== undefined) tab.value.text = text;
            return;
        }
        const path = await pickOpenPath([SCRIPT_FILES]);
        if (path !== undefined) await openPath(path);
    } catch (error) {
        report(error);
    }
}

/** Saves to the file of the tab; asks where when it has none or `ask` is set. */
async function saveScript(ask = false) {
    try {
        if (!inApp) {
            await saveTextFile(`${tab.value.database}.js`, SCRIPT_FILES, tab.value.text);
            return;
        }
        const path = !ask && tab.value.file ? tab.value.file : await pickSavePath(tab.value.file ?? `${tab.value.database}.js`, SCRIPT_FILES);
        if (path === undefined) return;
        await backend.writeTextFile(path, tab.value.text);
        tab.value.file = path;
        tab.value.fileText = tab.value.text;
        notices.answer(t("script.saved", { name: fileName(path) }));
        void recent.add(path).catch(report);
    } catch (error) {
        report(error);
    }
}

// Ctrl+S, Ctrl+Shift+S and Ctrl+O, as in every editor: for the shell tab in front.
const inFront = () => tabs.activeId === tab.value.id;
useShortcut("script.save", () => void saveScript(), inFront);
useShortcut("script.saveAs", () => void saveScript(true), inFront);
useShortcut("script.open", () => void openScript(), inFront);

/** The folder a file lies in, by its name: `C:\scripts\orders.js` → `scripts`. */
function folderOf(path: string): string {
    return fileName(path.slice(0, Math.max(0, path.length - fileName(path).length - 1)));
}

const recentEntries = computed<MenuEntry[]>(() => [
    ...(recent.files.value.length === 0
        ? [{ label: t("script.recent.empty"), action: () => undefined, disabled: true }]
        : recent.files.value.map((path): MenuEntry => ({ label: fileName(path), hotkey: folderOf(path), checked: path === tab.value.file, action: () => void openPath(path) }))),
    "separator",
    { label: t("script.saveAs"), icon: "i-lucide-save-all", command: "script.saveAs", action: () => void saveScript(true) }
]);

/** The `aggregate` statement at the cursor, as rows of the aggregation builder. */
function openInBuilder() {
    try {
        const cursor = editor.value?.cursor();
        const statement = statementAt(parseStatements(cursor?.selection?.trim() ? cursor.selection : tab.value.text), cursor?.selection?.trim() ? 0 : cursor?.position ?? 0);
        if (statement?.method !== "aggregate" || statement.collection === undefined) throw new ShellError("error.pipeline.notAggregate");
        const opened = tabs.openAggregate({
            connectionId: tab.value.connectionId,
            database: statement.database ?? tab.value.database,
            collection: statement.collection,
            pipeline: stagesOf(statement),
            aggregateOptions: optionsOf(statement) || undefined
        });
        void tabs.runStages(opened);
    } catch (error) {
        report(error);
    }
}
</script>

<template>
    <section class="h-full min-h-0 flex flex-col">
        <h1 class="m-0 shrink-0 h-13 flex items-end gap-2 px-5.5 pb-1.5 text-[21px] font-normal text-on-surface whitespace-nowrap overflow-hidden">
            <DropMenu
                :entries="databases"
                :filterAbove="10"
                :label="$t('query.database')"
            >
                <span
                    class="inline-flex items-center gap-1 hover:text-on-surface-strong"
                    data-testid="shell-database"
                >
                    {{ tab.database }}
                    <span class="i-lucide-chevron-down size-4 text-on-surface-variant" />
                </span>
            </DropMenu>
            <span class="text-on-surface/80">@ {{ profile?.name }}</span>
        </h1>

        <div class="h-8 shrink-0 flex items-center gap-0.5 px-5">
            <IconButton
                v-if="tab.runId"
                @click="tabs.stop(tab)"
                :label="$t('query.stop')"
                data-testid="query-stop"
                icon="i-lucide-square"
                tint="text-error"
            >
                {{ $t("query.stop") }}
            </IconButton>
            <IconButton
                v-else
                @click="run()"
                :disabled="tab.running"
                :icon="tab.running ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-play'"
                :label="keymap.titled($t('query.run'), 'query.run')"
                data-testid="query-run"
                tint="text-success"
            >
                {{ $t("query.run") }}
            </IconButton>
            <IconButton
                @click="runSelection"
                :disabled="tab.running"
                :label="$t('query.run.selection')"
                icon="i-lucide-list-video"
                tint="text-success"
            />
            <span class="toolbar-rule" />
            <IconButton
                @click="openScript"
                :label="keymap.titled($t('script.open'), 'script.open')"
                icon="i-lucide-folder-open"
            />
            <IconButton
                @click="saveScript()"
                :label="keymap.titled(tab.file ? `${$t('script.save')} (${tab.file})` : $t('script.save'), 'script.save')"
                icon="i-lucide-save"
            />
            <DropMenu
                v-if="inApp"
                :entries="recentEntries"
                :label="$t('script.recent')"
            >
                <span
                    class="h-6.5 min-w-6 px-1 inline-flex items-center justify-center rounded-sm text-on-surface hover:text-on-surface-strong hover:bg-on-surface/10"
                    data-testid="script-recent"
                >
                    <span class="i-lucide-file-clock size-4" />
                </span>
            </DropMenu>
            <span class="toolbar-rule" />
            <QueryHistory
                @choose="tab.text = $event"
                :connectionId="tab.connectionId"
                :tabId="tab.id"
            />
            <SaveQueryStar :tabId="tab.id" />
            <span class="toolbar-rule" />
            <ReadonlyToggle :tabId />
            <span class="toolbar-rule" />
            <IconButton
                @click="editor?.format()"
                :label="keymap.titled($t('shortcut.format'), 'editor.format')"
                data-testid="editor-format"
                icon="i-lucide-wand-sparkles"
            />
            <IconButton
                @click="openInBuilder"
                :label="$t('aggregate.fromShell')"
                data-testid="shell-to-builder"
                icon="i-lucide-network"
            />
        </div>

        <SplitterRoot
            class="grow min-h-0"
            orientation="vertical"
        >
            <SplitterPanel
                v-if="layout !== 'results'"
                :defaultSize="34"
                :minSize="8"
                class="min-h-0"
            >
                <CodeEditor
                    ref="editor"
                    v-model="tab.text"
                    @run="run"
                    :environment
                    :errorPosition="tab.errorPosition"
                    :label="$t('query.editor')"
                    findBar
                />
            </SplitterPanel>
            <SplitterHandle
                v-if="layout === 'default'"
                :label="$t('layout.resize')"
                class="relative z-10 h-1.5 -my-[3px] shrink-0 flex items-center justify-center border-t border-divider cursor-row-resize text-on-surface-variant hover:bg-primary/25"
            >
                <span class="i-lucide-ellipsis size-3.5" />
            </SplitterHandle>
            <SplitterPanel
                v-if="layout !== 'editor'"
                :defaultSize="66"
                :minSize="10"
                class="min-h-0 flex flex-col"
            >
                <div class="shrink-0 flex items-end pr-3">
                    <TabsRoot
                        v-if="hasTabs"
                        v-model="shownTab"
                        class="min-w-0"
                        mandatory
                    >
                        <TabsList
                            :label="$t('query.output')"
                            class="flex gap-0.5 px-5.5 pt-2 overflow-x-auto"
                        >
                            <TabsItem
                                v-if="tab.output !== undefined"
                                class="shrink-0 px-3 pb-1.5 border-b border-transparent text-[13px] text-on-surface whitespace-nowrap hover:text-on-surface-strong data-[selected]:text-primary data-[selected]:border-primary"
                                data-testid="script-text-tab"
                                value="text"
                            >
                                {{ $t("query.output.text") }}
                            </TabsItem>
                            <TabsItem
                                v-if="!tab.results?.length"
                                :value="0"
                                class="shrink-0 px-3 pb-1.5 border-b border-transparent text-[13px] text-on-surface whitespace-nowrap hover:text-on-surface-strong data-[selected]:text-primary data-[selected]:border-primary"
                                data-testid="script-result-tab"
                            >
                                {{ $t("query.output.result") }}
                            </TabsItem>
                            <span
                                v-for="(entry, index) in tab.results ?? []"
                                :key="index"
                                class="group shrink-0 inline-flex items-center"
                            >
                                <TabsItem
                                    :title="tab.text.slice(entry.start, entry.start + 200)"
                                    :value="index"
                                    class="pl-3 pr-1 pb-1.5 border-b border-transparent text-[13px] text-on-surface whitespace-nowrap hover:text-on-surface-strong data-[selected]:text-primary data-[selected]:border-primary"
                                    data-testid="statement-result"
                                >
                                    {{ index + 1 }} · {{ entry.label }}
                                </TabsItem>
                                <ButtonRoot
                                    @click="tabs.closeResult(tab, index)"
                                    :ariaLabel="$t('query.output.close', { name: entry.label })"
                                    :disabled="tab.running"
                                    :title="$t('query.output.close', { name: entry.label })"
                                    class="size-4 mb-1.5 mr-1 inline-flex items-center justify-center rounded-sm text-on-surface-variant opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-on-surface/15"
                                    data-testid="statement-result-close"
                                >
                                    <span class="i-lucide-x size-3" />
                                </ButtonRoot>
                            </span>
                        </TabsList>
                    </TabsRoot>
                    <div
                        v-else
                        class="px-5.5 pt-2"
                    >
                        <span class="inline-block px-3 pb-1.5 border-b border-primary text-[13px] text-primary">{{ $t("query.output") }}</span>
                    </div>
                    <span class="grow" />
                    <IconButton
                        @click="toggleMaximized"
                        :icon="layout === 'results' ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
                        :label="layout === 'results' ? $t('query.output.restore') : $t('query.output.maximize')"
                        class="mb-0.5"
                        data-testid="output-maximize"
                    />
                </div>
                <pre
                    v-if="shownTab === 'text'"
                    class="grow min-h-0 overflow-auto m-0 mx-5.5 my-2 px-3 py-2 rounded-sm bg-on-surface/5 font-mono text-[13px] leading-[19px] text-on-surface-strong select-text"
                    data-testid="script-output"
                >{{ tab.output }}</pre>
                <ResultsPanel
                    v-else
                    :tabId
                    class="grow min-h-0"
                />
            </SplitterPanel>
        </SplitterRoot>
    </section>
</template>
