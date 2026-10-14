<script setup lang="ts">
import { SplitterHandle, SplitterPanel, SplitterRoot, useNotifications } from "@vuetify/v0";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import CodeEditor from "@/components/CodeEditor.vue";
import IconButton from "@/components/IconButton.vue";
import QueryHistory from "@/components/QueryHistory.vue";
import ReadonlyToggle from "@/components/ReadonlyToggle.vue";
import ResultsPanel from "@/components/results/ResultsPanel.vue";
import { useLayout } from "@/composables/layout";
import { useMessages } from "@/composables/messages";
import { sqlCollection, sqlToShell } from "@/sql/sql";
import { useConnectionsStore } from "@/stores/connections";
import { useTabsStore } from "@/stores/tabs";

/** SQL for reading: a SELECT above, the shell statement it becomes, the result below. */
const props = defineProps<{
    tabId: string;
}>();

const { t } = useI18n();
const { report } = useMessages();
const notifications = useNotifications();
const { layout } = useLayout();
const connections = useConnectionsStore();
const tabs = useTabsStore();
// The store's own object: the text is changed here.
const tab = computed(() => tabs.tabs.find(item => item.id === props.tabId)!);
const profile = computed(() => connections.profiles.find(item => item.id === tab.value.connectionId));

/** Collections of the database; the fields only of the one after FROM, which are sampled. */
const schema = computed(() => {
    const from = sqlCollection(tab.value.text);
    const collections = connections.collectionsOf(tab.value.connectionId, tab.value.database);
    return Object.fromEntries(collections.map(name => [name, name === from ? connections.fieldsOf(tab.value.connectionId, tab.value.database, name) : []]));
});

/** The shell statement the SQL becomes, as far as it can be read now. */
const statement = computed(() => {
    try {
        return sqlToShell(tab.value.text);
    } catch {
        return undefined;
    }
});

function run() {
    void tabs.runSql(tab.value);
}

function openInShell() {
    try {
        tabs.openShell({ connectionId: tab.value.connectionId, database: tab.value.database, text: sqlToShell(tab.value.text) });
    } catch (error) {
        report(error);
    }
}

async function copyStatement() {
    if (!statement.value) return;
    try {
        await navigator.clipboard.writeText(statement.value);
        notifications.send({ subject: t("action.copied"), timeout: 1500 });
    } catch (error) {
        report(error);
    }
}
</script>

<template>
    <section class="h-full min-h-0 flex flex-col">
        <h1 class="m-0 shrink-0 h-13 flex items-end gap-3 px-5.5 pb-1.5 text-[21px] font-normal text-on-surface whitespace-nowrap overflow-hidden">
            <span data-testid="sql-title">SQL</span>
            <span class="text-on-surface/80">{{ tab.database }} @ {{ profile?.name }}</span>
        </h1>

        <div class="h-8 shrink-0 flex items-center gap-0.5 px-5">
            <IconButton
                @click="run"
                :disabled="tab.running"
                :icon="tab.running ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-play'"
                :label="`${$t('query.run')} (F5)`"
                data-testid="query-run"
                tint="text-success"
            >
                {{ $t("query.run") }}
            </IconButton>
            <span class="toolbar-rule" />
            <QueryHistory
                @choose="tab.text = $event"
                :connectionId="tab.connectionId"
            />
            <span class="toolbar-rule" />
            <ReadonlyToggle :tabId />
            <span class="toolbar-rule" />
            <IconButton
                @click="copyStatement"
                :disabled="!statement"
                :label="$t('sql.copy')"
                icon="i-lucide-copy"
            />
            <IconButton
                @click="openInShell"
                :disabled="!statement"
                :label="$t('query.toShell')"
                data-testid="query-to-shell"
                icon="i-lucide-square-terminal"
            />
        </div>

        <SplitterRoot
            class="grow min-h-0"
            orientation="vertical"
        >
            <SplitterPanel
                v-if="layout !== 'results'"
                :defaultSize="34"
                :minSize="10"
                class="min-h-0 flex flex-col"
            >
                <div class="grow min-h-0 mx-5 mt-1 rounded-sm border border-divider bg-background">
                    <CodeEditor
                        v-model="tab.text"
                        @run="run"
                        :errorPosition="tab.errorPosition"
                        :label="$t('sql.editor')"
                        :sqlSchema="schema"
                    />
                </div>
                <p
                    :title="statement"
                    class="m-0 mx-5 my-1.5 shrink-0 font-mono text-[12px] text-on-surface-variant truncate"
                    data-testid="sql-statement"
                >
                    <span class="text-on-surface">{{ $t("sql.becomes") }}</span> {{ statement ?? "…" }}
                </p>
            </SplitterPanel>
            <SplitterHandle
                v-if="layout === 'default'"
                :label="$t('layout.resize')"
                class="h-1.5 -my-[3px] relative z-10 cursor-row-resize hover:bg-primary/25"
            />
            <SplitterPanel
                v-if="layout !== 'editor'"
                :defaultSize="66"
                class="min-h-0"
            >
                <ResultsPanel
                    :tabId
                    class="h-full"
                />
            </SplitterPanel>
        </SplitterRoot>
    </section>
</template>
