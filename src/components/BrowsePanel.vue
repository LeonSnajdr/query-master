<script setup lang="ts">
import { SwitchRoot, SwitchThumb, SwitchTrack } from "@vuetify/v0";
import { computed, shallowRef } from "vue";
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
import { useValueSearch, useValueSources } from "@/composables/values";
import type { MenuEntry } from "@/menu";
import type { Environment } from "@/shell/complete";
import { preview } from "@/shell/ejson";
import type { Json } from "@/shell/ejson";
import { ShellError } from "@/shell/message";
import { convertQueryText, parseStatements } from "@/shell/parse";
import { useConnectionsStore } from "@/stores/connections";
import { STAGE_NAMES, browseStatement, useTabsStore } from "@/stores/tabs";
import type { Stage, StageName } from "@/stores/tabs";
import { useKeymap } from "@/keys/keymap";

/** A collection: the fields of its query above, the documents below. */
const props = defineProps<{
    tabId: string;
}>();

const { t } = useI18n();
const keymap = useKeymap();
const { report } = useMessages();
const notices = useNotices();
const { layout } = useLayout();
const connections = useConnectionsStore();
const tabs = useTabsStore();
// The store's own object: the stages and the read-only switch are changed here.
const tab = computed(() => tabs.tabs.find(item => item.id === props.tabId)!);
const profile = computed(() => connections.profiles.find(item => item.id === tab.value.connectionId));
const collection = computed(() => tab.value.collection ?? "");

/** The stage row that was clicked last; "Remove stage" takes it away. */
const current = shallowRef<StageName>("filter");

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

/** What each field continues, so the editor suggests what fits there. */
function prefix(name: StageName): string | undefined {
    const base = `db.getCollection(${JSON.stringify(collection.value)})`;
    switch (name) {
        case "filter": return `${base}.find(`;
        case "projection": return `${base}.find({}, `;
        case "sort": return `${base}.find({}).sort(`;
        default: return undefined;
    }
}

const missingStages = computed<MenuEntry[]>(() => STAGE_NAMES
    .filter(name => !tab.value.stages.some(stage => stage.name === name))
    .map(name => ({ label: name, action: () => addStage(name) })));

/** Rows that hold a document, which can be written in shell notation or as strict extended JSON. */
const DOCUMENT_STAGES: StageName[] = ["filter", "projection", "sort"];

/** The Json mode of a row (as the "Mongo JSON mode"): the text is written anew in the other notation. */
function toggleJson(stage: Stage) {
    try {
        stage.text = convertQueryText(stage.text, !stage.json);
        stage.json = !stage.json;
    } catch (error) {
        report(error);
    }
}

function addStage(name: StageName) {
    const text = name === "skip" ? "0" : name === "limit" ? "100" : "{ }";
    tab.value.stages.push({ name, text, enabled: true });
    tab.value.stages.sort((a, b) => STAGE_NAMES.indexOf(a.name) - STAGE_NAMES.indexOf(b.name));
    current.value = name;
}

function removeStage() {
    const index = tab.value.stages.findIndex(stage => stage.name === current.value);
    // The filter stays: a query without one has nothing to show its fields in.
    if (index > 0) tab.value.stages.splice(index, 1);
    current.value = "filter";
}

function resetFields() {
    tab.value.stages = [
        { name: "filter", text: "{ }", enabled: true },
        { name: "projection", text: "{ }", enabled: true },
        { name: "sort", text: "{ }", enabled: true }
    ];
    void tabs.runBrowse(tab.value);
}

async function copyQuery() {
    try {
        await navigator.clipboard.writeText(browseStatement(tab.value));
        notices.answer(t("action.copied"));
    } catch (error) {
        report(error);
    }
}

/** A value on one line, as the fields hold it. */
function line(value: Json | undefined, fallback: string): string {
    return value === undefined ? fallback : preview(value, Number.MAX_SAFE_INTEGER);
}

/** Takes a `find` statement apart into the fields: one copied here, or one of the history. */
function applyStatement(text: string) {
    try {
        const [statement] = parseStatements(text);
        if (!statement || statement.method !== "find") throw new ShellError("error.browse.notFind");
        const modifier = (name: string) => statement.modifiers.find(item => item.name === name)?.args[0];
        const stages: Stage[] = [
            { name: "filter", text: line(statement.args[0], "{ }"), enabled: true },
            { name: "projection", text: line(statement.args[1], "{ }"), enabled: true },
            { name: "sort", text: line(modifier("sort"), "{ }"), enabled: true }
        ];
        for (const name of ["skip", "limit"] as const) {
            const value = modifier(name);
            if (value !== undefined) stages.push({ name, text: line(value, ""), enabled: true });
        }
        tab.value.stages = stages;
        void tabs.runBrowse(tab.value);
    } catch (error) {
        report(error);
    }
}

