<script setup lang="ts">
import { nextTick, ref, shallowRef, useTemplateRef } from "vue";
import MenuList from "@/components/MenuList.vue";
import type { MenuEntry } from "@/menu";

/**
 * A menu at the pointer. It lies in the browser's top layer (`popover`), so it closes by itself
 * on a click elsewhere and on Escape; v0's Popover is for menus that hang on a button.
 */
const panel = useTemplateRef<HTMLDivElement>("panel");
const entries = ref<MenuEntry[]>([]);
const position = shallowRef({ left: 0, top: 0 });

async function open(event: MouseEvent, items: MenuEntry[]) {
    event.preventDefault();
    if (items.length === 0) return;
    entries.value = items;
    position.value = { left: event.clientX, top: event.clientY };
    await nextTick();
    const element = panel.value;
    if (!element) return;
    element.showPopover();
    // Kept inside the window: moved up or left where it would be cut off.
    const box = element.getBoundingClientRect();
    position.value = {
        left: Math.max(4, Math.min(event.clientX, window.innerWidth - box.width - 4)),
        top: Math.max(4, Math.min(event.clientY, window.innerHeight - box.height - 4))
    };
}

function close() {
    panel.value?.hidePopover();
}

defineExpose({ open });
</script>

<template>
    <div
        ref="panel"
        :style="{ left: `${position.left}px`, top: `${position.top}px` }"
        class="menu-panel fixed [inset:auto] m-0 p-0 max-h-[90vh] overflow-y-auto"
        data-testid="context-menu"
        popover="auto"
    >
        <MenuList
            @done="close"
            :entries
        />
    </div>
</template>
