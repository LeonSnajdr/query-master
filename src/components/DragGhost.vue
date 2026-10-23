<script setup lang="ts">
import { useTemplateRef, watch } from "vue";
import { useDragGhost } from "@/composables/dragGhost";

/**
 * The card at the pointer while rows are dragged: what moves, and where it would land. A popover
 * of its own, so it is drawn above the connection list, which is one too.
 */
const { ghost } = useDragGhost();
const card = useTemplateRef<HTMLElement>("card");

watch(() => ghost.visible, (visible) => {
    if (!card.value) return;
    if (visible) card.value.showPopover();
    else card.value.hidePopover();
});
</script>

<template>
    <div
        ref="card"
        :class="ghost.target === undefined ? 'border-divider opacity-80' : 'border-primary'"
        :style="{ translate: `${ghost.x + 14}px ${ghost.y + 12}px` }"
        aria-hidden="true"
        class="fixed inset-auto left-0 top-0 m-0 pointer-events-none max-w-80 flex-col gap-0.5 px-2 py-1 rounded-sm bg-dock text-on-surface border shadow-[0_6px_20px_rgb(0_0_0/0.4)] text-[12.5px] [&:popover-open]:flex"
        data-testid="drag-ghost"
        popover="manual"
    >
        <span class="flex items-center gap-1.5 min-w-0">
            <span
                :class="ghost.icon"
                class="size-4 shrink-0"
            />
            <span class="truncate text-on-surface-strong">{{ ghost.label }}</span>
            <span
                v-if="ghost.count > 1"
                class="shrink-0 px-1 rounded-sm bg-primary/25 text-on-surface-strong text-[11px]"
            >{{ ghost.count }}</span>
        </span>
        <span
            :class="ghost.target === undefined ? 'text-on-surface-variant' : 'text-primary'"
            class="flex items-center gap-1 text-[11.5px]"
            data-testid="drag-ghost-target"
        >
            <span
                :class="ghost.target === undefined ? 'i-lucide-ban' : 'i-lucide-corner-down-right'"
                class="size-3.5 shrink-0"
            />
            <span class="truncate">{{ ghost.target ?? $t("drag.notHere") }}</span>
        </span>
    </div>
</template>
