<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { useActions } from "@/composables/actions";
import { useConnectionsStore } from "@/stores/connections";

/** The page shown at start: the saved connections and the keyboard shortcuts. */
const actions = useActions();
const connections = useConnectionsStore();

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
            { action: "action.refresh", keys: ["Ctrl", "R"] },
            { action: "view.tree", keys: ["Alt", "1"] },
            { action: "view.table", keys: ["Alt", "2"] },
            { action: "view.json", keys: ["Alt", "3"] },
            { action: "tab.next", keys: ["Ctrl", "Tab"] },
            { action: "tab.duplicate", keys: ["Ctrl", "Shift", "T"] },
            { action: "tab.close.current", keys: ["Ctrl", "W"] }
        ]
    }
];
</script>

<template>
    <div class="h-full overflow-y-auto px-7 py-5 text-[13px] text-on-surface">
        <div class="max-w-[450px]">
            <h2 class="start-title">
                {{ $t("start.recent") }}
            </h2>
            <p
                v-if="connections.saved.length === 0"
                class="m-0 mb-2 text-on-surface-variant"
            >
                {{ $t("connection.empty") }}
            </p>
            <ButtonRoot
                v-for="profile in connections.saved"
                :key="profile.id"
                @click="actions.connect(profile)"
                class="w-full h-[23px] flex items-center gap-2 text-left hover:bg-on-surface/6"
                data-testid="recent-connection"
            >
                <span
                    :class="connections.connecting.has(profile.id) ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-server'"
                    class="size-4 shrink-0"
                />
                <ButtonContent class="text-on-surface-strong">
                    {{ profile.name }}
                </ButtonContent>
                <span class="truncate text-on-surface-variant">{{ profile.address.replace(/^mongodb(\+srv)?:\/\//, "") }}</span>
            </ButtonRoot>
            <div class="mt-2 flex items-baseline gap-2.5">
                <ButtonRoot
                    @click="actions.newConnection()"
                    class="font-bold text-primary underline decoration-dotted underline-offset-4 hover:brightness-125"
                    data-testid="start-create"
                >
                    <ButtonContent>{{ $t("connection.create") }}</ButtonContent>
                </ButtonRoot>
                <span>{{ $t("start.or") }}</span>
                <ButtonRoot
                    @click="actions.connectFromUri()"
                    class="text-primary underline decoration-dotted underline-offset-4 hover:brightness-125"
                    data-testid="start-from-uri"
                >
                    <ButtonContent>{{ $t("connection.connectFromUri") }}</ButtonContent>
                </ButtonRoot>
            </div>

            <h2 class="start-title mt-14">
                {{ $t("start.shortcuts") }}
            </h2>
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
        </div>
    </div>
</template>
