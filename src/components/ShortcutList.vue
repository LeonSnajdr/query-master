<script setup lang="ts">
/** The keyboard shortcuts, by group: on the startup page and in Help → Keyboard shortcuts (F12). */

/** The keys of each shortcut; their names are those printed on keyboards. */
const SHORTCUTS: { group: string; items: { action: string; keys: string[] }[] }[] = [
    {
        group: "shortcut.group.editor",
        items: [
            { action: "shortcut.complete", keys: ["Ctrl", "Space"] },
            { action: "shortcut.run", keys: ["Ctrl", "Enter"] },
            { action: "shortcut.run", keys: ["F5"] },
            { action: "shortcut.comment", keys: ["Ctrl", "/"] },
            { action: "shortcut.indent", keys: ["Ctrl", "]"] },
            { action: "shortcut.outdent", keys: ["Ctrl", "["] },
            { action: "shortcut.undo", keys: ["Ctrl", "Z"] }
        ]
    },
    {
        group: "shortcut.group.app",
        items: [
            { action: "connection.list.hint", keys: ["F2"] },
            { action: "connection.add", keys: ["Ctrl", "F2"] },
            { action: "tab.browse", keys: ["Ctrl", "Q"] },
            { action: "tab.shell", keys: ["Ctrl", "T"] },
            { action: "tab.aggregation", keys: ["Ctrl", "Shift", "Q"] },
            { action: "tab.sql", keys: ["Ctrl", "Alt", "Q"] },
            { action: "folder.add", keys: ["Ctrl", "G"] },
            { action: "action.refresh", keys: ["Ctrl", "R"] },
            { action: "view.tree", keys: ["Alt", "1"] },
            { action: "view.table", keys: ["Alt", "2"] },
            { action: "view.json", keys: ["Alt", "3"] },
            { action: "tab.next", keys: ["Ctrl", "Tab"] },
            { action: "tab.duplicate", keys: ["Ctrl", "Shift", "T"] },
            { action: "tab.close.current", keys: ["Ctrl", "W"] },
            { action: "focus.tree", keys: ["F4"] },
            { action: "focus.editor", keys: ["F6"] },
            { action: "focus.results", keys: ["F7"] },
            { action: "help.shortcuts", keys: ["F12"] }
        ]
    },
    {
        group: "shortcut.group.results",
        items: [
            { action: "result.pin", keys: ["Ctrl", "P"] },
            { action: "result.expand.node", keys: ["Ctrl", "J"] },
            { action: "result.collapse.node", keys: ["Ctrl", "Shift", "J"] },
            { action: "result.export", keys: ["Ctrl", "S"] },
            { action: "result.import", keys: ["Ctrl", "O"] },
            { action: "result.importClipboard", keys: ["Ctrl", "Shift", "V"] }
        ]
    }
];
</script>

<template>
    <template
        v-for="group in SHORTCUTS"
        :key="group.group"
    >
        <h3 class="m-0 mt-3 mb-2 px-2.5 text-[15px] font-semibold text-on-surface-strong">
            {{ $t(group.group) }}
        </h3>
        <div
            v-for="(item, index) in group.items"
            :key="index"
            :class="index % 2 === 0 ? 'bg-on-surface/4' : ''"
            class="h-[25px] flex items-center px-2.5"
        >
            <span class="w-1/2 text-on-surface-strong">{{ $t(item.action) }}</span>
            <span class="flex items-center gap-1.5">
                <template
                    v-for="(key, position) in item.keys"
                    :key="key"
                >
                    <span v-if="position > 0">+</span>
                    <kbd class="px-1.5 rounded-sm border border-divider bg-on-surface/8 font-sans text-[12px] text-on-surface-strong">{{ key }}</kbd>
                </template>
            </span>
        </div>
    </template>
</template>
