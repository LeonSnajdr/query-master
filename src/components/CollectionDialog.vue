<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogClose, DialogContent, DialogRoot, DialogTitle, SwitchRoot, SwitchThumb, SwitchTrack, TabsItem, TabsList, TabsPanel, TabsRoot } from "@vuetify/v0";
import { computed, nextTick, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import FormError from "@/components/FormError.vue";
import CodeEditor from "@/components/CodeEditor.vue";
import ChoiceField from "@/components/ChoiceField.vue";
import { useMessages } from "@/composables/messages";
import type { CollectionRequest } from "@/composables/dialogs";
import { isDoc, toShell } from "@/shell/ejson";
import type { Doc, Json } from "@/shell/ejson";
import { parseValue } from "@/shell/parse";
import { replyError } from "@/shell/plan";
import { useConnectionsStore } from "@/stores/connections";

/**
 * Creates a collection or a view, or changes the validator of a collection; laid out as a
 * "Create collection" dialog, with time series added (MongoDB 5.0 and later).
 */
const props = defineProps<{
    request?: CollectionRequest;
}>();
const open = defineModel<boolean>({ default: false });

const LEVELS = ["off", "strict", "moderate"] as const;
const ACTIONS = ["error", "warn"] as const;
const GRANULARITIES = ["seconds", "minutes", "hours"] as const;
/** Collation locales offered; MongoDB knows more, typed ones are taken too. */
const LOCALES = ["", "simple", "de", "en", "en_US", "es", "fr", "it", "nl", "pl", "pt", "sv", "tr", "zh"];

const { t } = useI18n();
const { say } = useMessages();
const connections = useConnectionsStore();

const tab = shallowRef("options");
const name = shallowRef("");
const capped = shallowRef(false);
const size = shallowRef("");
const max = shallowRef("");
const timeSeries = shallowRef(false);
const timeField = shallowRef("");
const metaField = shallowRef("");
const granularity = shallowRef<typeof GRANULARITIES[number]>("seconds");
const level = shallowRef<typeof LEVELS[number]>("off");
const action = shallowRef<typeof ACTIONS[number]>("error");
const validator = shallowRef("{\n    \n}");
const locale = shallowRef("");
const viewOn = shallowRef("");
const pipeline = shallowRef("[\n    \n]");
const busy = shallowRef(false);
const error = shallowRef<string>();

const mode = computed(() => props.request?.mode ?? "collection");
const tabs = computed(() => (mode.value === "view" ? ["view", "collation"] : mode.value === "validator" ? ["validator"] : ["options", "validator", "collation"]));
const collections = computed(() => (props.request ? connections.collectionsOf(props.request.connectionId, props.request.database) : []));
const option = <T extends string>(values: readonly T[], prefix: string) => values.map(value => ({ value, label: t(`${prefix}.${value}`) }));
const localeOptions = computed(() => LOCALES.map(value => ({ value, label: value || t("collectionDialog.locale.none") })));
const sourceOptions = computed(() => collections.value.map(value => ({ value, label: value })));
const title = computed(() => t(`collectionDialog.title.${mode.value}`));

/** The current validator of the collection, to edit it. */
async function loadValidator(request: CollectionRequest) {
    const page = await backend.runCursorCommand(request.connectionId, request.database, { listCollections: 1, filter: { name: request.collection ?? "" } }, 1);
    const options = page.documents[0]?.options;
    if (!isDoc(options)) return;
    if (isDoc(options.validator)) validator.value = toShell(options.validator);
    level.value = LEVELS.find(value => value === options.validationLevel) ?? "strict";
    action.value = ACTIONS.find(value => value === options.validationAction) ?? "error";
}

// Also a new request while the dialog counts as open (closed with Escape, opened again) starts afresh.
watch([open, () => props.request], async ([isOpen]) => {
    if (!isOpen || !props.request) return;
    error.value = undefined;
    await nextTick();
    tab.value = tabs.value[0]!;
    name.value = props.request.collection ?? "";
    capped.value = false;
    size.value = "";
    max.value = "";
    timeSeries.value = false;
    timeField.value = "";
    metaField.value = "";
    level.value = mode.value === "validator" ? "strict" : "off";
    action.value = "error";
    validator.value = "{\n    \n}";
    locale.value = "";
    viewOn.value = props.request.collection ?? collections.value[0] ?? "";
    pipeline.value = props.request.pipeline ?? "[\n    \n]";
    if (mode.value === "validator") await loadValidator(props.request).catch(cause => (error.value = say(errorMessage(cause))));
    // A proposal (the schema analysis) replaces the current validator; level and action stay as read.
    if (props.request?.validator) validator.value = props.request.validator;
});

function parse(text: string, what: string): Json {
    try {
        return parseValue(text);
    } catch (cause) {
        throw new Error(`${what}: ${say(errorMessage(cause))}`);
    }
}

function number(text: string): number | undefined {
    const value = Number(text);
    return text.trim() !== "" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** The command the dialog stands for. */
function command(): Doc {
    const validatorValue = parse(validator.value, t("collectionDialog.tab.validator"));
    if (!isDoc(validatorValue)) throw new Error(t("document.error.notDocument"));
    const validation: Doc = Object.keys(validatorValue).length > 0 || mode.value === "validator"
        ? { validator: validatorValue, validationLevel: level.value, validationAction: action.value }
        : {};
    const collation: Doc = locale.value ? { collation: { locale: locale.value } } : {};
    if (mode.value === "validator") return { collMod: name.value, ...validation };
    if (mode.value === "view") {
        const stages = parse(pipeline.value, t("collectionDialog.pipeline"));
        if (!Array.isArray(stages)) throw new Error(t("collectionDialog.error.pipeline"));
        return { create: name.value.trim(), viewOn: viewOn.value, pipeline: stages, ...collation };
    }
    const result: Doc = { create: name.value.trim() };
    if (capped.value) {
        const bytes = number(size.value);
        if (bytes === undefined) throw new Error(t("collectionDialog.error.size"));
        Object.assign(result, { capped: true, size: bytes }, number(max.value) === undefined ? {} : { max: number(max.value)! });
    }
    if (timeSeries.value) {
        if (!timeField.value.trim()) throw new Error(t("collectionDialog.error.timeField"));
        result.timeseries = { timeField: timeField.value.trim(), ...(metaField.value.trim() ? { metaField: metaField.value.trim() } : {}), granularity: granularity.value };
    }
    return { ...result, ...validation, ...collation };
}

async function save() {
    const request = props.request;
    if (!request) return;
    error.value = undefined;
    busy.value = true;
    try {
        const reply = await backend.runCommand(request.connectionId, request.database, command());
        const failure = replyError(reply);
        if (failure) throw new Error(say(failure));
        open.value = false;
        await connections.loadDatabases(request.connectionId);
    } catch (cause) {
        error.value = say(errorMessage(cause));
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <DialogRoot v-model="open">
        <DialogContent class="dialog w-[min(94vw,32rem)]!">
            <form
                @submit.prevent="save"
                class="flex flex-col gap-4"
            >
                <DialogTitle class="dialog-title text-[21px]!">
                    {{ title }}
                </DialogTitle>

                <label class="flex items-center gap-3">
                    <span class="w-14 text-[13px]">{{ $t("connection.field.name") }}:</span>
                    <input
                        v-model="name"
                        :disabled="mode === 'validator'"
                        class="field grow disabled:opacity-60"
                        data-testid="collection-name"
                        spellcheck="false"
                    />
                </label>

                <!-- Built anew per kind of dialog: the tabs differ, and a tab only selects once it is there. -->
                <TabsRoot
                    :key="mode"
                    v-model="tab"
                    mandatory
                >
                    <TabsList
                        :label="title"
                        class="flex border-b border-divider"
                    >
                        <TabsItem
                            v-for="item in tabs"
                            :key="item"
                            :data-testid="`collection-tab-${item}`"
                            :value="item"
                            class="h-8 px-3 text-[13px] text-on-surface border-b-2 border-transparent hover:text-on-surface-strong data-[selected]:text-primary data-[selected]:border-primary"
                        >
                            {{ $t(`collectionDialog.tab.${item}`) }}
                        </TabsItem>
                    </TabsList>

                    <div class="min-h-72 pt-4 text-[13px]">
                        <TabsPanel
                            class="form-grid grid-cols-[12rem_1fr]!"
                            value="options"
                        >
                            <span>{{ $t("collectionDialog.capped") }}:</span>
                            <SwitchRoot
                                v-model="capped"
                                :label="$t('collectionDialog.capped')"
                            >
                                <SwitchTrack class="switch-track">
                                    <SwitchThumb class="switch-thumb" />
                                </SwitchTrack>
                            </SwitchRoot>
                            <span>{{ $t("collectionDialog.size") }}:</span>
                            <input
                                v-model="size"
                                :disabled="!capped"
                                :placeholder="$t('collectionDialog.size.placeholder')"
                                class="field w-36 disabled:opacity-50"
                                inputmode="numeric"
                            />
                            <span>{{ $t("collectionDialog.max") }}:</span>
                            <input
                                v-model="max"
                                :disabled="!capped"
                                :placeholder="$t('collectionDialog.max.placeholder')"
                                class="field w-36 disabled:opacity-50"
                                inputmode="numeric"
                            />
                            <span class="pt-3 border-t border-divider">{{ $t("collectionDialog.timeSeries") }}:</span>
                            <span class="pt-3 border-t border-divider">
                                <SwitchRoot
                                    v-model="timeSeries"
                                    :label="$t('collectionDialog.timeSeries')"
                                >
                                    <SwitchTrack class="switch-track">
                                        <SwitchThumb class="switch-thumb" />
                                    </SwitchTrack>
                                </SwitchRoot>
                            </span>
                            <template v-if="timeSeries">
                                <span>{{ $t("collectionDialog.timeField") }}:</span>
                                <input
                                    v-model="timeField"
                                    class="field"
                                    spellcheck="false"
                                />
                                <span>{{ $t("collectionDialog.metaField") }}:</span>
                                <input
                                    v-model="metaField"
                                    class="field"
                                    spellcheck="false"
                                />
                                <span>{{ $t("collectionDialog.granularity") }}:</span>
                                <ChoiceField
                                    v-model="granularity"
                                    :label="$t('collectionDialog.granularity')"
                                    :options="option(GRANULARITIES, 'collectionDialog.granularity')"
                                />
                            </template>
                        </TabsPanel>

                        <TabsPanel
                            class="flex flex-col gap-2"
                            value="validator"
                        >
                            <div class="form-grid">
                                <span>{{ $t("collectionDialog.level") }}:</span>
                                <ChoiceField
                                    v-model="level"
                                    :label="$t('collectionDialog.level')"
                                    :options="option(LEVELS, 'collectionDialog.level')"
                                />
                                <span>{{ $t("collectionDialog.action") }}:</span>
                                <ChoiceField
                                    v-model="action"
                                    :label="$t('collectionDialog.action')"
                                    :options="option(ACTIONS, 'collectionDialog.action')"
                                />
                            </div>
                            <span class="mt-2 pt-3 border-t border-divider">{{ $t("collectionDialog.validator") }}</span>
                            <div class="h-44 rounded-sm bg-background border border-divider">
                                <CodeEditor
                                    v-model="validator"
                                    :label="$t('collectionDialog.validator')"
                                />
                            </div>
                        </TabsPanel>

                        <TabsPanel
                            class="flex flex-col gap-2"
                            value="view"
                        >
                            <div class="form-grid">
                                <span>{{ $t("collectionDialog.viewOn") }}:</span>
                                <ChoiceField
                                    v-model="viewOn"
                                    :label="$t('collectionDialog.viewOn')"
                                    :options="sourceOptions"
                                />
                            </div>
                            <span class="mt-2">{{ $t("collectionDialog.pipeline") }}</span>
                            <div class="h-52 rounded-sm bg-background border border-divider">
                                <CodeEditor
                                    v-model="pipeline"
                                    :label="$t('collectionDialog.pipeline')"
                                />
                            </div>
                        </TabsPanel>

                        <TabsPanel
                            class="form-grid"
                            value="collation"
                        >
                            <span>{{ $t("collectionDialog.locale") }}:</span>
                            <ChoiceField
                                v-model="locale"
                                :label="$t('collectionDialog.locale')"
                                :options="localeOptions"
                            />
                        </TabsPanel>
                    </div>
                </TabsRoot>

                <div class="flex justify-end gap-2">
                    <FormError
                        :text="error"
                        data-testid="collection-error"
                    />
                    <ButtonRoot
                        @click="save"
                        :disabled="busy || !name.trim()"
                        class="btn-primary"
                        data-testid="collection-save"
                    >
                        <ButtonContent>{{ $t("action.save") }}</ButtonContent>
                    </ButtonRoot>
                    <DialogClose class="btn-secondary">
                        {{ $t("action.cancel") }}
                    </DialogClose>
                </div>
            </form>
        </DialogContent>
    </DialogRoot>
</template>
