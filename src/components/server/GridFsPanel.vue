<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { computed, onMounted, ref, shallowRef, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage, inApp } from "@/api";
import ChoiceField from "@/components/ChoiceField.vue";
import CodeEditor from "@/components/CodeEditor.vue";
import ContextMenu from "@/components/ContextMenu.vue";
import ErrorState from "@/components/ErrorState.vue";
import FormError from "@/components/FormError.vue";
import IconButton from "@/components/IconButton.vue";
import { useDialogs } from "@/composables/dialogs";
import { useFreeSpace } from "@/composables/freeSpace";
import { useMessages } from "@/composables/messages";
import { useNotices } from "@/composables/notices";
import { useTask } from "@/composables/task";
import { pickFilePath, pickSavePath } from "@/files";
import type { MenuEntry } from "@/menu";
import { isDoc, preview, toNumber, toShell } from "@/shell/ejson";
import type { Doc, Json } from "@/shell/ejson";
import { ShellError } from "@/shell/message";
import { parseValue } from "@/shell/parse";
import { useTabsStore } from "@/stores/tabs";
import type { WorkTab } from "@/stores/tabs";

/**
 * The files of a GridFS bucket: list (filter, sort, skip, limit), upload (name, content type,
 * metadata, what to do with a file of the same name), download, rename, delete, the details of a
 * file and its metadata; the bucket itself can be renamed.
 */
const props = defineProps<{
    tab: WorkTab;
}>();

/** Files listed at most, unless the limit says otherwise. */
const LISTED = 1000;

/** What to do when the bucket has a file of the name already. */
type Duplicates = "keep" | "replace" | "skip";

/** A file chosen for upload, before it goes: the form of the *Upload file*. */
interface UploadDraft {
    path: string;
    name: string;
    contentType: string;
    metadata: string;
    duplicates: Duplicates;
}

