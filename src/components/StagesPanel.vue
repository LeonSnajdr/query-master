<script setup lang="ts">
import { SwitchRoot, SwitchThumb, SwitchTrack } from "@vuetify/v0";
import { computed, reactive, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { backend } from "@/api";
import CodeEditor from "@/components/CodeEditor.vue";
import DropMenu from "@/components/DropMenu.vue";
import IconButton from "@/components/IconButton.vue";
import QueryHistory from "@/components/QueryHistory.vue";
import SaveQueryStar from "@/components/SaveQueryStar.vue";
import ReadonlyToggle from "@/components/ReadonlyToggle.vue";
import ResultsPanel from "@/components/results/ResultsPanel.vue";
import { useDialogs } from "@/composables/dialogs";
import { useLayout } from "@/composables/layout";
import { useMessages } from "@/composables/messages";
import { useNotices } from "@/composables/notices";
import { useValueSearch, useValueSources } from "@/composables/values";
import type { MenuEntry } from "@/menu";
import { STAGES } from "@/shell/catalog";
import type { Environment } from "@/shell/complete";
import { convertQueryText, parseStatements, parseValue } from "@/shell/parse";
import type { Json } from "@/shell/ejson";
import { browseStages, keepsDocuments, moveItem, newStage, optionsOf, pipelineText, stagesOfQuery, WRITING_STAGES } from "@/shell/pipeline";
import type { PipelineStage } from "@/shell/pipeline";
import { collectFields, useConnectionsStore } from "@/stores/connections";
import { stagesStatement, useTabsStore } from "@/stores/tabs";
import { useKeymap } from "@/keys/keymap";

/**
 * The stage builder of a collection and of the aggregation: the stages as rows above, the result
 * below. Both offer the same: any stage, moved by its grip or the arrows, switched off, in Json
 * mode. A collection runs as `find` while its stages are those of one, else as a pipeline.
 */
const props = defineProps<{
    tabId: string;
}>();

/** Lines a stage editor grows to before it scrolls. */
const MAX_LINES = 14;

const { t } = useI18n();
const keymap = useKeymap();
const { report } = useMessages();
const notices = useNotices();
const dialogs = useDialogs();
const { layout } = useLayout();
const connections = useConnectionsStore();
const tabs = useTabsStore();
// The store's own object: the stages and the read-only switch are changed here.
const tab = computed(() => tabs.tabs.find(item => item.id === props.tabId)!);
const profile = computed(() => connections.profiles.find(item => item.id === tab.value.connectionId));
const collection = computed(() => tab.value.collection ?? "");
const stages = computed(() => tab.value.pipeline ?? []);
const isBrowse = computed(() => tab.value.kind === "browse");

/** The stage that was clicked last; remove and move act on it. */
const current = shallowRef<number>();
/** The row of options (`allowDiskUse`, `maxTimeMS` …) shows; it does by itself when it holds some. */
const showOptions = shallowRef((tab.value.aggregateOptions ?? "").replace(/[\s{}]/g, "") !== "");
const options = computed({
    get: () => tab.value.aggregateOptions ?? "{ }",
    set: (text: string) => (tab.value.aggregateOptions = text)
});
const wholeStatement = () => stagesStatement(tab.value);
const run = (upTo?: number) => tabs.runStages(tab.value, upTo);
const currentIndex = computed(() => stages.value.findIndex(stage => stage.id === current.value));

const values = useValueSources(() => tab.value);
const search = useValueSearch(() => tab.value);

const environment = computed<Environment>(() => ({
    serverVersion: connections.sessions[tab.value.connectionId]?.version,
    databases: connections.sessions[tab.value.connectionId]?.databases.map(database => database.name) ?? [],
    collections: connections.collectionsOf(tab.value.connectionId, tab.value.database),
    fields: name => connections.fieldsOf(tab.value.connectionId, tab.value.database, name),
    values,
    search
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
    // Values are those of the collection only while the stages before keep its documents.
    const before = stages.value.slice(0, position).filter(item => item.enabled && !WRITING_STAGES.includes(item.operator));
    return { ...environment.value, fields: () => fieldsAt(position), ...(keepsDocuments(before) ? {} : { values: undefined, search: undefined }) };
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

/** The Json mode of a row (as the "Mongo JSON mode"): the text is written anew in the other notation. */
function toggleJson(stage: PipelineStage) {
    try {
        stage.text = convertQueryText(stage.text, !stage.json);
        stage.json = !stage.json;
    } catch (error) {
        report(error);
    }
}

/** The stages a new tab of this kind starts with; runs again. */
function resetStages() {
    tab.value.pipeline = isBrowse.value ? browseStages() : [newStage("$match", "{ }")];
    tab.value.aggregateOptions = undefined;
    showOptions.value = false;
    current.value = undefined;
    void run();
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
    tab.value.pipeline = moveItem(stages.value, index, target);
}

/** The stage being dragged to another place in the pipeline. */
const draggedId = shallowRef<number>();
/** How far the pointer moves before a press on the grip becomes a drag. */
const DRAG_DISTANCE = 4;

/** Dragging a stage by its grip moves it up or down, past the middle of each stage it crosses. */
function startStageDrag(event: PointerEvent, stage: PipelineStage): void {
    if (event.button !== 0) return;
    event.preventDefault();
    current.value = stage.id;
    const list = (event.currentTarget as HTMLElement).closest("[data-stage-list]")!;
    const start = event.clientY;
    const drag = (moved: PointerEvent) => {
        if (draggedId.value === undefined) {
            if (Math.abs(moved.clientY - start) < DRAG_DISTANCE) return;
            draggedId.value = stage.id;
        }
        const others = [...list.querySelectorAll<HTMLElement>("[data-stage-id]")].filter(item => Number(item.dataset.stageId) !== stage.id);
        const index = others.filter((item) => {
            const box = item.getBoundingClientRect();
            return box.top + box.height / 2 < moved.clientY;
        }).length;
        const from = stages.value.findIndex(item => item.id === stage.id);
        if (from !== index) tab.value.pipeline = moveItem(stages.value, from, index);
    };
    const end = () => {
        draggedId.value = undefined;
        window.removeEventListener("pointermove", drag);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", drag);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
}

async function copyPipeline() {
    try {
        await navigator.clipboard.writeText(wholeStatement());
        notices.answer(t("action.copied"));
    } catch (error) {
        report(error);
    }
}

/** Takes a `find` or `aggregate` statement apart into rows: one copied here, or one of the history. */
function applyStatement(text: string) {
    try {
        const [statement] = parseStatements(text);
        if (!statement) return;
        tab.value.pipeline = stagesOfQuery(statement);
        tab.value.aggregateOptions = statement.method === "aggregate" ? optionsOf(statement) || undefined : undefined;
        showOptions.value = tab.value.aggregateOptions !== undefined;
        current.value = undefined;
        void run();
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
            <span :data-testid="isBrowse ? 'browse-title' : 'aggregate-title'">{{ collection }}</span>
            <span
                v-if="isBrowse"
                class="text-on-surface/80"
            >{{ tab.database }} @ {{ profile?.name }}</span>
            <span
                v-else
                class="text-on-surface/80"
            >{{ $t("aggregate.title") }} · {{ tab.database }} @ {{ profile?.name }}</span>
        </h1>

        <template v-if="layout !== 'results'">
            <div class="h-8 shrink-0 flex items-center gap-0.5 px-5">
                <IconButton
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
                    @click="run(currentIndex)"
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
                    data-testid="stage-down"
                    icon="i-lucide-arrow-down"
                />
                <span class="toolbar-rule" />
                <QueryHistory
                    @choose="applyStatement"
                    :connectionId="tab.connectionId"
                    :tabId="tab.id"
                />
                <SaveQueryStar :tabId="tab.id" />
                <span class="toolbar-rule" />
                <ReadonlyToggle :tabId />
                <span class="toolbar-rule" />
                <IconButton
                    @click="copyPipeline"
                    :label="isBrowse ? $t('query.copy') : $t('aggregate.copy')"
                    icon="i-lucide-copy"
                />
                <IconButton
                    @click="pastePipeline"
                    :label="isBrowse ? $t('query.paste') : $t('aggregate.paste')"
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
                <IconButton
                    @click="resetStages"
                    :label="$t('stage.reset')"
                    data-testid="stage-reset"
                    icon="i-lucide-list-restart"
                />
            </div>

            <div
                class="shrink-0 max-h-[50vh] overflow-y-auto mx-5 mt-1.5 mb-1 border-t border-divider"
                data-stage-list
            >
                <div
                    v-for="stage in stages"
                    :key="stage.id"
                    @focusin="focusStage(stage)"
                    @mousedown="current = stage.id"
                    :class="[current === stage.id ? 'border-l-primary' : 'border-l-transparent', draggedId === stage.id ? 'bg-primary/10' : '']"
                    :data-stage-id="stage.id"
                    class="flex items-start border-b border-divider border-l-3 py-0.5"
                    data-testid="pipeline-stage"
                >
                    <span
                        @pointerdown="startStageDrag($event, stage)"
                        :class="draggedId === stage.id ? 'cursor-grabbing' : 'cursor-grab'"
                        :title="$t('stage.drag')"
                        class="shrink-0 w-4 h-6.5 mt-0.5 -mr-3 flex items-center justify-center text-on-surface-variant hover:text-on-surface-strong"
                        data-testid="stage-grip"
                    >
                        <span class="i-lucide-grip-vertical size-3.5" />
                    </span>
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
                            @run="run()"
                            :environment="environmentAt(stage)"
                            :label="stage.operator"
                            :prefix="prefix(stage)"
                        />
                    </div>
                    <IconButton
                        @click="toggleJson(stage)"
                        :active="stage.json === true"
                        :data-testid="`stage-json-${stage.operator}`"
                        :label="$t('stage.json', { name: stage.operator })"
                        class="shrink-0 ml-1 mt-0.5"
                        icon="i-lucide-braces"
                    />
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
                        @run="run()"
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
