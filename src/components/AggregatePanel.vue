<script setup lang="ts">
import { SwitchRoot, SwitchThumb, SwitchTrack, useNotifications } from "@vuetify/v0";
import { computed, reactive, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { backend } from "@/api";
import CodeEditor from "@/components/CodeEditor.vue";
import DropMenu from "@/components/DropMenu.vue";
import IconButton from "@/components/IconButton.vue";
import QueryHistory from "@/components/QueryHistory.vue";
import ReadonlyToggle from "@/components/ReadonlyToggle.vue";
import ResultsPanel from "@/components/results/ResultsPanel.vue";
import { useDialogs } from "@/composables/dialogs";
import { useLayout } from "@/composables/layout";
import { useMessages } from "@/composables/messages";
import type { MenuEntry } from "@/menu";
import { STAGES } from "@/shell/catalog";
import type { Environment } from "@/shell/complete";
import { parseStatements, parseValue } from "@/shell/parse";
import type { Json } from "@/shell/ejson";
import { aggregateStatement, keepsDocuments, newStage, optionsOf, pipelineText, stagesOf, WRITING_STAGES } from "@/shell/pipeline";
import type { PipelineStage } from "@/shell/pipeline";
import { collectFields, useConnectionsStore } from "@/stores/connections";
import { useTabsStore } from "@/stores/tabs";

/** The aggregation builder: the stages of a pipeline as rows above, the result below. */
const props = defineProps<{
    tabId: string;
}>();

/** Lines a stage editor grows to before it scrolls. */
const MAX_LINES = 14;

const { t } = useI18n();
const { report } = useMessages();
const notifications = useNotifications();
const dialogs = useDialogs();
const { layout } = useLayout();
const connections = useConnectionsStore();
const tabs = useTabsStore();
// The store's own object: the stages and the read-only switch are changed here.
const tab = computed(() => tabs.tabs.find(item => item.id === props.tabId)!);
const profile = computed(() => connections.profiles.find(item => item.id === tab.value.connectionId));
const collection = computed(() => tab.value.collection ?? "");
const stages = computed(() => tab.value.pipeline ?? []);

/** The stage that was clicked last; remove and move act on it. */
const current = shallowRef<number>();
/** The row of options (`allowDiskUse`, `maxTimeMS` …) shows; it does by itself when it holds some. */
const showOptions = shallowRef((tab.value.aggregateOptions ?? "").replace(/[\s{}]/g, "") !== "");
const options = computed({
    get: () => tab.value.aggregateOptions ?? "{ }",
    set: (text: string) => (tab.value.aggregateOptions = text)
});
const wholeStatement = () => aggregateStatement(collection.value, stages.value, tab.value.aggregateOptions);
const currentIndex = computed(() => stages.value.findIndex(stage => stage.id === current.value));

const environment = computed<Environment>(() => ({
    serverVersion: connections.sessions[tab.value.connectionId]?.version,
    databases: connections.sessions[tab.value.connectionId]?.databases.map(database => database.name) ?? [],
    collections: connections.collectionsOf(tab.value.connectionId, tab.value.database),
    fields: name => connections.fieldsOf(tab.value.connectionId, tab.value.database, name)
}));

/** Fields the pipeline gives up to a point, per pipeline text; read from a sample when first asked. */
const shapedFields = reactive(new Map<string, string[]>());
const sampling = new Set<string>();

/**
 * The fields a stage sees: those of the collection while every stage before keeps the documents
 * as they are; after a $group, $project … those of 50 documents the stages before give. Asked only
 * when the editor suggests, so typing does not run the pipeline.
 */
function fieldsAt(position: number): string[] {
    const before = stages.value.slice(0, position).filter(stage => stage.enabled && !WRITING_STAGES.includes(stage.operator));
    if (keepsDocuments(before)) return connections.fieldsOf(tab.value.connectionId, tab.value.database, collection.value);
    let pipeline: Json;
    try {
        pipeline = parseValue(pipelineText(before));
    } catch {
        return [];
    }
    const key = JSON.stringify(pipeline);
    if (!shapedFields.has(key) && !sampling.has(key) && Array.isArray(pipeline)) {
        sampling.add(key);
        backend.runCursorCommand(tab.value.connectionId, tab.value.database, { aggregate: collection.value, pipeline: [...pipeline, { $limit: 50 }], cursor: {} }, 50)
            .then((page) => {
                const found = new Set<string>();
                for (const document of page.documents) collectFields(document, "", 1, found);
                shapedFields.set(key, [...found].sort((a, b) => a.localeCompare(b)));
            })
            .catch(() => shapedFields.set(key, []))
            .finally(() => sampling.delete(key));
    }
    return shapedFields.get(key) ?? [];
}

/** The stage being worked on; its fields are read now, so they are there when the editor asks. */
function focusStage(stage: PipelineStage) {
    current.value = stage.id;
    fieldsAt(stages.value.indexOf(stage));
}

function environmentAt(stage: PipelineStage): Environment {
    const position = stages.value.indexOf(stage);
    return { ...environment.value, fields: () => fieldsAt(position) };
}

/** What a stage's text continues, so the editor suggests the keys and operators of that stage. */
function prefix(stage: PipelineStage): string {
    return `db.getCollection(${JSON.stringify(collection.value)}).aggregate([{ ${stage.operator}: `;
}

function height(stage: PipelineStage): string {
    const lines = Math.min(MAX_LINES, Math.max(1, stage.text.split("\n").length));
    return `${lines * 20 + 16}px`;
}

function stageEntries(action: (operator: string) => void): MenuEntry[] {
    return STAGES.map(entry => ({ label: entry.name, hotkey: entry.since ? `${entry.since}+` : undefined, action: () => action(entry.name) }));
}

function addStage(operator: string) {
    const stage = newStage(operator);
    // After the stage being worked on, or at the end.
    const at = currentIndex.value === -1 ? stages.value.length : currentIndex.value + 1;
    tab.value.pipeline = [...stages.value.slice(0, at), stage, ...stages.value.slice(at)];
    current.value = stage.id;
}

/** Another operator for the stage; its text stays. */
function changeStage(stage: PipelineStage, operator: string) {
    stage.operator = operator;
}

function removeStage() {
    const index = currentIndex.value;
    if (index === -1) return;
    tab.value.pipeline = stages.value.filter((_, position) => position !== index);
    current.value = stages.value[Math.min(index, stages.value.length - 1)]?.id;
}

function move(by: -1 | 1) {
    const index = currentIndex.value;
    const target = index + by;
    if (index === -1 || target < 0 || target >= stages.value.length) return;
    const next = [...stages.value];
    [next[index], next[target]] = [next[target]!, next[index]!];
    tab.value.pipeline = next;
}

async function copyPipeline() {
    try {
        await navigator.clipboard.writeText(wholeStatement());
        notifications.send({ subject: t("action.copied"), timeout: 1500 });
    } catch (error) {
        report(error);
    }
}

/** Takes an `aggregate` statement apart into rows: one copied here, or one of the history. */
function applyStatement(text: string) {
    try {
        const [statement] = parseStatements(text);
        if (!statement) return;
        tab.value.pipeline = stagesOf(statement);
        tab.value.aggregateOptions = optionsOf(statement) || undefined;
        showOptions.value = tab.value.aggregateOptions !== undefined;
        current.value = undefined;
        void tabs.runAggregate(tab.value);
    } catch (error) {
        report(error);
    }
}

async function pastePipeline() {
    try {
        applyStatement(await navigator.clipboard.readText());
    } catch (error) {
        report(error);
    }
}

function openInShell() {
    try {
        tabs.openShell({ connectionId: tab.value.connectionId, database: tab.value.database, text: wholeStatement() });
    } catch (error) {
        report(error);
    }
}

function createView() {
    try {
        dialogs.editCollection({ mode: "view", connectionId: tab.value.connectionId, database: tab.value.database, collection: collection.value, pipeline: pipelineText(stages.value) });
    } catch (error) {
        report(error);
    }
}
</script>

<template>
    <section class="h-full min-h-0 flex flex-col">
        <h1 class="m-0 shrink-0 h-13 flex items-end gap-3 px-5.5 pb-1.5 text-[21px] font-normal text-on-surface whitespace-nowrap overflow-hidden">
            <span data-testid="aggregate-title">{{ collection }}</span>
            <span class="text-on-surface/80">{{ $t("aggregate.title") }} · {{ tab.database }} @ {{ profile?.name }}</span>
        </h1>

        <template v-if="layout !== 'results'">
            <div class="h-8 shrink-0 flex items-center gap-0.5 px-5">
                <IconButton
                    @click="tabs.runAggregate(tab)"
                    :disabled="tab.running"
                    :icon="tab.running ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-play'"
                    :label="`${$t('query.run')} (F5)`"
                    data-testid="query-run"
                    tint="text-success"
                >
                    {{ $t("query.run") }}
                </IconButton>
                <IconButton
                    @click="tabs.runAggregate(tab, currentIndex)"
                    :disabled="tab.running || currentIndex === -1"
                    :label="$t('aggregate.preview')"
                    data-testid="stage-preview"
                    icon="i-lucide-step-forward"
                    tint="text-success"
                />
                <span class="toolbar-rule" />
                <DropMenu
                    :entries="stageEntries(addStage)"
                    :label="$t('stage.add')"
                >
                    <span
                        :title="$t('stage.add')"
                        class="h-6.5 min-w-6 px-1 inline-flex items-center justify-center rounded-sm text-on-surface hover:bg-on-surface/10"
                        data-testid="stage-add"
                    >
                        <span class="i-lucide-list-plus size-4 text-success" />
                    </span>
                </DropMenu>
                <IconButton
                    @click="removeStage"
                    :disabled="currentIndex === -1"
                    :label="$t('stage.remove')"
                    data-testid="stage-remove"
                    icon="i-lucide-list-x"
                    tint="text-error"
                />
                <IconButton
                    @click="move(-1)"
                    :disabled="currentIndex <= 0"
                    :label="$t('stage.up')"
                    data-testid="stage-up"
                    icon="i-lucide-arrow-up"
                />
                <IconButton
                    @click="move(1)"
                    :disabled="currentIndex === -1 || currentIndex === stages.length - 1"
                    :label="$t('stage.down')"
                    icon="i-lucide-arrow-down"
                />
                <span class="toolbar-rule" />
                <QueryHistory
                    @choose="applyStatement"
                    :connectionId="tab.connectionId"
                />
                <span class="toolbar-rule" />
                <ReadonlyToggle :tabId />
                <span class="toolbar-rule" />
                <IconButton
                    @click="copyPipeline"
                    :label="$t('aggregate.copy')"
                    icon="i-lucide-copy"
                />
                <IconButton
                    @click="pastePipeline"
                    :label="$t('aggregate.paste')"
                    icon="i-lucide-clipboard-paste"
                />
                <IconButton
                    @click="openInShell"
                    :label="$t('query.toShell')"
                    data-testid="query-to-shell"
                    icon="i-lucide-square-terminal"
                />
                <IconButton
                    @click="createView"
                    :label="$t('aggregate.createView')"
                    data-testid="aggregate-view"
                    icon="i-lucide-file-search"
                />
                <span class="toolbar-rule" />
                <IconButton
                    @click="showOptions = !showOptions"
                    :active="showOptions"
                    :label="$t('aggregate.options')"
                    data-testid="aggregate-options"
                    icon="i-lucide-sliders-horizontal"
                />
            </div>

            <div class="shrink-0 max-h-[50vh] overflow-y-auto mx-5 mt-1.5 mb-1 border-t border-divider">
                <div
                    v-for="stage in stages"
                    :key="stage.id"
                    @focusin="focusStage(stage)"
                    @mousedown="current = stage.id"
                    :class="current === stage.id ? 'border-l-primary' : 'border-l-transparent'"
                    class="flex items-start border-b border-divider border-l-3 py-0.5"
                    data-testid="pipeline-stage"
                >
                    <DropMenu
                        :entries="stageEntries(operator => changeStage(stage, operator))"
                        :label="$t('stage.change')"
                    >
                        <span
                            :title="$t('stage.change')"
                            class="w-36 shrink-0 h-6.5 mt-0.5 pl-4 pr-1 flex items-center gap-1 text-[13px] font-semibold text-on-surface-strong hover:text-primary"
                            data-testid="stage-operator"
                        >
                            {{ stage.operator }}
                            <span class="i-lucide-chevron-down size-3.5 text-on-surface-variant" />
                            <span
                                v-if="WRITING_STAGES.includes(stage.operator)"
                                :title="$t('aggregate.writes')"
                                class="i-lucide-pen-line size-3.5 text-warning"
                            />
                        </span>
                    </DropMenu>
                    <div
                        :class="stage.enabled ? '' : 'opacity-40'"
                        :style="{ height: height(stage) }"
                        class="grow min-w-0"
                    >
                        <CodeEditor
                            v-model="stage.text"
                            @run="tabs.runAggregate(tab)"
                            :environment="environmentAt(stage)"
                            :label="stage.operator"
                            :prefix="prefix(stage)"
                        />
                    </div>
                    <SwitchRoot
                        v-model="stage.enabled"
                        :label="$t('stage.enabled', { name: stage.operator })"
                        :title="$t('stage.enabled', { name: stage.operator })"
                        class="shrink-0 mx-3 mt-1.5"
                    >
                        <SwitchTrack class="w-7 h-4 flex items-center px-0.5 rounded-full bg-on-surface/15 data-[state=checked]:bg-primary/60">
                            <SwitchThumb class="size-3 rounded-full bg-on-surface-strong transition-transform data-[state=checked]:translate-x-3" />
                        </SwitchTrack>
                    </SwitchRoot>
                </div>
                <p
                    v-if="stages.length === 0"
                    class="m-0 px-5 py-2 text-on-surface-variant"
                >
                    {{ $t("aggregate.empty") }}
                </p>
                <div
                    v-if="showOptions"
                    class="h-8 flex items-center border-b border-divider border-l-3 border-l-transparent"
                    data-testid="aggregate-options-row"
                >
                    <span class="w-36 shrink-0 pl-4 text-[13px] font-semibold text-on-surface-variant">{{ $t("aggregate.options") }}</span>
                    <CodeEditor
                        v-model="options"
                        @run="tabs.runAggregate(tab)"
                        :environment
                        :label="$t('aggregate.options')"
                        :prefix="`db.getCollection(${JSON.stringify(collection)}).aggregate([], `"
                        class="grow"
                        singleLine
                    />
                </div>
            </div>
        </template>

        <ResultsPanel
            v-if="layout !== 'editor'"
            :tabId
            class="grow"
        />
    </section>
</template>
