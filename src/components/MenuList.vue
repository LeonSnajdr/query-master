<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import type { MenuEntry, MenuItem } from "@/menu";

const emit = defineEmits<{
    /** An item was chosen: the menu can close. */
    done: [];
}>();
/** The lines of a drop-down or context menu. */
defineProps<{
    entries: MenuEntry[];
}>();

function choose(item: MenuItem) {
    emit("done");
    item.action();
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
                v-else
                @click="choose(entry)"
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
        </template>
    </div>
</template>
