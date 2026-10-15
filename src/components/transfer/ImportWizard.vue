<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogClose, DialogContent, DialogRoot, DialogTitle, SwitchRoot, SwitchThumb, SwitchTrack } from "@vuetify/v0";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { inApp } from "@/api";

import ChoiceField from "@/components/ChoiceField.vue";
import { useImportWizard } from "@/composables/importWizard";
import { CSV_FILES, JSON_FILES, JSON_LINES_FILES, pickOpenPaths } from "@/files";
import { useConnectionsStore } from "@/stores/connections";
import { splitPath } from "@/transfer/export";
import { IMPORT_FORMATS, importProblems } from "@/transfer/import";
import type { CsvReadSettings, EmptyFields, ImportFormat } from "@/transfer/import";
import ImportFiles from "./ImportFiles.vue";
import ImportSchema from "./ImportSchema.vue";
import TransferProgress from "./TransferProgress.vue";

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

const progressRows = computed(() => state.value.rows.map(row => ({ source: splitPath(row.path).name, target: `${row.database}.${row.collection}` })));
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
                            <ChoiceField
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
                        <ChoiceField
                            v-model="delimiter"
                            :label="$t('export.csv.delimiter')"
                            :options="delimiterOptions"
                            data-testid="import-delimiter"
                        />
                        <span>{{ $t("export.csv.quote") }}:</span>
                        <ChoiceField
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
                        <ChoiceField
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
                <TransferProgress
                    v-else
                    :progress="wizard.progress"
                    :rows="progressRows"
                    :running="running"
                    kind="import"
                />

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
