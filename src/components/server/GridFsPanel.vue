<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { computed, onMounted, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage, inApp } from "@/api";
import ErrorState from "@/components/ErrorState.vue";
import IconButton from "@/components/IconButton.vue";
import { useDialogs } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";
import { useNotices } from "@/composables/notices";
import { useTask } from "@/composables/task";
import { pickFilePath, pickSavePath } from "@/files";
import { isDoc, preview, toNumber } from "@/shell/ejson";
import type { Doc, Json } from "@/shell/ejson";
import { ShellError } from "@/shell/message";
import { useTabsStore } from "@/stores/tabs";
import type { WorkTab } from "@/stores/tabs";

/** The files of a GridFS bucket: list, upload, download, rename, delete. */
const props = defineProps<{
    tab: WorkTab;
}>();

/** Files listed at most, newest first. */
const LISTED = 1000;

const { t, n } = useI18n();
const { say, report } = useMessages();
const notices = useNotices();
const dialogs = useDialogs();
const task = useTask();
const tabs = useTabsStore();

const files = shallowRef<Doc[]>([]);
const selected = shallowRef<number>();
const error = shallowRef<string>();
const loading = shallowRef(false);

const bucket = computed(() => props.tab.collection ?? "fs");
const current = computed(() => (selected.value === undefined ? undefined : files.value[selected.value]));
const locked = computed(() => tabs.locked(props.tab) || tabs.lockedByTree(props.tab, props.tab.database, `${bucket.value}.files`));

function command(document: Doc) {
    return backend.runCommand(props.tab.connectionId, props.tab.database, document);
}

async function load() {
    loading.value = true;
    try {
        const page = await backend.runCursorCommand(props.tab.connectionId, props.tab.database, { find: `${bucket.value}.files`, sort: { uploadDate: -1 }, limit: LISTED }, LISTED);
        files.value = page.documents;
        selected.value = undefined;
        error.value = undefined;
    } catch (cause) {
        error.value = say(errorMessage(cause));
    } finally {
        loading.value = false;
    }
}

function nameOf(file: Doc | undefined): string {
    return typeof file?.filename === "string" ? file.filename : "";
}

function size(value: Json | undefined): string {
    const bytes = toNumber(value) ?? 0;
    if (bytes < 1024) return t("gridfs.bytes", { value: n(bytes) });
    if (bytes < 1024 * 1024) return t("gridfs.kilobytes", { value: n(bytes / 1024, { maximumFractionDigits: 1 }) });
    return t("gridfs.megabytes", { value: n(bytes / 1024 / 1024, { maximumFractionDigits: 1 }) });
}

function date(value: Json | undefined): string {
    const wrapped = isDoc(value) ? value.$date : undefined;
    const millis = isDoc(wrapped) ? Number(wrapped.$numberLong) : typeof wrapped === "string" ? Date.parse(wrapped) : Number.NaN;
    return Number.isNaN(millis) ? "" : new Date(millis).toLocaleString();
}

function guard() {
    if (locked.value) throw new ShellError("error.plan.readonlyTree", { name: `${props.tab.database}.${bucket.value}` });
}

async function upload() {
    try {
        guard();
        if (!inApp) throw new ShellError("error.transfer.browser");
        const path = await pickFilePath();
        if (!path) return;
        await task.track(t("gridfs.uploading"), path, (runId, progress) =>
            backend.gridfsUpload(runId, props.tab.connectionId, props.tab.database, bucket.value, path, progress));
        notices.notify({ kind: "success", title: t("gridfs.uploaded", { name: path.split(/[\\/]/).pop() ?? path }), detail: `${bucket.value} @ ${props.tab.database}` });
        await load();
    } catch (cause) {
        report(cause);
    }
}

async function download() {
    const file = current.value;
    if (!file) return;
    try {
        if (!inApp) throw new ShellError("error.transfer.browser");
        const path = await pickSavePath(nameOf(file) || "file");
        if (!path) return;
        await task.track(t("gridfs.downloading"), path, (runId, progress) =>
            backend.gridfsDownload(runId, props.tab.connectionId, props.tab.database, bucket.value, file._id ?? null, toNumber(file.length) ?? 0, path, progress));
        notices.notify({ kind: "success", title: t("gridfs.downloaded", { name: nameOf(file) }), detail: path });
    } catch (cause) {
        report(cause);
    }
}

async function rename() {
    const file = current.value;
    if (!file) return;
    try {
        guard();
        const name = await dialogs.ask({ title: t("gridfs.rename"), label: t("gridfs.name"), value: nameOf(file), action: t("action.rename") });
        if (!name || name === nameOf(file)) return;
        await command({ update: `${bucket.value}.files`, updates: [{ q: { _id: file._id ?? null }, u: { $set: { filename: name } } }] });
        await load();
    } catch (cause) {
        report(cause);
    }
}

