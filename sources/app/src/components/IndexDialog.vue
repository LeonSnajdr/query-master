<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogClose, DialogContent, DialogRoot, DialogTitle, SwitchRoot, SwitchThumb, SwitchTrack, TabsItem, TabsList, TabsPanel, TabsRoot } from "@vuetify/v0";
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import { namesAsChoices } from "@/choice";
import FormError from "@/components/FormError.vue";
import CodeEditor from "@/components/CodeEditor.vue";
import IconButton from "@/components/IconButton.vue";
import ChoiceField from "@/components/ChoiceField.vue";
import CollationFields from "@/components/CollationFields.vue";
import { useMessages } from "@/composables/messages";
import type { IndexRequest } from "@/composables/dialogs";
import type { Environment } from "@/shell/complete";
import { isDoc, toShell } from "@/shell/ejson";
import type { Doc } from "@/shell/ejson";
import { defaultIndexName, emptyIndexForm, hasKind, INDEX_KINDS, indexFormErrors, indexFormOf, indexKey, indexSpec, storedSpec, TEXT_LANGUAGES } from "@/shell/indexes";
import type { IndexForm } from "@/shell/indexes";
import { parseValue } from "@/shell/parse";
import { replyError } from "@/shell/plan";
import { useConnectionsStore } from "@/stores/connections";

/** Creates an index from rows of fields and its options, or a copy of an existing one. */
const props = defineProps<{
    request?: IndexRequest;
}>();
const open = defineModel<boolean>({ default: false });

/** The tabs of the index dialog. */
const INDEX_TABS = ["general", "text", "geo", "collation"] as const;

const { t } = useI18n();
const { say } = useMessages();
const connections = useConnectionsStore();

const form = ref<IndexForm>(emptyIndexForm());
const partialFilter = shallowRef("{}");
const busy = shallowRef(false);
const error = shallowRef<string>();

const kindOptions = computed(() => INDEX_KINDS.map(value => ({ value, label: t(`indexDialog.kind.${value}`) })));
const tab = shallowRef<typeof INDEX_TABS[number]>("general");
const hasText = computed(() => hasKind(form.value, "text"));
const hasFlat = computed(() => hasKind(form.value, "2d"));
const hasSphere = computed(() => hasKind(form.value, "2dsphere"));
const hasGeo = computed(() => hasFlat.value || hasSphere.value);
const languageOptions = computed(() => [{ value: "", label: t("collation.default") }, ...TEXT_LANGUAGES.map(value => ({ value, label: value }))]);
/** A choice of versions, with the server's default first. */
function versionOptions(versions: string[]) {
    return [{ value: "", label: t("collation.default") }, ...versions.map(value => ({ value, label: value }))];
}
const fields = computed(() => namesAsChoices(props.request ? connections.fieldsOf(props.request.connectionId, props.request.database, props.request.collection) : []));
const environment = computed<Environment | undefined>(() => {
    const request = props.request;
    if (!request) return undefined;
    return {
        serverVersion: connections.sessions[request.connectionId]?.version,
        databases: connections.sessions[request.connectionId]?.databases.map(database => database.name) ?? [],
        collections: connections.collectionsOf(request.connectionId, request.database),
        fields: name => connections.fieldsOf(request.connectionId, request.database, name),
        values: (name, field) => connections.sampleValuesOf(request.connectionId, request.database, name, field)
    };
});
const placeholderName = computed(() => defaultIndexName(indexKey(form.value.fields)));
/** A partial filter takes the place of sparse: the server refuses both together. */
const hasPartialFilter = computed(() => partialFilter.value.replace(/\s/g, "") !== "" && partialFilter.value.replace(/\s/g, "") !== "{}");
const problems = computed(() => [...indexFormErrors(form.value), ...(form.value.sparse && hasPartialFilter.value ? ["indexDialog.error.sparsePartial"] : [])]);
// A form without a field yet is how it starts, not a mistake to point out; saving waits for one.
/** Field names given more than once: their rows are framed red. */
const duplicates = computed(() => {
    const names = form.value.fields.map(row => row.field.trim()).filter(Boolean);
    return new Set(names.filter((name, index) => names.indexOf(name) !== index));
});
const ttlWrong = computed(() => problems.value.includes("indexDialog.error.ttl"));
const shownProblems = computed(() => problems.value.filter(key => key !== "indexDialog.error.noField").map(key => t(key)));
const title = computed(() => {
    const request = props.request;
    if (!request) return "";
    return request.recreate ? t("indexDialog.title.recreate", { name: String(request.index?.name) }) : t("indexDialog.title", { collection: request.collection });
});

