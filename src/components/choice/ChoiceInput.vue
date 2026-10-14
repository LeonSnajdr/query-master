<script setup lang="ts">
import { ButtonRoot, ComboboxActivator, ComboboxContent, ComboboxItem, createCombobox, provideComboboxContext } from "@vuetify/v0";
import type { ComboboxAdapter, ID } from "@vuetify/v0";
import { computed, nextTick, shallowRef, toRef, useTemplateRef, watch } from "vue";
import { filterChoices } from "@/choice";
import type { Choice } from "@/choice";
import ChoiceLabel from "./ChoiceLabel.vue";

/**
 * Free text with suggestions (v0 `createCombobox`): what is typed is the value; the list shows the
 * entries containing it and takes one over with a click, Enter or Tab. A text no entry has is
 * offered first as a new name. Esc puts back the value the field had when the list opened.
 */
const props = defineProps<{
    options: Choice<string>[];
    label: string;
    compact?: boolean;
    loading?: boolean;
    placeholder?: string;
    disabled?: boolean;
    /** Shows "new" in the field while its text is none of the entries (a collection to create). */
    markNew?: boolean;
}>();
const model = defineModel<string>({ required: true });
defineOptions({ inheritAttrs: false });

// The list is filtered and ordered here (entries starting with the text first); every entry
// drawn is one that matches.
const adapter: ComboboxAdapter = {
    setup: ({ items }) => ({
        filtered: computed(() => new Set(items.value.map(ticket => ticket.id))),
        isLoading: shallowRef(false),
        isEmpty: computed(() => items.value.length === 0)
    })
};
const combobox = createCombobox({ disabled: toRef(() => props.disabled ?? false), adapter });
provideComboboxContext("v0:combobox", combobox);
combobox.popover.positionArea.value = "bottom span-right";
combobox.popover.positionTry.value = "flip-block, flip-inline, flip-block flip-inline";
const { cursor, query, isOpen } = combobox;

/** The value of the line "New: …", which keeps the typed text. */
const NEW = "\u0000new";

/** Taking over an entry, by click, Enter or Tab: its value, and the list closes. */
function take(id: ID) {
    const ticket = combobox.selection.get(id);
    if (ticket) model.value = ticket.value === NEW ? query.value.trim() : String(ticket.value);
    combobox.close();
}
// The items and Enter of v0 go through `select`; here it sets the text, it does not select.
combobox.select = take;

const input = useTemplateRef<HTMLInputElement>("input");
watch(input, (element) => {
    combobox.inputEl.value = element;
});

const shown = computed(() => filterChoices(props.options, query.value));
/** Typed, and no entry is exactly that: the text can be taken as a new name. */
const fresh = computed(() => query.value.trim() !== "" && !props.options.some(option => option.value === query.value.trim()));
const empty = computed(() => shown.value.length === 0 && !fresh.value && !props.loading);
/** The field holds a text none of the entries has, and the entries are known. */
const isNew = computed(() => props.markNew === true && !props.loading && model.value.trim() !== "" && !props.options.some(option => option.value === model.value.trim()));

/** Empties the field, the list stays as it was. */
function clear() {
    model.value = "";
    input.value?.focus();
}

/** The value when the list opened, for Esc. */
let before = "";

/** Opens the list; opened without typing, the current entry is marked and in view. */
async function open() {
    if (props.disabled || isOpen.value) return;
    combobox.open();
    // Opened by typing: `onInput` kept the value from before the first letter.
    if (!combobox.pristine.value) return;
    before = model.value;
    await nextTick();
    const current = combobox.selection.values().find(ticket => ticket.value === model.value);
    if (current) cursor.highlight(current.id);
}

// The entries register anew with each letter; a mark from before would point at nothing.
watch(query, () => cursor.clear());

function onInput(event: Event) {
    const text = (event.target as HTMLInputElement).value;
    if (!isOpen.value) before = model.value;
    model.value = text;
    combobox.pristine.value = false;
    query.value = text;
    void open();
}

const PAGE = 10;