async function pasteQuery() {
    try {
        applyStatement(await navigator.clipboard.readText());
    } catch (error) {
        report(error);
    }
}

function openInShell() {
    tabs.openShell({ connectionId: tab.value.connectionId, database: tab.value.database, text: browseStatement(tab.value) });
}
</script>

<template>
    <section class="h-full min-h-0 flex flex-col">
        <h1 class="m-0 shrink-0 h-13 flex items-end gap-3 px-5.5 pb-1.5 text-[21px] font-normal text-on-surface whitespace-nowrap overflow-hidden">
            <span data-testid="browse-title">{{ collection }}</span>
            <span class="text-on-surface/80">{{ tab.database }} @ {{ profile?.name }}</span>
        </h1>

        <template v-if="layout !== 'results'">
            <div class="h-8 shrink-0 flex items-center gap-0.5 px-5">
                <IconButton
                    @click="tabs.runBrowse(tab)"
                    :disabled="tab.running"
                    :icon="tab.running ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-play'"
                    :label="keymap.titled($t('query.run'), 'query.run')"
                    data-testid="query-run"
                    tint="text-success"
                >
                    {{ $t("query.run") }}
                </IconButton>
                <span class="toolbar-rule" />
                <DropMenu
                    :entries="missingStages.length > 0 ? missingStages : [{ label: $t('stage.all'), action: () => undefined, disabled: true }]"
                    :label="$t('stage.add')"
                >
                    <span
                        class="h-6.5 min-w-6 px-1 inline-flex items-center justify-center rounded-sm text-on-surface hover:bg-on-surface/10"
                        data-testid="stage-add"
                    >
                        <span class="i-lucide-list-plus size-4 text-success" />
                    </span>
                </DropMenu>
                <IconButton
                    @click="removeStage"
                    :disabled="current === 'filter'"
                    :label="$t('stage.remove')"
                    data-testid="stage-remove"
                    icon="i-lucide-list-x"
                    tint="text-error"
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
                    @click="copyQuery"
                    :label="$t('query.copy')"
                    icon="i-lucide-copy"
                />
                <IconButton
                    @click="pasteQuery"
                    :label="$t('query.paste')"
                    icon="i-lucide-clipboard-paste"
                />
                <IconButton
                    @click="openInShell"
                    :label="$t('query.toShell')"
                    data-testid="query-to-shell"
                    icon="i-lucide-square-terminal"
                />
                <span class="toolbar-rule" />
                <IconButton
                    @click="resetFields"
                    :label="$t('stage.reset')"
                    icon="i-lucide-list-restart"
                />
            </div>

            <div class="shrink-0 mx-5 mt-1.5 mb-1 border-t border-divider">
                <div
                    v-for="stage in tab.stages"
                    :key="stage.name"
                    @focusin="current = stage.name"
                    @mousedown="current = stage.name"
                    :class="current === stage.name ? 'border-l-primary' : 'border-l-transparent'"
                    class="h-8 flex items-center border-b border-divider border-l-3"
                    data-testid="stage-row"
                >
                    <span class="w-26 shrink-0 pl-5 text-[13px] font-semibold text-on-surface-strong">{{ stage.name }}</span>
                    <CodeEditor
                        v-model="stage.text"
                        @run="tabs.runBrowse(tab)"
                        :class="stage.enabled ? '' : 'opacity-40'"
                        :environment
                        :label="stage.name"
                        :prefix="prefix(stage.name)"
                        class="grow"
                        singleLine
                    />
                    <IconButton
                        v-if="DOCUMENT_STAGES.includes(stage.name)"
                        @click="toggleJson(stage)"
                        :active="stage.json === true"
                        :data-testid="`stage-json-${stage.name}`"
                        :label="$t('stage.json', { name: stage.name })"
                        class="shrink-0 ml-1"
                        icon="i-lucide-braces"
                    />
                    <SwitchRoot
                        v-model="stage.enabled"
                        :label="$t('stage.enabled', { name: stage.name })"
                        :title="$t('stage.enabled', { name: stage.name })"
                        class="shrink-0 mx-3"
                    >
                        <SwitchTrack class="w-7 h-4 flex items-center px-0.5 rounded-full bg-on-surface/15 data-[state=checked]:bg-primary/60">
                            <SwitchThumb class="size-3 rounded-full bg-on-surface-strong transition-transform data-[state=checked]:translate-x-3" />
                        </SwitchTrack>
                    </SwitchRoot>
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
