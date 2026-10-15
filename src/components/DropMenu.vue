<script setup lang="ts">
import { PopoverActivator, PopoverContent, PopoverRoot } from "@vuetify/v0";
import { computed, nextTick, shallowRef, useTemplateRef, watch } from "vue";
import { matchRange } from "@/choice";
import MenuList from "@/components/MenuList.vue";
import { isMenuItem } from "@/menu";
import type { MenuEntry } from "@/menu";

/** A button that opens a menu below itself. The default slot is the button's content. */
const props = withDefaults(defineProps<{
    entries: MenuEntry[];
    label: string;
    /** Where the menu lies relative to the button (CSS `position-area`). */
    positionArea?: string;
    /** With more items than this, a field on top filters them by name, as in a choice field. */
    filterAbove?: number;
}>(), {
    positionArea: "bottom span-right",
    filterAbove: Infinity
});

const open = shallowRef(false);
const text = shallowRef("");
const filterInput = useTemplateRef<HTMLInputElement>("filterInput");

const filtering = computed(() => props.entries.filter(isMenuItem).length > props.filterAbove);
/** While filtering: only the items whose name contains the text, without separators. */
const shown = computed(() => (filtering.value && text.value.trim() ? props.entries.filter(entry => isMenuItem(entry) && matchRange(entry.label, text.value)) : props.entries));

watch(open, async (isOpen) => {
    text.value = "";
    if (!isOpen || !filtering.value) return;
    await nextTick();
    filterInput.value?.focus();
});

/** Enter in the filter takes the first item left. */
function takeFirst() {
    const first = shown.value.find(isMenuItem);
    if (!first || first.disabled) return;
    open.value = false;
    first.action();
}
</script>

<template>
    <PopoverRoot v-model="open">
        <PopoverActivator
            :aria-label="label"
            :title="label"
        >
            <slot />
        </PopoverActivator>
        <!-- At most as high as the room beside the button (the area of `position-area`); the list scrolls. -->
        <PopoverContent
            :positionArea
            class="menu-panel max-h-[calc(100%-0.5rem)] flex-col [&:popover-open]:flex"
        >
            <div
                v-if="filtering"
                class="px-2 pt-2"
            >
                <input
                    ref="filterInput"
                    v-model="text"
                    @keydown.enter.prevent="takeFirst"
                    :aria-label="$t('menu.filter')"
                    :placeholder="$t('menu.filter')"
                    class="field h-7! w-full"
                    data-testid="menu-filter"
                    spellcheck="false"
                />
            </div>
            <MenuList
                @done="open = false"
                :entries="shown"
                class="min-h-0 overflow-y-auto"
            />
        </PopoverContent>
    </PopoverRoot>
</template>
