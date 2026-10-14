<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogClose, DialogContent, DialogRoot, DialogTitle, SwitchRoot, SwitchThumb, SwitchTrack } from "@vuetify/v0";
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import { namesAsChoices } from "@/choice";
import CodeEditor from "@/components/CodeEditor.vue";
import IconButton from "@/components/IconButton.vue";
import ChoiceField from "@/components/ChoiceField.vue";
import { useMessages } from "@/composables/messages";
import type { IndexRequest } from "@/composables/dialogs";
import type { Environment } from "@/shell/complete";
import { isDoc, toShell } from "@/shell/ejson";
import type { Doc } from "@/shell/ejson";
import { defaultIndexName, emptyIndexForm, INDEX_KINDS, indexFormErrors, indexFormOf, indexKey, indexSpec, storedSpec } from "@/shell/indexes";
import type { IndexForm } from "@/shell/indexes";
import { parseValue } from "@/shell/parse";
import { replyError } from "@/shell/plan";
import { useConnectionsStore } from "@/stores/connections";

/** Creates an index from rows of fields and its options, or a copy of an existing one. */
const props = defineProps<{
    request?: IndexRequest;
}>();
const open = defineModel<boolean>({ default: false });

/** Collation locales offered, as in the collection dialog. */
const LOCALES = ["", "simple", "de", "en", "en_US", "es", "fr", "it", "nl", "pl", "pt", "sv", "tr", "zh"];

const { t } = useI18n();
const { say } = useMessages();
const connections = useConnectionsStore();

const form = ref<IndexForm>(emptyIndexForm());
const partialFilter = shallowRef("{}");
const busy = shallowRef(false);
const error = shallowRef<string>();

const kindOptions = computed(() => INDEX_KINDS.map(value => ({ value, label: t(`indexDialog.kind.${value}`) })));
const localeOptions = computed(() => LOCALES.map(value => ({ value, label: value || t("collectionDialog.locale.none") })));
const fields = computed(() => namesAsChoices(props.request ? connections.fieldsOf(props.request.connectionId, props.request.database, props.request.collection) : []));
const environment = computed<Environment | undefined>(() => {
    const request = props.request;
    if (!request) return undefined;
    return {
        serverVersion: connections.sessions[request.connectionId]?.version,
        databases: connections.sessions[request.connectionId]?.databases.map(database => database.name) ?? [],
        collections: connections.collectionsOf(request.connectionId, request.database),
        fields: name => connections.fieldsOf(request.connectionId, request.database, name)
    };
});
const placeholderName = computed(() => defaultIndexName(indexKey(form.value.fields)));
const problems = computed(() => indexFormErrors(form.value));
// A form without a field yet is how it starts, not a mistake to point out; saving waits for one.
const shownProblems = computed(() => problems.value.filter(key => key !== "indexDialog.error.noField").map(key => t(key)));
const title = computed(() => {
    const request = props.request;
    if (!request) return "";
    return request.recreate ? t("indexDialog.title.recreate", { name: String(request.index?.name) }) : t("indexDialog.title", { collection: request.collection });
});

watch([open, () => props.request], async ([isOpen]) => {
    if (!isOpen || !props.request) return;
    await nextTick();
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
                        <div class="grow min-w-0">
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

                <div class="form-grid grid-cols-[10rem_1fr]! pt-3 border-t border-divider">
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
                            :data-testid="`index-${option}`"
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
                        :placeholder="$t('indexDialog.ttl.placeholder')"
                        class="field w-36"
                        data-testid="index-ttl"
                        inputmode="numeric"
                    />
                    <span>{{ $t("collectionDialog.locale") }}:</span>
                    <ChoiceField
                        v-model="form.locale"
                        :label="$t('collectionDialog.locale')"
                        :options="localeOptions"
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

                <p
                    v-if="error || shownProblems.length > 0"
                    class="m-0 text-sm text-error break-words"
                    data-testid="index-error"
                    role="alert"
                >
                    {{ error ?? shownProblems.join(" ") }}
                </p>

                <div class="flex justify-end gap-2">
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
