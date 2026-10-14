<script setup lang="ts">
import { SplitterHandle, SplitterPanel, SplitterRoot } from "@vuetify/v0";
import { computed, useTemplateRef } from "vue";
import CodeEditor from "@/components/CodeEditor.vue";
import DropMenu from "@/components/DropMenu.vue";
import IconButton from "@/components/IconButton.vue";
import QueryHistory from "@/components/QueryHistory.vue";
import ResultsPanel from "@/components/results/ResultsPanel.vue";
import { useLayout } from "@/composables/layout";
import { useMessages } from "@/composables/messages";
import { SCRIPT_FILES, openTextFile, saveTextFile } from "@/files";
import type { MenuEntry } from "@/menu";
import type { Environment } from "@/shell/complete";
import { ShellError } from "@/shell/message";
import { parseStatements, statementAt } from "@/shell/parse";
import { optionsOf, stagesOf } from "@/shell/pipeline";
import { useConnectionsStore } from "@/stores/connections";
import { useTabsStore } from "@/stores/tabs";

/** A shell: a script above, the output of the statement that ran below. */
const props = defineProps<{
    tabId: string;
}>();

const { report } = useMessages();
const { layout } = useLayout();
const connections = useConnectionsStore();
const tabs = useTabsStore();
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

/** What the editor completes with; read anew on every request for suggestions. */
const environment = computed<Environment>(() => ({
    serverVersion: connections.sessions[tab.value.connectionId]?.version,
    databases: databases.value.map(entry => (entry === "separator" ? "" : entry.label)),
    collections: connections.collectionsOf(tab.value.connectionId, tab.value.database),
    fields: collection => connections.fieldsOf(tab.value.connectionId, tab.value.database, collection)
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

async function openScript() {
    try {
        const text = await openTextFile(SCRIPT_FILES);
        if (text !== undefined) tab.value.text = text;
    } catch (error) {
        report(error);
    }
}

async function saveScript() {
    await saveTextFile(`${tab.value.database}.js`, SCRIPT_FILES, tab.value.text).catch(report);
}

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
        void tabs.runAggregate(opened);
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
                :label="`${$t('query.run')} (F5)`"
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
                :label="$t('script.open')"
                icon="i-lucide-folder-open"
            />
            <IconButton
                @click="saveScript"
                :label="$t('script.save')"
                icon="i-lucide-save"
            />
            <span class="toolbar-rule" />
            <QueryHistory
                @choose="tab.text = $event"
                :connectionId="tab.connectionId"
            />
            <span class="toolbar-rule" />
            <!-- eslint-disable-next-line vue/no-mutating-props -- `tab` is the store's own object, not a prop -->
            <IconButton
                @click="tab.readonly = !tab.readonly"
                :active="tab.readonly"
                :icon="tab.readonly ? 'i-lucide-lock' : 'i-lucide-lock-open'"
                :label="$t('query.readonly')"
                data-testid="query-readonly"
            />
            <span class="toolbar-rule" />
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
                <div class="shrink-0 px-5.5 pt-2">
                    <span class="inline-block px-3 pb-1.5 border-b border-primary text-[13px] text-primary">{{ $t("query.output") }}</span>
                </div>
                <pre
                    v-if="tab.output"
                    class="shrink-0 max-h-[40%] overflow-auto m-0 mx-5.5 mt-2 px-3 py-2 rounded-sm bg-on-surface/5 font-mono text-[13px] leading-[19px] text-on-surface-strong select-text"
                    data-testid="script-output"
                >{{ tab.output }}</pre>
                <ResultsPanel
                    :tabId
                    class="grow min-h-0"
                />
            </SplitterPanel>
        </SplitterRoot>
    </section>
</template>
