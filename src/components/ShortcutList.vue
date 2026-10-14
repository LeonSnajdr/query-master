<script setup lang="ts">
import { computed } from "vue";
import { GROUPS } from "@/keys/commands";
import { commandsOfGroup, useKeymap } from "@/keys/keymap";

/**
 * The keyboard shortcuts, by group, as the user set them: on the startup page and in
 * Help → Keyboard shortcuts (F12). A command without a key shows only when the user took it away.
 */
const keymap = useKeymap();

const groups = computed(() => GROUPS.map(group => ({
    group,
    items: commandsOfGroup(group).filter(command => keymap.keys(command.id).length > 0 || keymap.changed(command.id))
})).filter(entry => entry.items.length > 0));
</script>

<template>
    <template
        v-for="entry in groups"
        :key="entry.group"
    >
        <h3 class="m-0 mt-3 mb-2 px-2.5 text-[15px] font-semibold text-on-surface-strong">
            {{ $t(`keys.group.${entry.group}`) }}
        </h3>
        <div
            v-for="(command, index) in entry.items"
            :key="command.id"
            :class="index % 2 === 0 ? 'bg-on-surface/4' : ''"
            class="min-h-[25px] flex items-center px-2.5"
            data-testid="shortcut-row"
        >
            <span class="w-1/2 text-on-surface-strong">{{ $t(command.label) }}</span>
            <span class="flex flex-wrap items-center gap-1.5">
                <span
                    v-if="keymap.keys(command.id).length === 0"
                    class="italic text-on-surface-variant"
                >{{ $t("keys.none") }}</span>
                <template
                    v-for="(names, alternative) in keymap.names(command.id)"
                    :key="alternative"
                >
                    <span
                        v-if="alternative > 0"
                        class="px-1 text-on-surface-variant"
                    >{{ $t("keys.or") }}</span>
                    <template
                        v-for="(key, position) in names"
                        :key="position"
                    >
                        <span v-if="position > 0">+</span>
                        <kbd class="px-1.5 rounded-sm border border-divider bg-on-surface/8 font-sans text-[12px] text-on-surface-strong">{{ key }}</kbd>
                    </template>
                </template>
                <span
                    v-if="keymap.changed(command.id)"
                    class="pl-1 text-[11px] text-primary"
                >{{ $t("keys.changed") }}</span>
            </span>
        </div>
    </template>
</template>