function onKeydown(event: KeyboardEvent) {
    if (!isOpen.value) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            void open();
        }
        return;
    }
    const highlighted = cursor.highlightedId.value;
    switch (event.key) {
        case "Enter":
            // Without a marked entry the typed text stays and Enter goes on (a form submits).
            if (highlighted === undefined) {
                combobox.close();
                break;
            }
            event.preventDefault();
            event.stopPropagation();
            take(highlighted);
            break;
        case "Escape":
            // A list with nothing in it is not shown: Esc then goes on (closes the dialog, the row).
            if (!empty.value) {
                event.preventDefault();
                event.stopPropagation();
                model.value = before;
            }
            combobox.close();
            break;
        case "Tab":
            if (highlighted === undefined) combobox.close();
            else take(highlighted);
            break;
        case "PageDown":
        case "PageUp":
            event.preventDefault();
            event.stopPropagation();
            for (let step = 0; step < PAGE; step++) {
                if (event.key === "PageDown") cursor.next();
                else cursor.prev();
            }
            break;
        case "ArrowDown":
        case "ArrowUp":
        case "Home":
        case "End":
            event.preventDefault();
            event.stopPropagation();
            if (event.altKey && event.key === "ArrowUp") combobox.close();
            else cursor.onKeydown(event);
    }
}
</script>

<template>
    <ComboboxActivator
        class="relative w-full"
        data-testid="choice-field"
        data-free
    >
        <input
            v-bind="$attrs"
            :id="combobox.inputId"
            ref="input"
            @click="open()"
            @input="onInput"
            @keydown="onKeydown"
            :aria-controls="combobox.listboxId"
            :aria-expanded="isOpen"
            :aria-label="label"
            :class="[compact ? 'h-7!' : '', isOpen ? 'border-primary' : '']"
            :disabled
            :placeholder
            :style="{ paddingRight: `${1.75 + (model && !disabled ? 1.25 : 0) + (loading ? 1.25 : 0) + (isNew ? 2.25 : 0)}rem` }"
            :title="model"
            :value="model"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            autocomplete="off"
            class="field choice-field w-full disabled:opacity-60"
            role="combobox"
            spellcheck="false"
        />
        <!-- Right in the field: "new", loading, clear, the chevron; clicks keep the focus in the text. -->
        <div
            @mousedown.prevent
            class="absolute inset-y-0 right-2 flex items-center gap-1 text-on-surface-variant"
        >
            <span
                v-if="isNew"
                class="badge-new"
                data-testid="choice-new-mark"
            >{{ $t("choice.new") }}</span>
            <span
                v-if="loading"
                class="i-lucide-loader-circle size-3.5 animate-spin"
            />
            <ButtonRoot
                v-if="model && !disabled"
                @click="clear"
                :ariaLabel="$t('choice.clear')"
                :title="$t('choice.clear')"
                class="size-4 inline-flex items-center justify-center rounded-sm hover:text-on-surface-strong"
                data-testid="choice-clear"
                tabindex="-1"
            >
                <span class="i-lucide-x size-3.5" />
            </ButtonRoot>
            <span
                @click="isOpen ? combobox.close() : open()"
                :class="isOpen ? 'rotate-180' : ''"
                aria-hidden="true"
                class="i-lucide-chevron-down size-4 transition-transform"
            />
        </div>
        <ComboboxContent
            :class="empty ? 'hidden!' : ''"
            class="choice-list"
        >
            <div
                v-if="loading"
                class="choice-option text-on-surface-variant"
            >
                <span class="i-lucide-loader-circle size-4 shrink-0 animate-spin" />{{ $t("choice.loading") }}
            </div>
            <!-- Keyed by the text: the entries register anew in the order shown, which the arrow keys follow. -->
            <ComboboxItem
                v-if="fresh"
                :key="`${query}\u0000new`"
                v-slot="{ attrs }"
                :value="NEW"
                renderless
            >
                <div
                    @mousedown.prevent
                    v-bind="attrs"
                    class="choice-option"
                    data-testid="choice-new"
                >
                    <span class="i-lucide-plus size-4 shrink-0 text-success" />
                    <span class="grow min-w-0 truncate">
                        <span class="text-on-surface-variant">{{ $t("choice.useNew") }}</span>
                        {{ query.trim() }}
                    </span>
                    <span
                        v-if="cursor.highlightedId.value === undefined"
                        class="shrink-0 pl-4 text-[12px] text-on-surface-variant"
                    >Enter</span>
                </div>
            </ComboboxItem>
            <div
                v-if="fresh && shown.length > 0"
                class="my-1 mx-1 border-t border-divider"
                role="separator"
            />
            <template
                v-for="option in shown"
                :key="`${query}\u0000${option.value}`"
            >
                <ComboboxItem
                    v-slot="{ attrs }"
                    :disabled="option.disabled"
                    :value="option.value"
                    renderless
                >
                    <div
                        @mousedown.prevent
                        v-bind="attrs"
                        class="choice-option"
                        data-testid="choice-option"
                    >
                        <ChoiceLabel
                            :choice="option"
                            :current="option.value === model"
                            :query
                        />
                    </div>
                </ComboboxItem>
            </template>
        </ComboboxContent>
    </ComboboxActivator>
</template>
