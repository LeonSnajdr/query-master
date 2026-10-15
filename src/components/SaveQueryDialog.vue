<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogClose, DialogContent, DialogRoot, DialogTitle } from "@vuetify/v0";
import { computed, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { SavedQuery } from "@/api";
import { namesAsChoices } from "@/choice";
import ChoiceField from "@/components/ChoiceField.vue";
import { useMessages } from "@/composables/messages";
import { useNotices } from "@/composables/notices";
import { aggregateStatement } from "@/shell/pipeline";
import { draftOf, useQueriesStore } from "@/stores/queries";
import { browseStatement, useTabsStore } from "@/stores/tabs";

/** Saves the query of a tab with a name and a folder, or changes or removes a saved one (stage 20). */
const props = defineProps<{
    tabId?: string;
}>();
const open = defineModel<boolean>({ default: false });

const { t } = useI18n();
const { report } = useMessages();
const notices = useNotices();
const tabs = useTabsStore();
const queries = useQueriesStore();

const tab = computed(() => tabs.tabs.find(item => item.id === props.tabId));
/** The saved query the tab shows, when it is one: then the dialog changes it. */
const existing = shallowRef<SavedQuery>();
const name = shallowRef("");
const folder = shallowRef("");
/** For the collection of the tab, or for its whole database. */
const scope = shallowRef<"collection" | "database">("collection");
const busy = shallowRef(false);

/** Only the document browser and the aggregation have a collection to save for. */
const hasCollection = computed(() => (tab.value?.kind === "browse" || tab.value?.kind === "aggregate") && tab.value.collection !== undefined);
const folderOptions = computed(() => namesAsChoices(tab.value ? queries.foldersOf(tab.value.connectionId) : []));
const scopeOptions = computed(() => [
    { value: "collection" as const, label: t("savedQuery.scope.collection", { name: tab.value?.collection ?? "" }) },
    { value: "database" as const, label: t("savedQuery.scope.database", { name: tab.value?.database ?? "" }) }
]);
/** The query as the shell writes it, to see what is saved. */
const statement = computed(() => {
    const current = tab.value;
    if (!current) return "";
    if (current.kind === "browse") return browseStatement(current);
    if (current.kind === "aggregate") return aggregateStatement(current.collection ?? "", current.pipeline ?? [], current.aggregateOptions);
    return current.text;
});

watch(open, (isOpen) => {
    if (!isOpen || !tab.value) return;
    existing.value = queries.savedFor(tab.value);
    const start = existing.value ?? draftOf(tab.value);
    name.value = start?.name ?? "";
    folder.value = start?.folder ?? "";
    scope.value = hasCollection.value && (start?.collection ?? null) !== null ? "collection" : "database";
});

async function save() {
    const current = tab.value;
    const draft = current ? draftOf(current) : undefined;
    if (!current || !draft || !name.value.trim()) return;
    busy.value = true;
    try {
        await queries.save({
            ...draft,
            id: existing.value?.id ?? null,
            name: name.value.trim(),
            folder: folder.value.trim() || null,
            collection: hasCollection.value && scope.value === "collection" ? current.collection ?? null : null
        });
        notices.answer(t("savedQuery.saved", { name: name.value.trim() }));
        open.value = false;
    } catch (error) {
        report(error);
    } finally {
        busy.value = false;
    }
}

async function remove() {
    if (!existing.value) return;
    busy.value = true;
    try {
        await queries.remove(existing.value);
        notices.answer(t("savedQuery.removed", { name: existing.value.name }));
        open.value = false;
    } catch (error) {
        report(error);
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <DialogRoot v-model="open">
        <DialogContent class="dialog w-[min(94vw,34rem)]!">
            <form
                @submit.prevent="save"
                class="flex flex-col gap-4"
                data-testid="save-query"
            >
                <DialogTitle class="dialog-title">
                    {{ $t(existing ? "savedQuery.editTitle" : "savedQuery.title") }}
                </DialogTitle>
                <div class="form-grid grid-cols-[6rem_1fr]! text-[13px]">
                    <span>{{ $t("savedQuery.name") }}:</span>
                    <input
                        v-model="name"
                        class="field"
                        data-testid="save-query-name"
                        type="text"
                    />
                    <span>{{ $t("savedQuery.folder") }}:</span>
                    <ChoiceField
                        v-model="folder"
                        :label="$t('savedQuery.folder')"
                        :options="folderOptions"
                        :placeholder="$t('savedQuery.folder.none')"
                        data-testid="save-query-folder"
                        free
                        markNew
                    />
                    <template v-if="hasCollection">
                        <span>{{ $t("savedQuery.scope") }}:</span>
                        <ChoiceField
                            v-model="scope"
                            :label="$t('savedQuery.scope')"
                            :options="scopeOptions"
                        />
                    </template>
                </div>
                <pre class="m-0 max-h-40 overflow-auto px-3 py-2 rounded-sm bg-on-surface/5 font-mono text-[12.5px] text-on-surface-strong whitespace-pre-wrap break-all">{{ statement }}</pre>
                <div class="flex gap-2">
                    <ButtonRoot
                        v-if="existing"
                        @click="remove"
                        :disabled="busy"
                        class="btn-danger mr-auto"
                        data-testid="save-query-remove"
                    >
                        <ButtonContent>{{ $t("savedQuery.remove") }}</ButtonContent>
                    </ButtonRoot>
                    <span
                        v-else
                        class="mr-auto"
                    />
                    <DialogClose class="btn-ghost">
                        {{ $t("action.cancel") }}
                    </DialogClose>
                    <ButtonRoot
                        @click="save"
                        :disabled="busy || !name.trim()"
                        class="btn-primary"
                        data-testid="save-query-submit"
                    >
                        <ButtonContent>{{ $t("savedQuery.save") }}</ButtonContent>
                    </ButtonRoot>
                </div>
            </form>
        </DialogContent>
    </DialogRoot>
</template>
