<script setup lang="ts">
import { PopoverActivator, PopoverContent, PopoverRoot } from "@vuetify/v0";
import { shallowRef } from "vue";
import MenuList from "@/components/MenuList.vue";
import type { MenuEntry } from "@/menu";

/** A button that opens a menu below itself. The default slot is the button's content. */
withDefaults(defineProps<{
    entries: MenuEntry[];
    label: string;
    /** Where the menu lies relative to the button (CSS `position-area`). */
    positionArea?: string;
}>(), {
    positionArea: "bottom span-right"
});

const open = shallowRef(false);
</script>

<template>
    <PopoverRoot v-model="open">
        <PopoverActivator
            :aria-label="label"
            :title="label"
        >
            <slot />
        </PopoverActivator>
        <PopoverContent
            :positionArea
            class="menu-panel"
        >
            <MenuList
                @done="open = false"
                :entries
            />
        </PopoverContent>
    </PopoverRoot>
</template>