/** A content type for the common endings; the rest stays empty (the server needs none). */
const CONTENT_TYPES: Record<string, string> = {
    txt: "text/plain", csv: "text/csv", json: "application/json", xml: "application/xml", html: "text/html", pdf: "application/pdf",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp",
    zip: "application/zip", gz: "application/gzip", mp4: "video/mp4", mp3: "audio/mpeg",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

const { t, n } = useI18n();
const { say, report } = useMessages();
const notices = useNotices();
const dialogs = useDialogs();
const task = useTask();
const tabs = useTabsStore();

const files = shallowRef<Doc[]>([]);
/** The query of the list filter, sort, skip and limit above it. */
const query = ref({ filter: "{}", sort: "{ uploadDate: -1 }", skip: 0, limit: LISTED });
/** A filter or sort that does not read: said beside the fields, the list stays. */
const queryError = shallowRef<string>();
const draft = ref<UploadDraft>();
const draftError = shallowRef<string>();
const duplicateOptions = computed(() => (["keep", "replace", "skip"] as const).map(value => ({ value, label: t(`gridfs.duplicates.${value}`) })));
const selected = shallowRef<number>();
const error = shallowRef<string>();
const loading = shallowRef(false);

const bucket = computed(() => props.tab.collection ?? "fs");
const current = computed(() => (selected.value === undefined ? undefined : files.value[selected.value]));
const locked = computed(() => tabs.locked(props.tab) || tabs.lockedByTree(props.tab, props.tab.database, `${bucket.value}.files`));

function command(document: Doc) {
    return backend.runCommand(props.tab.connectionId, props.tab.database, document);
}

/** A document typed in a field of the list's query; empty is `{}`. */
function documentOf(text: string, field: string): Doc {
    const value = text.trim() ? parseValue(text) : {};
    if (!isDoc(value)) throw new Error(`${field}: ${t("document.error.notDocument")}`);
    return value;
}

async function load() {
    let filter: Doc;
    let sort: Doc;
    try {
        filter = documentOf(query.value.filter, t("gridfs.filter"));
        sort = documentOf(query.value.sort, t("gridfs.sort"));
        queryError.value = undefined;
    } catch (cause) {
        queryError.value = say(errorMessage(cause));
        return;
    }
    const skip = Math.max(0, Math.floor(Number(query.value.skip) || 0));
    const limit = Math.max(1, Math.floor(Number(query.value.limit) || LISTED));
    loading.value = true;
    try {
        const page = await backend.runCursorCommand(props.tab.connectionId, props.tab.database, { find: `${bucket.value}.files`, filter, sort, skip, limit }, limit);
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

/** Picks a file and shows the upload form for it. */
async function upload() {
    try {
        guard();
        if (!inApp) throw new ShellError("error.transfer.browser");
        const path = await pickFilePath();
        if (!path) return;
        const name = path.split(/[\\/]/).pop() ?? path;
        const ending = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
        draft.value = { path, name, contentType: CONTENT_TYPES[ending] ?? "", metadata: "", duplicates: "keep" };
        draftError.value = undefined;
    } catch (cause) {
        report(cause);
    }
}

/**
 * Uploads the chosen file, then names it and sets content type and metadata. A file of the same
 * name stays, is replaced (after the new one is in) or keeps the new one out.
 */
async function sendUpload() {
    const chosen = draft.value;
    if (!chosen) return;
    const name = chosen.name.trim();
    if (!name) {
        draftError.value = t("gridfs.error.name");
        return;
    }
    let metadata: Doc | undefined;
    try {
        metadata = chosen.metadata.trim() ? documentOf(chosen.metadata, t("gridfs.metadata")) : undefined;
        guard();
    } catch (cause) {
        draftError.value = say(errorMessage(cause));
        return;
    }
    draftError.value = undefined;
    try {
        const same = (await backend.runCursorCommand(props.tab.connectionId, props.tab.database, { find: `${bucket.value}.files`, filter: { filename: name }, projection: { _id: 1 } }, LISTED)).documents;
        if (same.length > 0 && chosen.duplicates === "skip") {
            notices.notify({ kind: "info", title: t("gridfs.skipped", { name }) });
            draft.value = undefined;
            return;
        }
        const id = await task.track(t("gridfs.uploading"), chosen.path, (runId, progress) =>
            backend.gridfsUpload(runId, props.tab.connectionId, props.tab.database, bucket.value, chosen.path, progress));
        const fields: Doc = { filename: name, ...(chosen.contentType.trim() ? { contentType: chosen.contentType.trim() } : {}), ...(metadata ? { metadata } : {}) };
        await command({ update: `${bucket.value}.files`, updates: [{ q: { _id: id }, u: { $set: fields } }] });
        if (chosen.duplicates === "replace") {
            for (const old of same) await removeFile(old._id ?? null);
        }
        notices.notify({ kind: "success", title: t("gridfs.uploaded", { name }), detail: `${bucket.value} @ ${props.tab.database}` });
        draft.value = undefined;
        await load();
    } catch (cause) {
        report(cause);
    }
}

async function removeFile(id: Json) {
    await command({ delete: `${bucket.value}.files`, deletes: [{ q: { _id: id }, limit: 1 }] });
    await command({ delete: `${bucket.value}.chunks`, deletes: [{ q: { files_id: id }, limit: 0 }] });
}

/** The metadata of the file, edited as a document; empty takes it away. */
function editMetadata() {
    const file = current.value;
    if (!file) return;
    dialogs.showText({
        title: t("gridfs.metadata.edit", { name: nameOf(file) }),
        text: isDoc(file.metadata) ? toShell(file.metadata) : "{}",
        action: t("action.save"),
        submit: async (text) => {
            try {
                guard();
                const metadata = documentOf(text, t("gridfs.metadata"));
                const change: Doc = Object.keys(metadata).length > 0 ? { $set: { metadata } } : { $unset: { metadata: "" } };
                await command({ update: `${bucket.value}.files`, updates: [{ q: { _id: file._id ?? null }, u: change }] });
                await load();
                return undefined;
            } catch (cause) {
                return say(errorMessage(cause));
            }
        }
    });
}

async function editContentType() {
    const file = current.value;
    if (!file) return;
    try {
        guard();
        const value = await dialogs.ask({ title: t("gridfs.contentType.edit"), label: t("gridfs.contentType"), value: typeof file.contentType === "string" ? file.contentType : "", action: t("action.save") });
        if (value === undefined) return;
        const change: Doc = value.trim() ? { $set: { contentType: value.trim() } } : { $unset: { contentType: "" } };
        await command({ update: `${bucket.value}.files`, updates: [{ q: { _id: file._id ?? null }, u: change }] });
        await load();
    } catch (cause) {
        report(cause);
    }
}

/** Renames both collections of the bucket; the tab follows to the new name. */
async function renameBucket() {
    try {
        guard();
        const name = (await dialogs.ask({ title: t("gridfs.renameBucket"), label: t("gridfs.create.label"), value: bucket.value, action: t("action.rename") }))?.trim();
        if (!name || name === bucket.value) return;
        const database = props.tab.database;
        for (const part of ["files", "chunks"]) {
            await backend.runCommand(props.tab.connectionId, "admin", { renameCollection: `${database}.${bucket.value}.${part}`, to: `${database}.${name}.${part}` });
        }
        // The tab is the store's own object: it shows the bucket under its new name.
        // eslint-disable-next-line vue/no-mutating-props
        props.tab.collection = name;
        await load();
    } catch (cause) {
        report(cause);
    }
}

const spaceMenu = useTemplateRef("spaceMenu");

/** Below the files, as in Windows Explorer: the choice goes away; the menu offers what needs no file. */
const fileSpace = useFreeSpace(() => (selected.value = undefined), {
    // The details below the list belong to the chosen file: a click there keeps it.
    rows: "tbody tr, thead, [data-testid=gridfs-details]",
    menu: (event) => {
        const entries: MenuEntry[] = [
            { label: `${t("gridfs.upload")} …`, icon: "i-lucide-upload", action: () => void upload(), disabled: locked.value },
            { label: t("action.refresh"), icon: "i-lucide-refresh-cw", action: () => void load(), disabled: loading.value },
            "separator",
            { label: `${t("gridfs.renameBucket")} …`, icon: "i-lucide-folder-pen", action: () => void renameBucket(), disabled: locked.value }
        ];
        void spaceMenu.value?.open(event, entries);
    }
});

/** The whole entry of the file in `.files` *File info*. */
const details = computed(() => (current.value ? toShell(current.value) : undefined));

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
        await removeFile(file._id ?? null);
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
            <IconButton
                @click="editMetadata"
                :disabled="!current || locked"
                :label="$t('gridfs.metadata.editShort')"
                data-testid="gridfs-metadata"
                icon="i-lucide-braces"
            />
            <IconButton
                @click="editContentType"
                :disabled="!current || locked"
                :label="$t('gridfs.contentType.edit')"
                data-testid="gridfs-content-type"
                icon="i-lucide-file-type"
            />
            <span class="toolbar-rule" />
            <IconButton
                @click="renameBucket"
                :disabled="locked"
                :label="$t('gridfs.renameBucket')"
                data-testid="gridfs-rename-bucket"
                icon="i-lucide-folder-pen"
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

        <form
            @keydown.enter.prevent="load"
            @submit.prevent="load"
            class="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 pb-2 text-[13px]"
            data-testid="gridfs-query"
        >
            <label class="grow min-w-56 flex items-center gap-1.5">
                <span class="text-on-surface-variant">{{ $t("gridfs.filter") }}</span>
                <input
                    v-model="query.filter"
                    class="field grow font-mono"
                    data-testid="gridfs-filter"
                    placeholder="{ filename: /report/ }"
                    spellcheck="false"
                />
            </label>
            <label class="w-64 flex items-center gap-1.5">
                <span class="text-on-surface-variant">{{ $t("gridfs.sort") }}</span>
                <input
                    v-model="query.sort"
                    class="field grow min-w-0 font-mono"
                    data-testid="gridfs-sort"
                    spellcheck="false"
                />
            </label>
            <label class="flex items-center gap-1.5">
                <span class="text-on-surface-variant">{{ $t("gridfs.skip") }}</span>
                <input
                    v-model.number="query.skip"
                    class="field w-20"
                    min="0"
                    type="number"
                />
            </label>
            <label class="flex items-center gap-1.5">
                <span class="text-on-surface-variant">{{ $t("gridfs.limit") }}</span>
                <input
                    v-model.number="query.limit"
                    class="field w-20"
                    min="1"
                    type="number"
                />
            </label>
            <ButtonRoot
                @click="load"
                :disabled="loading"
                class="btn-secondary h-7! text-[12px]"
                data-testid="gridfs-apply"
            >
                <ButtonContent>{{ $t("action.apply") }}</ButtonContent>
            </ButtonRoot>
            <FormError
                :text="queryError"
                class="basis-full"
                data-testid="gridfs-query-error"
            />
        </form>

        <form
            v-if="draft"
            @submit.prevent="sendUpload"
            class="shrink-0 mx-5 mb-2 p-3 rounded-sm border border-divider flex flex-col gap-2 text-[13px]"
            data-testid="gridfs-upload-form"
        >
            <div class="text-on-surface-variant truncate">
                {{ $t("gridfs.uploadFrom", { path: draft.path }) }}
            </div>
            <div class="form-grid grid-cols-[10rem_1fr]!">
                <span>{{ $t("gridfs.name") }}:</span>
                <input
                    v-model="draft.name"
                    class="field"
                    data-testid="gridfs-upload-name"
                    spellcheck="false"
                />
                <span>{{ $t("gridfs.contentType") }}:</span>
                <input
                    v-model="draft.contentType"
                    class="field"
                    placeholder="application/pdf"
                    spellcheck="false"
                />
                <span>{{ $t("gridfs.duplicates") }}:</span>
                <div class="w-72">
                    <ChoiceField
                        v-model="draft.duplicates"
                        :label="$t('gridfs.duplicates')"
                        :options="duplicateOptions"
                    />
                </div>
                <span>{{ $t("gridfs.metadata") }}:</span>
                <div class="h-20 rounded-sm bg-background border border-divider">
                    <CodeEditor
                        v-model="draft.metadata"
                        :label="$t('gridfs.metadata')"
                    />
                </div>
            </div>
            <div class="flex items-center gap-2">
                <ButtonRoot
                    @click="sendUpload"
                    :disabled="task.running.runId !== undefined"
                    class="btn-primary"
                    data-testid="gridfs-upload-send"
                >
                    <ButtonContent>{{ $t("gridfs.upload") }}</ButtonContent>
                </ButtonRoot>
                <ButtonRoot
                    @click="draft = undefined"
                    class="btn-secondary"
                >
                    <ButtonContent>{{ $t("action.cancel") }}</ButtonContent>
                </ButtonRoot>
            </div>
            <FormError :text="draftError" />
        </form>

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
            @click="fileSpace.onClick"
            @contextmenu="fileSpace.onContextMenu"
            class="grow min-h-0 overflow-auto px-5 pb-4"
            data-testid="gridfs-list"
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
            <div
                v-if="details"
                class="mt-3"
                data-testid="gridfs-details"
            >
                <div class="mb-1 text-[11.5px] text-on-surface-variant">
                    {{ $t("gridfs.details", { name: nameOf(current) }) }}
                </div>
                <div class="h-48 border border-divider rounded-sm">
                    <CodeEditor
                        :key="selected"
                        :label="$t('gridfs.details', { name: nameOf(current) })"
                        :modelValue="details"
                        readonly
                    />
                </div>
            </div>
        </div>
        <ContextMenu ref="spaceMenu" />
    </section>
</template>
