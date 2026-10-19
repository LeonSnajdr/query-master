<script setup lang="ts">
import { ButtonRoot } from "@vuetify/v0";
import { computed, nextTick, onMounted, ref, shallowRef, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { backend } from "@/api";
import CodeEditor from "@/components/CodeEditor.vue";
import MenuList from "@/components/MenuList.vue";
import { useMessages } from "@/composables/messages";
import { pickFilePath, pickSavePath } from "@/files";
import type { MenuEntry } from "@/menu";
import { convertDraft, DRAFT_TYPES, EMPTY_TYPES, fromDraft, toDraft } from "@/shell/edit";
import type { Draft } from "@/shell/edit";
import type { Json, ValueType } from "@/shell/ejson";
import type { ValueField } from "@/shell/values";

const emit = defineEmits<{
    /** The new value in shell notation; only when it changed. */
    commit: [text: string];
    /** Editing ends; `back` after Enter or Esc, when the view around can take the focus again. */
    close: [back: boolean];
}>();

/**
 * Changes a value in place: the text without its type, the type at the right
 * (a click on it offers the others) and a button for a larger field. Enter writes, Esc leaves.
 */
const props = defineProps<{
    /** The value as it is; `undefined` for a field that is not set. */
    value: Json | undefined;
    label: string;
    /** Test id of the text field. */
    testid: string;
    /** The field the value belongs to: its known values are suggested as in a filter. */
    suggest?: ValueField;
    /** Written in the font of the row (a cell of the table) instead of the editors' one. */
    inheritFont?: boolean;
    /**
     * Grows with the text over the cells beside it, up to the visible width of the results, then
     * wraps (a cell of the table); no scroll bar across.
     */
    grow?: boolean;
}>();

/** Types whose values are suggested: those a filter suggests (strings, numbers, booleans). */
const SUGGESTED: readonly ValueType[] = ["string", "int", "long", "double", "decimal", "bool"];

const { t, te } = useI18n();
const { report } = useMessages();

const initial: Draft = props.value === undefined ? { type: "string", text: "" } : toDraft(props.value);
const draft = ref<Draft>({ ...initial });
const empty = computed(() => EMPTY_TYPES.includes(draft.value.type));
const typeName = computed(() => (te(`result.type.${draft.value.type}`) ? t(`result.type.${draft.value.type}`) : draft.value.type));

/**
 * With suggestions the text is edited in the shell's editor, which lists the known values and
 * searches all data (Ctrl+Space) as it does in a filter; else in a plain field.
 */
const suggest = props.suggest && SUGGESTED.includes(initial.type) ? props.suggest : undefined;

const root = useTemplateRef<HTMLDivElement>("root");
const input = useTemplateRef<HTMLInputElement>("input");
const code = useTemplateRef<InstanceType<typeof CodeEditor>>("code");
const area = useTemplateRef<HTMLTextAreaElement>("area");
const types = useTemplateRef<HTMLDivElement>("types");
const large = useTemplateRef<HTMLDivElement>("large");
const typesAt = shallowRef({ left: 0, top: 0 });
const largeAt = shallowRef({ left: 0, top: 0, width: 480 });
const expanded = shallowRef(false);

onMounted(() => {
    input.value?.select();
    if (props.grow) measureRoom();
});

/** At least the cell (and room to type), at most up to the right edge of the results shown. */
const room = shallowRef<{ minWidth?: string; maxWidth?: string }>({});
function measureRoom() {
    const cell = root.value?.parentElement?.getBoundingClientRect();
    const results = root.value?.closest("[data-testid=query-result]")?.getBoundingClientRect();
    if (!cell) return;
    const least = Math.max(cell.width, 224);
    const most = results ? Math.max(least, results.right - cell.left - 16) : least;
    room.value = { minWidth: `${least}px`, maxWidth: `${most}px` };
}

/** Shift+Enter, as in DataGrip: the value in the large editor. */
function onShiftEnter(event: KeyboardEvent) {
    if (event.key !== "Enter" || !event.shiftKey || expanded.value) return;
    event.preventDefault();
    event.stopPropagation();
    void openLarge();
}

function focusField() {
    if (code.value) code.value.focus();
    else input.value?.select();
}

/** A value chosen from the list brings its type: `2` stays a number in a field shown as text. */
function pick(value: Json) {
    draft.value = toDraft(value);
}

/** Esc that closed the list of suggestions leaves the editor open. */
function onEscape(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    event.stopPropagation();
    emit("close", true);
}

function commit() {
    const changed = draft.value.type !== initial.type || draft.value.text !== initial.text;
    emit("close", true);
    if (changed) emit("commit", fromDraft(draft.value));
}

/** Focus that leaves the editor and its menus ends it without writing. */
function onFocusOut(event: FocusEvent) {
    // A file dialog takes the focus away for a while: the editor stays.
    if (picking.value) return;
    const next = event.relatedTarget as Node | null;
    if (next && root.value?.contains(next)) return;
    emit("close", false);
}

/** A file dialog of *Open file* or *Save file* is open. */
const picking = shallowRef(false);
const datePicker = useTemplateRef<HTMLInputElement>("datePicker");

/** calendar: the browser's date and time picker, in local time. */
function openCalendar() {
    const input = datePicker.value;
    if (!input) return;
    const at = new Date(draft.value.text);
    const local = Number.isNaN(at.getTime()) ? new Date() : at;
    input.value = new Date(local.getTime() - local.getTimezoneOffset() * 60000).toISOString().slice(0, 23);
    input.showPicker();
}

function pickDate() {
    const value = datePicker.value?.value;
    if (!value) return;
    const at = new Date(value);
    if (!Number.isNaN(at.getTime())) draft.value = { ...draft.value, text: at.toISOString() };
}

/** *Open file*: the bytes of a file become the binary value. */
async function loadFile() {
    picking.value = true;
    try {
        const path = await pickFilePath();
        if (path) draft.value = { ...draft.value, text: await backend.readBase64File(path) };
    } catch (error) {
        report(error);
    } finally {
        picking.value = false;
        focusField();
    }
}

/** *Save file*: the binary value into a file. */
async function saveFile() {
    picking.value = true;
    try {
        const path = await pickSavePath(`${props.label || "value"}.bin`);
        if (path) await backend.writeBase64File(path, draft.value.text);
    } catch (error) {
        report(error);
    } finally {
        picking.value = false;
        focusField();
    }
}

function choose(type: ValueType) {
    draft.value = convertDraft(draft.value, type);
    void nextTick(focusField);
}

function item(type: ValueType): MenuEntry {
    return {
        label: t(`edit.types.${type}`),
        hotkey: te(`result.type.${type}`) ? t(`result.type.${type}`) : undefined,
        checked: draft.value.type === type,
        action: () => choose(type)
    };
}

const entries = computed<MenuEntry[]>(() => [
    { label: t("edit.more"), children: DRAFT_TYPES.more.map(item) },
    "separator",
    ...DRAFT_TYPES.main.map(type => (type === "separator" ? type : item(type)))
]);

/** Opens the type menu below the type, right aligned with it; above it where the window ends. */
async function openTypes(event: MouseEvent) {
    const element = types.value;
    if (!element) return;
    if (element.matches(":popover-open")) {
        element.hidePopover();
        return;
    }
    const button = (event.currentTarget as HTMLElement).getBoundingClientRect();
    element.showPopover();
    await nextTick();
    const box = element.getBoundingClientRect();
    typesAt.value = {
        left: Math.max(4, Math.min(button.right - box.width, window.innerWidth - box.width - 4)),
        top: button.bottom + box.height > window.innerHeight - 4 ? Math.max(4, button.top - box.height) : button.bottom
    };
}

function closeTypes() {
    if (types.value?.matches(":popover-open")) types.value.hidePopover();
}

/** The larger field below the editor (above it where the window ends), at least 30rem wide. */
async function openLarge() {
    const element = large.value;
    const line = root.value?.getBoundingClientRect();
    if (!element || !line) return;
    closeTypes();
    expanded.value = true;
    const width = Math.min(Math.max(line.width, 480), window.innerWidth - 8);
    element.showPopover();
    await nextTick();
    const height = element.getBoundingClientRect().height;
    largeAt.value = {
        left: Math.max(4, Math.min(line.left, window.innerWidth - width - 4)),
        top: line.bottom + height > window.innerHeight - 4 ? Math.max(4, line.top - height - 2) : line.bottom + 2,
        width
    };
    area.value?.focus();
}

function closeLarge() {
    if (large.value?.matches(":popover-open")) large.value.hidePopover();
    expanded.value = false;
    if (code.value) code.value.focus();
    else input.value?.focus();
}
</script>

<template>
    <div
        ref="root"
        @click.stop
        @dblclick.stop
        @focusout="onFocusOut"
        @keydown.capture="onShiftEnter"
        @keydown.esc="onEscape"
        :style="room"
        class="relative flex items-center min-w-0 bg-surface-variant"
    >
        <CodeEditor
            v-if="suggest"
            ref="code"
            v-model="draft.text"
            @pick="pick"
            @run="commit"
            :class="inheritFont ? '' : 'font-mono'"
            :grow
            :inheritFont
            :label
            :testid
            :valueField="suggest"
            class="grow min-w-0 h-full"
            compact
            singleLine
        />
        <input
            v-else
            ref="input"
            v-model="draft.text"
            @keydown.enter.prevent.stop="commit"
            :aria-label="label"
            :class="[empty ? 'text-on-surface-variant/60' : 'text-on-surface-strong', inheritFont ? '' : 'font-mono']"
            :data-testid="testid"
            :readonly="empty"
            :size="grow ? Math.max(4, draft.text.length + 1) : undefined"
            class="grow min-w-0 h-full bg-transparent outline-none"
            spellcheck="false"
        />
        <!--: a calendar for a date, open and save a file for binary data. -->
        <template v-if="draft.type === 'date'">
            <input
                ref="datePicker"
                @change="pickDate"
                aria-hidden="true"
                class="absolute right-12 bottom-0 w-0 h-0 opacity-0"
                step="0.001"
                tabindex="-1"
                type="datetime-local"
            />
            <ButtonRoot
                @click="openCalendar"
                @mousedown.prevent
                :ariaLabel="$t('edit.calendar')"
                :title="$t('edit.calendar')"
                class="shrink-0 w-4.5 h-full inline-flex items-center justify-center text-on-surface-variant hover:text-on-surface-strong hover:bg-on-surface/10"
                data-testid="edit-calendar"
                tabindex="-1"
            >
                <span class="i-lucide-calendar size-3" />
            </ButtonRoot>
        </template>
        <template v-if="draft.type === 'binary'">
            <ButtonRoot
                @click="loadFile"
                @mousedown.prevent
                :ariaLabel="$t('edit.openFile')"
                :title="$t('edit.openFile')"
                class="shrink-0 w-4.5 h-full inline-flex items-center justify-center text-on-surface-variant hover:text-on-surface-strong hover:bg-on-surface/10"
                data-testid="edit-open-file"
                tabindex="-1"
            >
                <span class="i-lucide-folder-open size-3" />
            </ButtonRoot>
            <ButtonRoot
                @click="saveFile"
                @mousedown.prevent
                :ariaLabel="$t('edit.saveFile')"
                :disabled="!draft.text"
                :title="$t('edit.saveFile')"
                class="shrink-0 w-4.5 h-full inline-flex items-center justify-center text-on-surface-variant hover:text-on-surface-strong hover:bg-on-surface/10 disabled:opacity-40"
                data-testid="edit-save-file"
                tabindex="-1"
            >
                <span class="i-lucide-save size-3" />
            </ButtonRoot>
        </template>
        <ButtonRoot
            @click="openTypes"
            @mousedown.prevent
            :ariaLabel="$t('edit.type')"
            :title="$t('edit.type')"
            class="shrink-0 px-1 h-full text-[11px] font-sans text-on-surface-variant hover:text-on-surface-strong hover:bg-on-surface/10"
            data-testid="edit-type"
            tabindex="-1"
        >
            {{ typeName }}
        </ButtonRoot>
        <ButtonRoot
            @click="openLarge"
            @mousedown.prevent
            :ariaLabel="$t('edit.expand')"
            :title="$t('edit.expand')"
            class="shrink-0 w-4.5 h-full inline-flex items-center justify-center text-on-surface-variant hover:text-on-surface-strong hover:bg-on-surface/10"
            data-testid="edit-expand"
            tabindex="-1"
        >
            <span class="i-lucide-maximize-2 size-3" />
        </ButtonRoot>
        <div
            ref="types"
            @mousedown.prevent
            :style="{ left: `${typesAt.left}px`, top: `${typesAt.top}px` }"
            class="menu-panel fixed [inset:auto] m-0 p-0"
            data-testid="edit-types"
            popover="auto"
        >
            <MenuList
                @done="closeTypes"
                :entries
            />
        </div>
        <div
            ref="large"
            :style="{ left: `${largeAt.left}px`, top: `${largeAt.top}px`, width: `${largeAt.width}px` }"
            class="menu-panel fixed [inset:auto] m-0 p-1.5 flex-col gap-1 [&:popover-open]:flex"
            popover="manual"
        >
            <textarea
                v-if="expanded"
                ref="area"
                v-model="draft.text"
                @keydown.ctrl.enter.prevent.stop="commit"
                @keydown.esc.stop="closeLarge"
                :aria-label="label"
                :readonly="empty"
                class="h-40 resize-y p-1.5 bg-surface-variant border border-divider rounded-sm outline-none font-mono text-[12.5px] text-on-surface-strong focus:border-primary"
                data-testid="edit-large"
                spellcheck="false"
            />
            <span class="flex items-center justify-between text-[11px] font-sans text-on-surface-variant">
                {{ $t("edit.largeHint") }}
                <span>{{ typeName }}</span>
            </span>
        </div>
    </div>
</template>
