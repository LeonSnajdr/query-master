<script setup lang="ts">
import { DialogContent, DialogRoot } from "@vuetify/v0";
import { computed, nextTick, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { SavedQuery } from "@/api";
import { useActions } from "@/composables/actions";
import { useMessages } from "@/composables/messages";
import { COMMANDS } from "@/keys/commands";
import type { CommandId } from "@/keys/commands";
import { canRun, runCommand, useKeymap } from "@/keys/keymap";
import { paletteItems, remember } from "@/palette/search";
import type { PaletteGroup, PaletteItem, Ranked } from "@/palette/search";
import { useConnectionsStore } from "@/stores/connections";
import { useQueriesStore } from "@/stores/queries";

/**
 * "Search everything" (stage 22, `Ctrl+Shift+P`): collections of the open connections, saved
 * queries, commands and connections in one field and one list, in the look of the choice fields.
 */
const open = defineModel<boolean>({ default: false });

/** What an entry does: the thing behind it. */
type Entry = PaletteItem & (
    | { kind: "collection"; connectionId: string; database: string; collection: string }
    | { kind: "query"; query: SavedQuery }
    | { kind: "command"; command: CommandId }
    | { kind: "connection"; connectionId: string }
);

/** Commands the palette does not offer: itself, and those of a part of the window it would leave. */
const SKIPPED: CommandId[] = ["palette.open"];

const { t } = useI18n();
const { report } = useMessages();
const actions = useActions();
const keymap = useKeymap();
const connections = useConnectionsStore();
const queries = useQueriesStore();

const text = shallowRef("");
const highlighted = shallowRef(0);
/** Recently used entries, for this run of the app only. */
const recent = shallowRef<string[]>([]);
const input = useTemplateRef<HTMLInputElement>("input");
const list = useTemplateRef<HTMLElement>("list");

const connected = computed(() => connections.profiles.filter(profile => connections.sessions[profile.id]));

const entries = computed<Entry[]>(() => {
    const result: Entry[] = [];
    for (const profile of connected.value) {
        const production = profile.environment === "production";
        for (const database of connections.sessions[profile.id]?.databases ?? []) {
            for (const collection of database.collections ?? []) {
                result.push({ kind: "collection", key: `c:${profile.id}/${database.name}/${collection}`, group: "collection", label: collection, detail: `${profile.name} › ${database.name}`, production, connectionId: profile.id, database: database.name, collection });
            }
        }
        for (const query of queries.of(profile.id)) {
            result.push({ kind: "query", key: `q:${query.id}`, group: "query", label: query.name, detail: `${query.database}${query.collection ? `.${query.collection}` : ""}`, production, query });
        }
    }
    for (const command of COMMANDS) {
        if (command.scope !== "global" || SKIPPED.includes(command.id)) continue;
        result.push({ kind: "command", key: `k:${command.id}`, group: "command", label: t(command.label), detail: keymap.label(command.id), disabled: canRun(command.id) ? undefined : t("palette.unavailable"), command: command.id });
    }
    for (const profile of connections.profiles) {
        if (connections.isTransient(profile.id)) continue;
        result.push({ kind: "connection", key: `n:${profile.id}`, group: "connection", label: profile.name, detail: profile.address.replace(/^mongodb(\+srv)?:\/\//, ""), production: profile.environment === "production", connectionId: profile.id });
    }
    return result;
});

const shown = computed<Ranked<Entry>[]>(() => paletteItems(entries.value, text.value, recent.value));

watch(open, async (isOpen) => {
    if (!isOpen) return;
    text.value = "";
    highlighted.value = 0;
    // Databases whose collections were never read: read now, the list grows without the choice jumping.
    for (const profile of connected.value) {
        for (const database of connections.sessions[profile.id]?.databases ?? []) {
            if (!database.collections && !database.loading) void connections.loadCollections(profile.id, database.name).catch(() => undefined);
        }
    }
    await nextTick();
    input.value?.focus();
});
watch(text, () => (highlighted.value = 0));

function move(by: number) {
    const count = shown.value.length;
    if (count === 0) return;
    highlighted.value = (highlighted.value + by + count) % count;
    void nextTick(() => list.value?.querySelector("[data-highlighted]")?.scrollIntoView({ block: "nearest" }));
}

/** Runs an entry; `newTab` (Ctrl+Enter, Ctrl+click) opens a collection or a query in a tab of its own. */
async function choose(entry: Entry | undefined, newTab = false) {
    if (!entry || entry.disabled) return;
    recent.value = remember(recent.value, entry.key);
    open.value = false;
    try {
        if (entry.kind === "collection") {
            const at = { connectionId: entry.connectionId, database: entry.database, collection: entry.collection };
            connections.selected = at;
            actions.browse(at, newTab);
        } else if (entry.kind === "query") {
            queries.open(entry.query, newTab);
        } else if (entry.kind === "command") {
            // After the palette has closed: the command may open a dialog of its own.
            await nextTick();
            runCommand(entry.command);
        } else {
            const profile = connections.profiles.find(item => item.id === entry.connectionId);
            if (profile && !connections.sessions[profile.id]) await actions.connect(profile);
            connections.selected = { connectionId: entry.connectionId };
            const session = connections.sessions[entry.connectionId];
            if (session) session.open = true;
        }
    } catch (error) {
        report(error);
    }
}

function onKey(event: KeyboardEvent) {
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (event.key === "Enter") void choose(shown.value[highlighted.value]?.item, event.ctrlKey || event.metaKey);
    else return;
    event.preventDefault();
}

/** The label in pieces, the matched characters marked. */
function pieces(entry: Ranked<Entry>): { text: string; hit: boolean }[] {
    const hits = new Set(entry.hits);
    const result: { text: string; hit: boolean }[] = [];
    [...entry.item.label].forEach((char, index) => {
        const hit = hits.has(index);
        const last = result.at(-1);
        if (last && last.hit === hit) last.text += char;
        else result.push({ text: char, hit });
    });
    return result;
}

function groupStarts(index: number): PaletteGroup | undefined {
    const group = shown.value[index]?.item.group;
    return index === 0 || shown.value[index - 1]?.item.group !== group ? group : undefined;
}

const GROUP_ICONS: Record<PaletteGroup, string> = {
    collection: "i-lucide-table-2",
    query: "i-lucide-star",
    command: "i-lucide-terminal",
    connection: "i-lucide-server"
};
</script>

<template>
    <DialogRoot v-model="open">
        <DialogContent class="m-0 mx-auto mt-[12vh] p-0 w-[min(94vw,560px)] rounded-sm bg-dock text-on-surface border border-divider shadow-[0_6px_20px_rgb(0_0_0/0.4)] backdrop:bg-black/25">
            <div
                class="flex flex-col"
                data-testid="palette"
            >
                <label class="h-10 flex items-center gap-2 px-3 border-b border-divider">
                    <span class="i-lucide-search size-4 shrink-0 text-on-surface-variant" />
                    <input
                        ref="input"
                        v-model="text"
                        @keydown="onKey"
                        :aria-activedescendant="shown.length > 0 ? `palette-option-${highlighted}` : undefined"
                        :aria-label="$t('palette.title')"
                        :placeholder="$t('palette.placeholder')"
                        aria-controls="palette-list"
                        class="grow min-w-0 bg-transparent outline-none text-[14px] text-on-surface-strong placeholder:text-on-surface-variant"
                        data-testid="palette-input"
                        role="combobox"
                        spellcheck="false"
                    />
                </label>
                <ul
                    id="palette-list"
                    ref="list"
                    :aria-label="$t('palette.title')"
                    class="m-0 p-1 max-h-[60vh] overflow-y-auto list-none"
                    role="listbox"
                >
                    <template
                        v-for="(entry, index) in shown"
                        :key="entry.item.key"
                    >
                        <li
                            v-if="groupStarts(index)"
                            class="px-2 pt-2 pb-1 text-[11px] uppercase tracking-wide text-on-surface-variant"
                            role="presentation"
                        >
                            {{ $t(`palette.group.${entry.item.group}`) }}
                        </li>
                        <li
                            :id="`palette-option-${index}`"
                            @click="choose(entry.item, $event.ctrlKey || $event.metaKey)"
                            @mousemove="highlighted = index"
                            :aria-disabled="entry.item.disabled ? true : undefined"
                            :aria-selected="index === highlighted"
                            :data-disabled="entry.item.disabled ? '' : undefined"
                            :data-highlighted="index === highlighted ? '' : undefined"
                            :title="entry.item.disabled"
                            class="choice-option"
                            data-testid="palette-option"
                            role="option"
                        >
                            <span
                                :class="GROUP_ICONS[entry.item.group]"
                                class="size-4 shrink-0 text-on-surface-variant"
                            />
                            <span class="truncate">
                                <span
                                    v-for="(piece, number) in pieces(entry)"
                                    :key="number"
                                    :class="piece.hit ? 'text-primary font-semibold' : ''"
                                >{{ piece.text }}</span>
                            </span>
                            <span class="grow" />
                            <span
                                v-if="entry.item.production"
                                :title="$t('environment.production')"
                                class="size-2 shrink-0 rounded-full bg-error"
                            />
                            <kbd
                                v-if="entry.item.group === 'command' && entry.item.detail"
                                class="kbd"
                            >{{ entry.item.detail }}</kbd>
                            <span
                                v-else-if="entry.item.detail"
                                class="truncate max-w-56 text-[12px] text-on-surface-variant"
                            >{{ entry.item.detail }}</span>
                        </li>
                    </template>
                    <li
                        v-if="shown.length === 0"
                        class="px-2 py-2 text-on-surface-variant"
                        role="presentation"
                    >
                        {{ $t("palette.empty") }}
                    </li>
                </ul>
                <footer class="h-7 flex items-center gap-3 px-3 border-t border-divider text-[11.5px] text-on-surface-variant">
                    <span>{{ $t("palette.hint.prefixes") }}</span>
                    <span class="grow" />
                    <span>{{ $t("palette.hint.keys") }}</span>
                </footer>
            </div>
        </DialogContent>
    </DialogRoot>
</template>
