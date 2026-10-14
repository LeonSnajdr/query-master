<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogClose, DialogContent, DialogRoot, DialogTitle, SwitchRoot, SwitchThumb, SwitchTrack } from "@vuetify/v0";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { inApp } from "@/api";

import SelectField from "@/components/SelectField.vue";
import { useImportWizard } from "@/composables/importWizard";
import { CSV_FILES, JSON_FILES, JSON_LINES_FILES, pickOpenPaths } from "@/files";
import { useConnectionsStore } from "@/stores/connections";
import { splitPath } from "@/transfer/export";
import { IMPORT_FORMATS, importProblems } from "@/transfer/import";
import type { CsvReadSettings, EmptyFields, ImportFormat } from "@/transfer/import";
import ImportFiles from "./ImportFiles.vue";
import ImportSchema from "./ImportSchema.vue";

/** The import wizard: format tiles, files with their target, CSV pages, progress. */
const { t } = useI18n();
const connections = useConnectionsStore();
const { wizard, setFormat, addFiles, chooseConnection, start, stop, close } = useImportWizard();

const open = computed({ get: () => wizard.open, set: value => !value && close() });
const state = computed(() => wizard.state);
const running = computed(() => wizard.runId !== undefined);

const TILES: Record<ImportFormat, string> = { json: "i-lucide-braces", csv: "i-lucide-sheet" };

const title = computed(() => {
    if (wizard.step === "settings") return t("import.title.settings");
    if (wizard.step === "schema") return t("import.title.schema");
    return t("import.title");
});
const serverOptions = computed(() => connections.saved.map(profile => ({ value: profile.id, label: profile.name })));
const server = computed({ get: () => state.value.connectionId, set: (value: string) => void chooseConnection(value) });

const delimiterOptions = computed(() => ([[",", "comma"], [";", "semicolon"], ["\t", "tab"], [" ", "space"]] as const).map(([value, name]) => ({ value, label: t(`export.csv.delimiter.${name}`) })));
const quoteOptions = computed(() => ([["\"", "double"], ["'", "single"]] as const).map(([value, name]) => ({ value, label: t(`export.csv.quote.${name}`) })));
const emptyOptions = computed(() => (["null", "emptyString", "omit"] as EmptyFields[]).map(value => ({ value, label: t(`import.csv.empty.${value}`) })));
const delimiter = computed({ get: () => state.value.csv.delimiter, set: (value: CsvReadSettings["delimiter"]) => (state.value.csv.delimiter = value) });
const quote = computed({ get: () => state.value.csv.quote, set: (value: CsvReadSettings["quote"]) => (state.value.csv.quote = value) });
const empty = computed({ get: () => state.value.csv.empty, set: (value: EmptyFields) => (state.value.csv.empty = value) });
const CSV_FLAGS = ["header", "unescape"] as const;

// Other settings read the file differently: the columns of the schema page are read anew.
watch(() => ({ ...wizard.state.csv }), () => (wizard.state.columns = {}), { deep: true });

const problems = computed(() => importProblems(state.value));
const problemText = computed(() => {
    const first = problems.value[0];
    if (!first) return "";
    return first.row === undefined ? t(first.key) : t("export.problem.inRow", { row: first.row + 1, text: t(first.key) });
});

async function chooseFiles() {
    const kinds = state.value.format === "csv" ? [CSV_FILES] : [JSON_FILES, JSON_LINES_FILES];
    addFiles(await pickOpenPaths(kinds));
}

/** Files dropped on the window while the wizard is open. */
const dragging = shallowRef(false);
let unlisten: (() => void) | undefined;
onMounted(async () => {
    if (!inApp) return;
    unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        if (!wizard.open || running.value || wizard.step !== "rows") return;
        if (event.payload.type === "over" || event.payload.type === "enter") dragging.value = true;
        else if (event.payload.type === "leave") dragging.value = false;
        else if (event.payload.type === "drop") {
            dragging.value = false;
            addFiles(event.payload.paths);
        }
    });
});
onBeforeUnmount(() => unlisten?.());

/** Next from the files: JSON starts, CSV goes on to its settings. */
function next() {
    if (problems.value.length > 0) return;
    if (state.value.format === "json") void start();
    else wizard.step = "settings";
}

function back() {
    wizard.step = wizard.step === "schema" ? "settings" : "rows";
}