/** A file is its entry in `.files` and its pieces in `.chunks`: both go. */
async function remove() {
    const file = current.value;
    if (!file) return;
    try {
        guard();
        const confirmed = await dialogs.confirm({ title: t("gridfs.delete.title"), text: t("gridfs.delete.text", { name: nameOf(file) }), action: t("action.delete") });
        if (!confirmed) return;
        await command({ delete: `${bucket.value}.files`, deletes: [{ q: { _id: file._id ?? null }, limit: 1 }] });
        await command({ delete: `${bucket.value}.chunks`, deletes: [{ q: { files_id: file._id ?? null }, limit: 0 }] });
        await load();
    } catch (cause) {
        report(cause);
    }
}

onMounted(load);
</script>

<template>
    <section class="h-full min-h-0 flex flex-col">
        <h1 class="m-0 shrink-0 h-13 flex items-end gap-3 px-5.5 pb-1.5 text-[21px] font-normal text-on-surface whitespace-nowrap overflow-hidden">
            <span data-testid="gridfs-title">{{ bucket }}</span>
            <span class="text-on-surface/80">{{ $t("gridfs.title") }} · {{ tab.database }}</span>
        </h1>
        <div class="h-8 shrink-0 flex items-center gap-0.5 px-5">
            <IconButton
                @click="upload"
                :disabled="locked"
                :label="$t('gridfs.upload')"
                data-testid="gridfs-upload"
                icon="i-lucide-upload"
                tint="text-success"
            >
                {{ $t("gridfs.upload") }}
            </IconButton>
            <IconButton
                @click="download"
                :disabled="!current"
                :label="$t('gridfs.download')"
                data-testid="gridfs-download"
                icon="i-lucide-download"
            >
                {{ $t("gridfs.download") }}
            </IconButton>
            <span class="toolbar-rule" />
            <IconButton
                @click="rename"
                :disabled="!current || locked"
                :label="$t('gridfs.rename')"
                data-testid="gridfs-rename"
                icon="i-lucide-pencil"
            />
            <IconButton
                @click="remove"
                :disabled="!current || locked"
                :label="$t('gridfs.delete')"
                data-testid="gridfs-delete"
                icon="i-lucide-trash-2"
                tint="text-error"
            />
            <span class="toolbar-rule" />
            <IconButton
                @click="load"
                :disabled="loading"
                :label="$t('action.refresh')"
                icon="i-lucide-refresh-cw"
            />
            <span class="grow" />
            <span class="text-on-surface-variant tabular-nums">{{ $t("gridfs.count", { count: files.length }, files.length) }}</span>
        </div>

        <!-- Not read: said in place of the content, never above it. -->
        <ErrorState
            v-if="error"
            :detail="error"
            :title="$t('page.loadFailed')"
            class="grow"
            data-testid="gridfs-error"
        >
            <ButtonRoot
                @click="load"
                class="btn-primary h-7! text-[12px]"
            >
                <ButtonContent>{{ $t("action.reload") }}</ButtonContent>
            </ButtonRoot>
        </ErrorState>

        <div
            v-else
            class="grow min-h-0 overflow-auto px-5 pb-4"
        >
            <table
                class="plain-table"
                data-testid="gridfs-files"
            >
                <thead>
                    <tr>
                        <th class="plain-head">
                            {{ $t("gridfs.name") }}
                        </th>
                        <th class="plain-head text-right">
                            {{ $t("gridfs.size") }}
                        </th>
                        <th class="plain-head">
                            {{ $t("gridfs.uploadDate") }}
                        </th>
                        <th class="plain-head">
                            {{ $t("gridfs.metadata") }}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="(file, index) in files"
                        :key="index"
                        @click="selected = index"
                        @dblclick="download"
                        :class="selected === index ? 'bg-primary/20' : 'hover:bg-on-surface/5'"
                        class="cursor-default"
                        data-testid="gridfs-file"
                    >
                        <td class="plain-cell text-on-surface-strong">
                            {{ nameOf(file) }}
                        </td>
                        <td class="plain-cell text-right tabular-nums whitespace-nowrap">
                            {{ size(file.length) }}
                        </td>
                        <td class="plain-cell whitespace-nowrap tabular-nums">
                            {{ date(file.uploadDate) }}
                        </td>
                        <td class="plain-cell font-mono text-[11.5px] text-on-surface-variant">
                            {{ file.metadata === undefined ? "" : preview(file.metadata, 120) }}
                        </td>
                    </tr>
                </tbody>
            </table>
            <p
                v-if="files.length === 0 && !loading"
                class="m-0 py-3 text-on-surface-variant"
            >
                {{ $t("gridfs.empty") }}
            </p>
        </div>
    </section>
</template>
