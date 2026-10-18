<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import ErrorState from "@/components/ErrorState.vue";
import ChoiceField from "@/components/ChoiceField.vue";
import { useMessages } from "@/composables/messages";
import { splitPath } from "@/transfer/export";
import { COLUMN_TYPES, csvOptions } from "@/transfer/import";
import type { ColumnType, CsvColumn, ImportState } from "@/transfer/import";

/**
 * The schema page of the CSV import: per file the columns with the field
 * each becomes and its type (guessed from the first rows), and a preview of those rows. The
 * columns are kept per file in `state.columns`.
 */
const props = defineProps<{
    state: ImportState;
}>();

const { t } = useI18n();
const { say } = useMessages();

const fileOptions = computed(() => props.state.rows.map(row => ({ value: row.path, label: `${row.database}.${row.collection} (${splitPath(row.path).name})` })));
const current = shallowRef(props.state.rows[0]?.path ?? "");
const rows = shallowRef<string[][]>([]);
const loading = shallowRef(false);
const failure = shallowRef("");
const typeOptions = computed(() => COLUMN_TYPES.map(value => ({ value, label: t(`import.type.${value}`) })));

const columns = computed<CsvColumn[]>(() => props.state.columns[current.value] ?? []);

function setColumns(next: CsvColumn[]) {
    // eslint-disable-next-line vue/no-mutating-props -- the wizard's state object, owned by the composable
    props.state.columns = { ...props.state.columns, [current.value]: next };
}

function change(index: number, update: Partial<CsvColumn>) {
    setColumns(columns.value.map((column, at) => (at === index ? { ...column, ...update } : column)));
}

/** Reads the head of the file; its guessed columns stand until they are changed here. */
async function load(path: string) {
    if (!path) return;
    loading.value = true;
    failure.value = "";
    try {
        const preview = await backend.importPreview(path, csvOptions(props.state.csv));
        if (path !== current.value) return;
        rows.value = preview.rows;
        if (!props.state.columns[path] || props.state.columns[path].length !== preview.columns.length) setColumns(preview.columns);
    } catch (error) {
        rows.value = [];
        failure.value = say(errorMessage(error));
    } finally {
        loading.value = false;
    }
}

watch(current, path => void load(path), { immediate: true });
</script>

<template>
    <div
        class="h-full min-h-0 flex flex-col gap-3"
        data-testid="import-schema"
    >
        <div class="form-grid grid-cols-[12rem_1fr]!">
            <span>{{ $t("import.schema.file") }}:</span>
            <ChoiceField
                v-model="current"
                :label="$t('import.schema.file')"
                :options="fileOptions"
            />
        </div>
        <div class="h-1/2 min-h-0 overflow-auto rounded-sm bg-background border border-divider">
            <!-- A file that can not be read: said in place of its columns. -->
            <ErrorState
                v-if="failure"
                :detail="failure"
                :title="$t('page.loadFailed')"
            />
            <table
                v-else
                class="w-full border-collapse"
                data-testid="import-columns"
            >
                <thead>
                    <tr class="text-left">
                        <th class="sticky top-0 z-1 bg-background w-10 px-2.5 py-1.5 font-semibold text-on-surface-strong">
                            <span class="sr-only">{{ $t("import.schema.include") }}</span>
                        </th>
                        <th class="sticky top-0 z-1 bg-background px-2.5 py-1.5 font-semibold text-on-surface-strong">
                            {{ $t("import.schema.field") }}
                        </th>
                        <th class="sticky top-0 z-1 bg-background w-48 px-2.5 py-1.5 font-semibold text-on-surface-strong">
                            {{ $t("import.schema.type") }}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="(column, index) in columns"
                        :key="index"
                        :class="column.include ? '' : 'opacity-55'"
                        data-testid="import-column"
                    >
                        <td class="px-2.5 py-0.5 border-t border-divider">
                            <input
                                @change="change(index, { include: ($event.target as HTMLInputElement).checked })"
                                :aria-label="$t('import.schema.include')"
                                :checked="column.include"
                                class="size-4 accent-primary"
                                data-testid="import-column-include"
                                type="checkbox"
                            />
                        </td>
                        <td class="px-1 py-0.5 border-t border-divider">
                            <input
                                @change="change(index, { name: ($event.target as HTMLInputElement).value.trim() || column.name })"
                                :aria-label="$t('import.schema.field')"
                                :value="column.name"
                                class="w-full h-7 px-1.5 bg-transparent border border-transparent rounded-sm focus:border-primary outline-none font-mono"
                                data-testid="import-column-name"
                                spellcheck="false"
                            />
                        </td>
                        <td class="px-1 py-0.5 border-t border-divider">
                            <ChoiceField
                                @update:modelValue="(value: ColumnType) => change(index, { type: value })"
                                :label="$t('import.schema.type')"
                                :modelValue="column.type"
                                :options="typeOptions"
                                size="compact"
                            />
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <span class="text-on-surface-variant">{{ $t(loading ? "import.schema.loading" : "import.schema.preview") }}</span>
        <div class="grow min-h-0 overflow-auto rounded-sm bg-background border border-divider">
            <table
                class="border-collapse font-mono text-[12.5px]"
                data-testid="import-preview"
            >
                <thead>
                    <tr class="text-left">
                        <th
                            v-for="(column, index) in columns"
                            :key="index"
                            class="sticky top-0 bg-background px-2.5 py-1 font-semibold text-on-surface-strong whitespace-nowrap"
                        >
                            {{ column.name }}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="(row, index) in rows"
                        :key="index"
                    >
                        <td
                            v-for="(_, at) in columns"
                            :key="at"
                            class="px-2.5 py-0.5 border-t border-divider whitespace-nowrap max-w-60 truncate"
                        >
                            {{ row[at] ?? "" }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