const STATE_ICONS: Record<string, string> = {
    waiting: "i-lucide-circle-dashed text-on-surface-variant",
    running: "i-lucide-loader-circle animate-spin text-primary",
    done: "i-lucide-circle-check text-success",
    failed: "i-lucide-circle-x text-error",
    stopped: "i-lucide-circle-pause text-warning"
};
</script>

<template>
    <DialogRoot v-model="open">
        <DialogContent class="dialog p-0! w-[min(94vw,54rem)]! h-[min(92vh,44rem)]!">
            <div
                class="h-full flex flex-col text-[13px]"
                data-testid="import-wizard"
            >
                <header class="shrink-0 bg-dock border-b border-divider">
                    <div class="relative h-14 flex items-center justify-center">
                        <DialogTitle class="m-0 text-[21px] font-normal text-on-surface-strong">
                            {{ title }}
                        </DialogTitle>
                        <DialogClose
                            :aria-label="$t('action.close')"
                            class="absolute right-4 top-3 size-8 inline-flex items-center justify-center rounded-sm text-on-surface hover:bg-on-surface/10"
                        >
                            <span class="i-lucide-x size-5" />
                        </DialogClose>
                    </div>
                    <div
                        v-if="wizard.step === 'rows'"
                        :aria-label="$t('export.format')"
                        class="flex justify-center gap-2 pb-2.5"
                        role="radiogroup"
                    >
                        <ButtonRoot
                            v-for="format in IMPORT_FORMATS"
                            :key="format"
                            @click="setFormat(format)"
                            :aria-checked="state.format === format"
                            :class="state.format === format ? 'text-on-surface-strong font-bold' : 'text-on-surface hover:text-on-surface-strong'"
                            :data-testid="`import-tile-${format}`"
                            :disabled="running"
                            class="relative w-21 pt-1 pb-2 flex flex-col items-center gap-1.5 disabled:opacity-35"
                            role="radio"
                        >
                            <span
                                :class="TILES[format]"
                                class="size-7"
                            />
                            <ButtonContent>{{ $t(`export.format.${format}`) }}</ButtonContent>
                            <span
                                v-if="state.format === format"
                                class="absolute -bottom-[17px] size-3 rotate-45 bg-background border-l border-t border-divider"
                            />
                        </ButtonRoot>
                    </div>
                </header>

                <!-- Page 1: the server, and the files with where each goes. -->
                <div
                    v-if="wizard.step === 'rows'"
                    class="grow min-h-0 flex flex-col px-6 pt-5 gap-3"
                >
                    <div class="form-grid grid-cols-[10rem_1fr]!">
                        <span>{{ $t("import.to") }}:</span>
                        <div class="w-72">
                            <SelectField
                                v-model="server"
                                :label="$t('import.to')"
                                :options="serverOptions"
                                data-testid="import-server"
                            />
                        </div>
                    </div>

                    <div class="border-t border-divider" />

                    <ImportFiles
                        @addFiles="chooseFiles"
                        :dragging
                        :state
                    />
                </div>

                <!-- Page 2 of CSV: how the files are read. -->
                <div
                    v-else-if="wizard.step === 'settings'"
                    class="grow min-h-0 px-6 pt-6"
                >
                    <div class="form-grid grid-cols-[16rem_1fr]!">
                        <span>{{ $t("export.csv.delimiter") }}:</span>
                        <SelectField
                            v-model="delimiter"
                            :label="$t('export.csv.delimiter')"
                            :options="delimiterOptions"
                            data-testid="import-delimiter"
                        />
                        <span>{{ $t("export.csv.quote") }}:</span>
                        <SelectField
                            v-model="quote"
                            :label="$t('export.csv.quote')"
                            :options="quoteOptions"
                        />
                        <span>{{ $t("import.csv.skipRows") }}:</span>
                        <input
                            v-model.number="state.csv.skipRows"
                            :aria-label="$t('import.csv.skipRows')"
                            class="field w-24!"
                            data-testid="import-skip-rows"
                            max="10"
                            min="0"
                            type="number"
                        />
                        <span>{{ $t("import.csv.empty") }}:</span>
                        <SelectField
                            v-model="empty"
                            :label="$t('import.csv.empty')"
                            :options="emptyOptions"
                            data-testid="import-empty-fields"
                        />
                        <template
                            v-for="flag in CSV_FLAGS"
                            :key="flag"
                        >
                            <span>{{ $t(`import.csv.${flag}`) }}:</span>
                            <SwitchRoot
                                v-model="state.csv[flag]"
                                :data-testid="`import-csv-${flag}`"
                                :label="$t(`import.csv.${flag}`)"
                            >
                                <SwitchTrack class="switch-track">
                                    <SwitchThumb class="switch-thumb" />
                                </SwitchTrack>
                            </SwitchRoot>
                        </template>
                    </div>
                </div>

                <!-- Page 3 of CSV: the columns of each file. -->
                <div
                    v-else-if="wizard.step === 'schema'"
                    class="grow min-h-0 px-6 pt-5"
                >
                    <ImportSchema :state="state" />
                </div>

                <!-- Page 4: how far each file got. -->
                <div
                    v-else
                    class="grow min-h-0 flex flex-col px-6 pt-4 gap-3"
                >
                    <div class="h-1 rounded-full bg-on-surface/15 overflow-hidden">
                        <div
                            :class="running ? 'w-1/3 animate-pulse' : 'w-full'"
                            class="h-full bg-primary"
                        />
                    </div>
                    <div class="grow min-h-0 overflow-auto rounded-sm bg-background border border-divider">
                        <table
                            class="w-full border-collapse"
                            data-testid="import-progress"
                        >
                            <tbody>
                                <tr
                                    v-for="(row, index) in state.rows"
                                    :key="index"
                                    :data-state="wizard.progress[index]?.state"
                                    class="align-top"
                                    data-testid="import-progress-row"
                                >
                                    <td class="w-8 pl-2.5 py-1.5 border-b border-divider">
                                        <span
                                            :class="STATE_ICONS[wizard.progress[index]?.state ?? 'waiting']"
                                            class="size-4 block"
                                        />
                                    </td>
                                    <td class="py-1.5 pr-3 border-b border-divider">
                                        <span class="text-on-surface-strong">{{ splitPath(row.path).name }}</span>
                                        <span class="text-on-surface-variant"> → {{ row.database }}.{{ row.collection }}</span>
                                        <span
                                            v-if="wizard.progress[index]?.error"
                                            class="block text-error break-words"
                                        >{{ wizard.progress[index]?.error }}</span>
                                    </td>
                                    <td class="w-32 py-1.5 pr-3 border-b border-divider text-right tabular-nums text-on-surface-variant">
                                        {{ $t("task.count", { done: (wizard.progress[index]?.done ?? 0).toLocaleString() }, wizard.progress[index]?.done ?? 0) }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <footer class="shrink-0 flex items-center gap-2 px-6 py-5">
                    <p
                        v-if="wizard.step === 'rows' && problemText && state.rows.length > 0"
                        class="m-0 grow text-error"
                        data-testid="import-problem"
                    >
                        {{ problemText }}
                    </p>
                    <span
                        v-else
                        class="grow"
                    />
                    <ButtonRoot
                        v-if="wizard.step === 'settings' || wizard.step === 'schema'"
                        @click="back"
                        class="btn-secondary"
                        data-testid="import-back"
                    >
                        <ButtonContent>{{ $t("action.back") }}</ButtonContent>
                    </ButtonRoot>
                    <ButtonRoot
                        v-if="wizard.step === 'rows'"
                        @click="next"
                        :disabled="problems.length > 0"
                        class="btn-primary"
                        data-testid="import-next"
                    >
                        <ButtonContent>{{ $t(state.format === "json" ? "import.start" : "action.next") }}</ButtonContent>
                    </ButtonRoot>
                    <ButtonRoot
                        v-else-if="wizard.step === 'settings'"
                        @click="wizard.step = 'schema'"
                        class="btn-primary"
                        data-testid="import-schema-next"
                    >
                        <ButtonContent>{{ $t("action.next") }}</ButtonContent>
                    </ButtonRoot>
                    <ButtonRoot
                        v-else-if="wizard.step === 'schema'"
                        @click="start"
                        class="btn-primary"
                        data-testid="import-start"
                    >
                        <ButtonContent>{{ $t("import.start") }}</ButtonContent>
                    </ButtonRoot>
                    <ButtonRoot
                        v-if="wizard.step === 'progress' && running"
                        @click="stop"
                        class="btn-secondary"
                        data-testid="import-stop"
                    >
                        <ButtonContent>{{ $t("action.stop") }}</ButtonContent>
                    </ButtonRoot>
                    <DialogClose
                        v-else
                        class="btn-secondary"
                        data-testid="import-close"
                    >
                        {{ $t(wizard.step === "progress" ? "action.close" : "action.cancel") }}
                    </DialogClose>
                </footer>
            </div>
        </DialogContent>
    </DialogRoot>
</template>
