<script setup lang="ts">
import { ButtonRoot } from "@vuetify/v0";
import { computed, nextTick, onMounted, ref, shallowRef, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import MenuList from "@/components/MenuList.vue";
import type { MenuEntry } from "@/menu";
import { convertDraft, DRAFT_TYPES, EMPTY_TYPES, fromDraft, toDraft } from "@/shell/edit";
import type { Draft } from "@/shell/edit";
import type { Json, ValueType } from "@/shell/ejson";

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
}>();

const { t, te } = useI18n();

const initial: Draft = props.value === undefined ? { type: "string", text: "" } : toDraft(props.value);
const draft = ref<Draft>({ ...initial });
const empty = computed(() => EMPTY_TYPES.includes(draft.value.type));
const typeName = computed(() => (te(`result.type.${draft.value.type}`) ? t(`result.type.${draft.value.type}`) : draft.value.type));

const root = useTemplateRef<HTMLDivElement>("root");
const input = useTemplateRef<HTMLInputElement>("input");
const area = useTemplateRef<HTMLTextAreaElement>("area");
const types = useTemplateRef<HTMLDivElement>("types");
const large = useTemplateRef<HTMLDivElement>("large");
const typesAt = shallowRef({ left: 0, top: 0 });
const largeAt = shallowRef({ left: 0, top: 0, width: 480 });
const expanded = shallowRef(false);

onMounted(() => input.value?.select());

function commit() {
    const changed = draft.value.type !== initial.type || draft.value.text !== initial.text;
    emit("close", true);
    if (changed) emit("commit", fromDraft(draft.value));
}

/** Focus that leaves the editor and its menus ends it without writing. */
function onFocusOut(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && root.value?.contains(next)) return;
    emit("close", false);
}

function choose(type: ValueType) {
    draft.value = convertDraft(draft.value, type);
    void nextTick(() => input.value?.select());
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
    input.value?.focus();
}
</script>

<template>
    <div
        ref="root"
        @click.stop
        @dblclick.stop
        @focusout="onFocusOut"
        @keydown.esc.stop="emit('close', true)"
        class="flex items-center min-w-0 bg-surface-variant"
    >
        <input
            ref="input"
            v-model="draft.text"
            @keydown.enter.prevent.stop="commit"
            :aria-label="label"
            :class="empty ? 'text-on-surface-variant/60' : 'text-on-surface-strong'"
            :data-testid="testid"
            :readonly="empty"
            class="grow min-w-0 h-full bg-transparent outline-none font-mono"
            spellcheck="false"
        />
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