watch([open, () => props.request], async ([isOpen]) => {
    if (!isOpen || !props.request) return;
    await nextTick();
    tab.value = "general";
    error.value = undefined;
    const source = props.request.index;
    form.value = source ? indexFormOf(source) : emptyIndexForm();
    // A copy needs a name of its own; the derived one would be taken.
    if (source && !props.request.recreate) form.value.name = "";
    partialFilter.value = form.value.partialFilter ? toShell(form.value.partialFilter) : "{}";
});

function addField() {
    form.value.fields.push({ field: "", kind: "1" });
}

function removeField(position: number) {
    form.value.fields.splice(position, 1);
    if (form.value.fields.length === 0) addField();
}

function move(position: number, by: number) {
    const target = position + by;
    if (target < 0 || target >= form.value.fields.length) return;
    const [row] = form.value.fields.splice(position, 1);
    form.value.fields.splice(target, 0, row!);
}

async function save() {
    const request = props.request;
    if (!request || problems.value.length > 0) return;
    error.value = undefined;
    busy.value = true;
    try {
        const filter = partialFilter.value.trim() ? parseValue(partialFilter.value) : {};
        if (!isDoc(filter)) throw new Error(`${t("indexDialog.partialFilter")}: ${t("document.error.notDocument")}`);
        const spec = indexSpec({ ...form.value, partialFilter: filter });
        const create = async (index: Doc) => {
            const failure = replyError(await backend.runCommand(request.connectionId, request.database, { createIndexes: request.collection, indexes: [index] }));
            if (failure) throw new Error(say(failure));
        };
        const old = request.recreate ? request.index : undefined;
        if (old) await backend.runCommand(request.connectionId, request.database, { dropIndexes: request.collection, index: String(old.name) });
        try {
            await create(spec);
        } catch (cause) {
            // The new definition was refused: the old index comes back, so nothing is lost.
            if (old) await create(storedSpec(old)).catch(() => undefined);
            throw cause;
        }
        open.value = false;
        await connections.loadIndexes(request.connectionId, request.database, request.collection);
    } catch (cause) {
        error.value = say(errorMessage(cause));
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <DialogRoot v-model="open">
        <DialogContent class="dialog w-[min(94vw,36rem)]!">
            <form
                @submit.prevent="save"
                class="flex flex-col gap-4 text-[13px]"
            >
                <DialogTitle class="dialog-title text-[21px]!">
                    {{ title }}
                </DialogTitle>

                <div class="flex flex-col gap-1.5">
                    <span>{{ $t("indexDialog.fields") }}</span>
                    <div
                        v-for="(row, position) in form.fields"
                        :key="position"
                        class="flex items-center gap-1.5"
                        data-testid="index-field-row"
                    >
                        <div
                            :aria-invalid="duplicates.has(row.field.trim()) || undefined"
                            :class="duplicates.has(row.field.trim()) ? 'within-invalid' : ''"
                            class="grow min-w-0"
                        >
                            <ChoiceField
                                v-model="row.field"
                                :label="$t('indexDialog.field')"
                                :options="fields"
                                :placeholder="$t('indexDialog.field')"
                                class="font-mono"
                                data-testid="index-field"
                                free
                            />
                        </div>
                        <div class="w-36">
                            <ChoiceField
                                v-model="row.kind"
                                :label="$t('indexDialog.kind')"
                                :options="kindOptions"
                            />
                        </div>
                        <IconButton
                            @click="move(position, -1)"
                            :disabled="position === 0"
                            :label="$t('indexDialog.up')"
                            icon="i-lucide-arrow-up"
                        />
                        <IconButton
                            @click="move(position, 1)"
                            :disabled="position === form.fields.length - 1"
                            :label="$t('indexDialog.down')"
                            icon="i-lucide-arrow-down"
                        />
                        <IconButton
                            @click="removeField(position)"
                            :label="$t('indexDialog.removeField')"
                            icon="i-lucide-x"
                        />
                    </div>
                    <ButtonRoot
                        @click="addField"
                        class="btn-ghost self-start"
                        data-testid="index-add-field"
                    >
                        <ButtonContent class="inline-flex items-center gap-1.5">
                            <span class="i-lucide-plus" />{{ $t("indexDialog.addField") }}
                        </ButtonContent>
                    </ButtonRoot>
                </div>

                <TabsRoot
                    v-model="tab"
                    mandatory
                >
                    <TabsList
                        :label="title"
                        class="flex border-b border-divider"
                    >
                        <TabsItem
                            v-for="item in INDEX_TABS"
                            :key="item"
                            :class="item === 'text' && !hasText || item === 'geo' && !hasGeo ? 'opacity-50' : ''"
                            :data-testid="`index-tab-${item}`"
                            :value="item"
                            class="h-8 px-3 text-[13px] text-on-surface border-b-2 border-transparent hover:text-on-surface-strong data-[selected]:text-primary data-[selected]:border-primary"
                        >
                            {{ $t(`indexDialog.tab.${item}`) }}
                        </TabsItem>
                    </TabsList>
                    <div class="min-h-72 pt-4">
                        <TabsPanel
                            class="flex flex-col gap-4"
                            value="general"
                        >
                            <div class="form-grid grid-cols-[10rem_1fr]!">
                                <span>{{ $t("indexDialog.name") }}:</span>
                                <input
                                    v-model="form.name"
                                    :placeholder="placeholderName"
                                    class="field font-mono"
                                    data-testid="index-name"
                                    spellcheck="false"
                                />
                                <template
                                    v-for="option in (['unique', 'sparse', 'hidden'] as const)"
                                    :key="option"
                                >
                                    <span>{{ $t(`indexDialog.${option}`) }}:</span>
                                    <SwitchRoot
                                        v-model="form[option]"
                                        :class="option === 'sparse' && hasPartialFilter && !form.sparse ? 'opacity-40' : ''"
                                        :data-testid="`index-${option}`"
                                        :disabled="option === 'sparse' && hasPartialFilter && !form.sparse"
                                        :label="$t(`indexDialog.${option}`)"
                                    >
                                        <SwitchTrack class="switch-track">
                                            <SwitchThumb class="switch-thumb" />
                                        </SwitchTrack>
                                    </SwitchRoot>
                                </template>
                                <span>{{ $t("indexDialog.ttl") }}:</span>
                                <input
                                    v-model="form.ttl"
                                    :aria-invalid="ttlWrong || undefined"
                                    :class="ttlWrong ? 'field-invalid' : ''"
                                    :placeholder="$t('indexDialog.ttl.placeholder')"
                                    class="field w-36"
                                    data-testid="index-ttl"
                                    inputmode="numeric"
                                />
                            </div>

                            <div class="flex flex-col gap-1.5">
                                <span>{{ $t("indexDialog.partialFilter") }}</span>
                                <div class="h-28 rounded-sm bg-background border border-divider">
                                    <CodeEditor
                                        v-model="partialFilter"
                                        :environment
                                        :label="$t('indexDialog.partialFilter')"
                                        :prefix="request ? `db.getCollection(${JSON.stringify(request.collection)}).find(` : undefined"
                                    />
                                </div>
                            </div>
                        </TabsPanel>

                        <!-- The options of a text index; grey without a text field. -->
                        <TabsPanel value="text">
                            <div
                                :class="hasText ? '' : 'opacity-50 pointer-events-none'"
                                class="form-grid grid-cols-[10rem_1fr]!"
                            >
                                <span>{{ $t("indexDialog.text.language") }}:</span>
                                <ChoiceField
                                    v-model="form.text.defaultLanguage"
                                    :disabled="!hasText"
                                    :label="$t('indexDialog.text.language')"
                                    :options="languageOptions"
                                    data-testid="index-text-language"
                                    free
                                />
                                <span>{{ $t("indexDialog.text.override") }}:</span>
                                <input
                                    v-model="form.text.languageOverride"
                                    :disabled="!hasText"
                                    class="field font-mono"
                                    placeholder="language"
                                    spellcheck="false"
                                />
                                <span>{{ $t("indexDialog.text.version") }}:</span>
                                <ChoiceField
                                    v-model="form.text.version"
                                    :disabled="!hasText"
                                    :label="$t('indexDialog.text.version')"
                                    :options="versionOptions(['1', '2', '3'])"
                                />
                                <span class="self-start pt-1.5">{{ $t("indexDialog.text.weights") }}:</span>
                                <div class="h-24 rounded-sm bg-background border border-divider">
                                    <CodeEditor
                                        v-model="form.text.weights"
                                        :label="$t('indexDialog.text.weights')"
                                        :placeholder="$t('indexDialog.text.weights.placeholder')"
                                        :readonly="!hasText"
                                    />
                                </div>
                            </div>
                            <p
                                v-if="!hasText"
                                class="mt-3 mb-0 text-on-surface-variant"
                            >
                                {{ $t("indexDialog.text.none") }}
                            </p>
                        </TabsPanel>

                        <!-- Bounds and precision of a 2d index, the version of a 2dsphere index. -->
                        <TabsPanel value="geo">
                            <div class="form-grid grid-cols-[10rem_1fr]!">
                                <template
                                    v-for="bound in (['min', 'max', 'bits'] as const)"
                                    :key="bound"
                                >
                                    <span :class="hasFlat ? '' : 'opacity-50'">{{ $t(`indexDialog.geo.${bound}`) }}:</span>
                                    <input
                                        v-model="form.geo[bound]"
                                        :class="hasFlat ? '' : 'opacity-50'"
                                        :disabled="!hasFlat"
                                        :placeholder="$t(`indexDialog.geo.${bound}.placeholder`)"
                                        class="field w-36"
                                        inputmode="decimal"
                                    />
                                </template>
                                <span :class="hasSphere ? '' : 'opacity-50'">{{ $t("indexDialog.geo.sphereVersion") }}:</span>
                                <ChoiceField
                                    v-model="form.geo.sphereVersion"
                                    :disabled="!hasSphere"
                                    :label="$t('indexDialog.geo.sphereVersion')"
                                    :options="versionOptions(['1', '2', '3'])"
                                />
                            </div>
                            <p
                                v-if="!hasGeo"
                                class="mt-3 mb-0 text-on-surface-variant"
                            >
                                {{ $t("indexDialog.geo.none") }}
                            </p>
                        </TabsPanel>

                        <TabsPanel value="collation">
                            <CollationFields v-model="form.collation" />
                        </TabsPanel>
                    </div>
                </TabsRoot>

                <div class="flex justify-end gap-2">
                    <FormError
                        :text="error ?? (shownProblems.join(' ') || undefined)"
                        data-testid="index-error"
                    />
                    <ButtonRoot
                        @click="save"
                        :disabled="busy || problems.length > 0"
                        class="btn-primary"
                        data-testid="index-save"
                    >
                        <ButtonContent>{{ $t(request?.recreate ? "action.save" : "action.create") }}</ButtonContent>
                    </ButtonRoot>
                    <DialogClose class="btn-secondary">
                        {{ $t("action.cancel") }}
                    </DialogClose>
                </div>
            </form>
        </DialogContent>
    </DialogRoot>
</template>
