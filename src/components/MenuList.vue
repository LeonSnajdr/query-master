<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { nextTick, shallowRef, useTemplateRef } from "vue";
import { isMenuGroup, isMenuItem } from "@/menu";
import type { MenuEntry, MenuGroup, MenuItem, MenuSwatches } from "@/menu";

const emit = defineEmits<{
    /** An item was chosen: the menu can close. */
    done: [];
}>();
/** The lines of a drop-down or context menu; a group opens its lines in a menu beside it. */
defineProps<{
    entries: MenuEntry[];
}>();

const sub = useTemplateRef<HTMLDivElement>("sub");
/** The group whose menu is open, and where that menu lies. */
const group = shallowRef<MenuGroup>();
const position = shallowRef({ left: 0, top: 0 });

function choose(item: MenuItem) {
    closeGroup();
    emit("done");
    item.action();
}

function chooseColor(row: MenuSwatches, color: string | null) {
    emit("done");
    row.choose(color);
}

/**
 * Opens the menu of a group beside its line. It is a popover inside this menu's popover, so it
 * closes with it, and lies in the top layer, so no scrolling list cuts it off.
 */
async function openGroup(entry: MenuGroup, event: Event) {
    const line = (event.currentTarget as HTMLElement).getBoundingClientRect();
    group.value = entry;
    position.value = { left: line.right - 2, top: line.top - 6 };
    await nextTick();
    const element = sub.value;
    if (!element) return;
    if (!element.matches(":popover-open")) element.showPopover();
    const box = element.getBoundingClientRect();
    // Beside the line; on the left of it, or higher, where the window ends.
    position.value = {
        left: box.width + line.right > window.innerWidth - 4 ? Math.max(4, line.left - box.width + 2) : line.right - 2,
        top: Math.max(4, Math.min(line.top - 6, window.innerHeight - box.height - 4))
    };
}

function closeGroup() {
    if (sub.value?.matches(":popover-open")) sub.value.hidePopover();
    group.value = undefined;
}

function childDone() {
    closeGroup();
    emit("done");
}
</script>

<template>
    <div
        class="min-w-56 py-1.5 text-[13px] select-none"
        data-testid="menu-list"
    >
        <template
            v-for="(entry, index) in entries"
            :key="index"
        >
            <div
                v-if="entry === 'separator'"
                class="my-1 mx-2 border-t border-divider"
                role="separator"
            />
            <ButtonRoot
                v-else-if="isMenuGroup(entry)"
                @click="openGroup(entry, $event)"
                @keydown.right.prevent="openGroup(entry, $event)"
                @mouseenter="openGroup(entry, $event)"
                :aria-expanded="group === entry"
                :class="group === entry ? 'bg-primary/25' : ''"
                aria-haspopup="menu"
                class="w-full h-6.5 px-2.5 flex items-center gap-2.5 text-left text-on-surface-strong hover:bg-primary/25"
                data-testid="menu-group"
            >
                <span
                    :class="entry.icon"
                    class="size-4 shrink-0 text-on-surface"
                />
                <ButtonContent class="grow whitespace-nowrap">
                    {{ entry.label }}
                </ButtonContent>
                <span class="i-lucide-chevron-right size-3.5 text-on-surface-variant" />
            </ButtonRoot>
            <ButtonRoot
                v-else-if="isMenuItem(entry)"
                @click="choose(entry)"
                @mouseenter="closeGroup"
                :class="entry.danger ? 'text-error' : 'text-on-surface-strong'"
                :disabled="entry.disabled"
                class="w-full h-6.5 px-2.5 flex items-center gap-2.5 text-left hover:bg-primary/25 disabled:opacity-40 disabled:hover:bg-transparent"
                data-testid="menu-item"
            >
                <span
                    :class="entry.checked ? 'i-lucide-check' : entry.icon"
                    class="size-4 shrink-0 text-on-surface"
                />
                <ButtonContent class="grow whitespace-nowrap">
                    {{ entry.label }}
                </ButtonContent>
                <span
                    v-if="entry.hotkey"
                    class="pl-6 text-on-surface-variant whitespace-nowrap"
                >{{ entry.hotkey }}</span>
            </ButtonRoot>
            <div
                v-else
                @mouseenter="closeGroup"
                :aria-label="entry.label"
                class="h-7 px-2.5 flex items-center gap-1.5"
                role="group"
            >
                <ButtonRoot
                    @click="chooseColor(entry, null)"
                    :ariaLabel="$t('color.none')"
                    :title="$t('color.none')"
                    class="size-4.5 inline-flex items-center justify-center rounded-full border border-on-surface-variant/60 text-on-surface-variant hover:border-on-surface-strong"
                    data-testid="swatch-none"
                >
                    <span class="i-lucide-x size-3" />
                </ButtonRoot>
                <ButtonRoot
                    v-for="color in entry.swatches"
                    :key="color"
                    @click="chooseColor(entry, color)"
                    :ariaLabel="$t(`color.${color}`)"
                    :class="[`note-${color}`, entry.current === color ? 'outline-2 outline-offset-1 outline-on-surface-strong' : '']"
                    :data-testid="`swatch-${color}`"
                    :title="$t(`color.${color}`)"
                    class="size-4.5 rounded-full outline outline-transparent hover:scale-110 transition-transform"
                />
            </div>
        </template>

        <div
            ref="sub"
            :style="{ left: `${position.left}px`, top: `${position.top}px` }"
            class="menu-panel fixed [inset:auto] m-0 p-0 max-h-[90vh] overflow-y-auto"
            data-testid="sub-menu"
            popover="auto"
        >
            <MenuList
                v-if="group"
                @done="childDone"
                :entries="group.children"
            />
        </div>
    </div>
</template>
