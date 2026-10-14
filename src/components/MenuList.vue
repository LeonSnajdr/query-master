<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { isMenuItem } from "@/menu";
import type { MenuEntry, MenuItem, MenuSwatches } from "@/menu";

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

function chooseColor(row: MenuSwatches, color: string | null) {
    emit("done");
    row.choose(color);
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
                v-else-if="isMenuItem(entry)"
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
            <div
                v-else
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
    </div>
</template>
