<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { useDialogs } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";
import { JSON_FILES, openTextFile, saveTextFile } from "@/files";
import { assess, assign, exportKeymap, hasConflict, planImport } from "@/keys/bindings";
import type { Assignment, ImportPlan } from "@/keys/bindings";
import { COMMANDS, GROUPS, MAX_KEYS } from "@/keys/commands";
import type { CommandId, KnownCommand } from "@/keys/commands";
import { formatHotkey, hotkeyOfEvent, isModifierKey, keyNames, normalizeHotkey } from "@/keys/hotkey";
import { useKeymap } from "@/keys/keymap";

/**
 * Settings → Keyboard shortcuts: every command with its keys, to search, record, remove and reset,
 * and to export or import as a file. Each change applies and is kept at once.
 */
const { t } = useI18n();
const { report } = useMessages();
const dialogs = useDialogs();
const keymap = useKeymap();

type Filter = "all" | "changed" | "none" | "conflicts";
const FILTERS: Filter[] = ["all", "changed", "none", "conflicts"];

const search = ref("");
const filter = ref<Filter>("all");
/** A combination to show the commands of; set by "Search by key". */
const keyFilter = ref<string>();
const selected = ref<CommandId>();
/** The key being recorded: for which command and which of its keys, and the modifiers held so far. */
const recording = shallowRef<{ id: CommandId; slot: number; held: string } | { search: true; held: string }>();
/** A recorded key that needs a word from the user: blocked, a conflict, or a warning. */
const pending = shallowRef<Assignment & { id: CommandId; slot: number }>();
const importing = shallowRef<ImportPlan>();
const list = useTemplateRef<HTMLDivElement>("list");

const counts = computed(() => ({
    all: COMMANDS.length,
    changed: COMMANDS.filter(command => keymap.changed(command.id)).length,
    none: COMMANDS.filter(command => keymap.keys(command.id).length === 0).length,
    conflicts: COMMANDS.filter(command => hasConflict(keymap.overrides, command.id)).length
}));

/** What the search text stands for as a combination ("ctrl q", "Strg+Q"), if anything. */
const searchedKey = computed(() => normalizeHotkey(search.value.toLowerCase().replace(/strg/g, "ctrl").replace(/\s+/g, "+")));

function shows(command: KnownCommand): boolean {
    const keys = keymap.keys(command.id);
    if (keyFilter.value !== undefined) return keys.includes(keyFilter.value);
    if (filter.value === "changed" && !keymap.changed(command.id)) return false;
    if (filter.value === "none" && keys.length > 0) return false;
    if (filter.value === "conflicts" && !hasConflict(keymap.overrides, command.id)) return false;
    const text = search.value.trim().toLowerCase();
    if (text === "") return true;
    return t(command.label).toLowerCase().includes(text) || (searchedKey.value !== undefined && keys.some(key => key.startsWith(searchedKey.value!)));
}

const groups = computed(() => GROUPS.map(group => ({ group, commands: COMMANDS.filter(command => command.group === group && shows(command)) }))
    .filter(entry => entry.commands.length > 0));
/** The rows in the order shown, for the arrow keys. */
const rows = computed(() => groups.value.flatMap(entry => entry.commands));

function defaultText(command: KnownCommand): string {
    return command.keys.length > 0 ? command.keys.map(formatHotkey).join(` ${t("keys.or")} `) : t("keys.none");
}

function scopeOf(command: KnownCommand): string {
    return t(`keys.scope.${command.scope}`);
}

function conflictNames(assignment: Assignment): string {
    return assignment.conflicts.map(command => `„${t(command.label)}“ (${scopeOf(command)})`).join(", ");
}

/* ---------- recording ---------- */

function startRecording(id: CommandId, slot: number) {
    pending.value = undefined;
    selected.value = id;
    recording.value = { id, slot, held: "" };
    keymap.recording.value = true;
}

/** A click anywhere ends a recording without a key. */
function onPointer() {
    if (recording.value) stopRecording();
}

function startKeySearch() {
    if (keyFilter.value !== undefined || (recording.value && "search" in recording.value)) {
        keyFilter.value = undefined;
        stopRecording();
        return;
    }
    pending.value = undefined;
    recording.value = { search: true, held: "" };
    keymap.recording.value = true;
}

function stopRecording() {
    recording.value = undefined;
    keymap.recording.value = false;
}

function heldOf(event: KeyboardEvent): string {
    return [event.ctrlKey && "ctrl", event.altKey && "alt", event.shiftKey && "shift"].filter(Boolean).join("+");
}

function removeKey(id: CommandId, slot: number) {
    keymap.apply({ [id]: keymap.keys(id).filter((_, index) => index !== slot) });
}

/** While recording, every key goes here first and nowhere else. */
function onRecordKey(event: KeyboardEvent) {
    const current = recording.value;
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "keyup" || isModifierKey(event)) {
        recording.value = { ...current, held: heldOf(event) };
        return;
    }
    const plain = !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (plain && event.key === "Escape") {
        stopRecording();
        return;
    }
    const hotkey = hotkeyOfEvent(event);
    if ("search" in current) {
        stopRecording();
        keyFilter.value = hotkey;
        return;
    }
    stopRecording();
    if (plain && event.key === "Backspace") {
        removeKey(current.id, current.slot);
        return;
    }
    if (!hotkey) return;
    const assessment = assess(keymap.overrides, current.id, hotkey);
    if (assessment.blocked || assessment.warning || assessment.conflicts.length > 0) {
        pending.value = { ...assessment, id: current.id, slot: current.slot };
        return;
    }
    keymap.apply(assign(keymap.overrides, current.id, current.slot, hotkey));
}

window.addEventListener("keydown", onRecordKey, true);
window.addEventListener("keyup", onRecordKey, true);
window.addEventListener("pointerdown", onPointer, true);
onBeforeUnmount(() => {
    window.removeEventListener("keydown", onRecordKey, true);
    window.removeEventListener("keyup", onRecordKey, true);
    window.removeEventListener("pointerdown", onPointer, true);
    stopRecording();
});

function confirmPending() {
    const assignment = pending.value;
    pending.value = undefined;
    if (assignment && !assignment.blocked) keymap.apply(assign(keymap.overrides, assignment.id, assignment.slot, assignment.hotkey));
}

/* ---------- the list by keyboard ---------- */

function onListKey(event: KeyboardEvent) {
    if (recording.value || event.target !== list.value) return;
    const at = rows.value.findIndex(command => command.id === selected.value);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const next = rows.value[Math.min(Math.max(at + (event.key === "ArrowDown" ? 1 : -1), 0), rows.value.length - 1)];
        if (next) selected.value = next.id;
        void nextTick(() => list.value?.querySelector("[data-testid=keys-row][data-selected]")?.scrollIntoView({ block: "nearest" }));
    } else if (event.key === "Enter" && selected.value) {
        if (!commandOf(selected.value)?.fixed) startRecording(selected.value, 0);
    } else if (event.key === "Delete" && selected.value) {
        if (!commandOf(selected.value)?.fixed) keymap.apply({ [selected.value]: [] });
    } else if (event.key === "Backspace" && event.ctrlKey && selected.value) {
        keymap.reset(selected.value);
    } else {
        return;
    }
    event.preventDefault();
}

function commandOf(id: CommandId): KnownCommand | undefined {
    return COMMANDS.find(command => command.id === id);
}

/* ---------- reset, export, import ---------- */

async function resetAll() {
    const count = counts.value.changed;
    if (count === 0) return;
    const yes = await dialogs.confirm({ title: t("keys.resetAll.title"), text: t("keys.resetAll.text", { count }), action: t("keys.resetAll.action") });
    if (yes) await keymap.resetAll();
}

async function exportFile() {
    try {
        await saveTextFile("querymaster-shortcuts.json", JSON_FILES, exportKeymap(keymap.overrides));
    } catch (error) {
        report(error);
    }
}

async function importFile() {
    try {
        const text = await openTextFile(JSON_FILES);
        if (text === undefined) return;
        importing.value = planImport(keymap.overrides, text);
    } catch (error) {
        report(error);
    }
}

function applyImport() {
    const plan = importing.value;
    importing.value = undefined;
    if (!plan) return;
    keymap.apply(plan.changes);
    keyFilter.value = undefined;
    if (plan.conflicts.length > 0) filter.value = "conflicts";
}

function skippedText(plan: ImportPlan): string {
    return plan.skipped.map(entry => `${entry.hotkey} (${entry.id})`).join(", ");
}
</script>

<template>
    <div
        class="flex flex-col gap-2.5 min-h-0"
        data-testid="keybindings"
    >
        <div class="flex flex-wrap items-center gap-2">
            <label
                v-if="keyFilter === undefined && !(recording && 'search' in recording)"
                class="field grow min-w-48 flex items-center gap-2"
            >
                <span class="i-lucide-search size-3.5 shrink-0 text-on-surface-variant" />
                <input
                    v-model="search"
                    :aria-label="$t('keys.search')"
                    :placeholder="$t('keys.search')"
                    class="grow min-w-0 bg-transparent outline-none"
                    data-testid="keys-search"
                    spellcheck="false"
                />
            </label>
            <div
                v-else
                class="field grow min-w-48 flex items-center gap-2 border-primary!"
                data-testid="keys-key-filter"
            >
                <span class="i-lucide-keyboard size-3.5 shrink-0 text-primary" />
                <template v-if="keyFilter !== undefined">
                    <span class="text-on-surface-variant">{{ $t("keys.searchByKey.shown") }}</span>
                    <kbd class="kbd">{{ formatHotkey(keyFilter) }}</kbd>
                </template>
                <span
                    v-else
                    class="italic text-on-surface-variant"
                >{{ recording?.held ? `${keyNames(`${recording.held}+…`).join(" + ")}` : $t("keys.searchByKey.hint") }}</span>
            </div>
            <ButtonRoot
                @click="startKeySearch"
                :aria-pressed="keyFilter !== undefined || Boolean(recording && 'search' in recording)"
                :title="$t('keys.searchByKey')"
                class="btn-secondary px-2! aria-[pressed=true]:border-primary aria-[pressed=true]:text-primary"
                data-testid="keys-search-by-key"
            >
                <span class="i-lucide-keyboard size-4" />
            </ButtonRoot>
            <div
                :aria-label="$t('keys.filter')"
                class="inline-flex rounded-sm border border-divider overflow-hidden"
                role="group"
            >
                <ButtonRoot
                    v-for="item in FILTERS"
                    :key="item"
                    @click="filter = item; keyFilter = undefined"
                    :aria-pressed="filter === item && keyFilter === undefined"
                    :data-testid="`keys-filter-${item}`"
                    class="h-8 px-2.5 text-[12.5px] text-on-surface border-r border-divider last:border-r-0 hover:bg-surface-variant aria-[pressed=true]:bg-primary aria-[pressed=true]:text-on-primary"
                >
                    <ButtonContent>
                        {{ $t(`keys.filter.${item}`) }}
                        <span class="pl-1 text-[11px] opacity-70 tabular-nums">{{ counts[item] }}</span>
                    </ButtonContent>
                </ButtonRoot>
            </div>
        </div>

        <!-- The list; focusable for the arrow keys, Enter (record), Del (remove), Ctrl+Backspace (reset). -->
        <div
            ref="list"
            @keydown="onListKey"
            :aria-label="$t('settings.tab.keys')"
            class="h-[min(55dvh,26rem)] overflow-y-auto border-y border-divider outline-none focus-visible:outline-1 focus-visible:outline-primary/60"
            data-testid="keys-list"
            tabindex="0"
        >
            <div class="sticky top-0 z-2 h-6 grid grid-cols-[0.75rem_minmax(0,1fr)_16rem_6rem_1.5rem] items-center gap-x-2 px-2 bg-dock border-b border-divider text-[12px] text-on-surface-variant">
                <span />
                <span>{{ $t("keys.column.command") }}</span>
                <span>{{ $t("keys.column.keys") }}</span>
                <span>{{ $t("keys.column.scope") }}</span>
                <span />
            </div>
            <p
                v-if="groups.length === 0"
                class="m-0 py-8 text-center text-on-surface-variant"
            >
                {{ $t("keys.empty") }}
            </p>
            <template
                v-for="entry in groups"
                :key="entry.group"
            >
                <h4 class="sticky top-6 z-1 m-0 px-2 pt-2 pb-1 bg-dock text-[13px] font-semibold text-on-surface-strong">
                    {{ $t(`keys.group.${entry.group}`) }}
                </h4>
                <div
                    v-for="command in entry.commands"
                    :key="command.id"
                    @click="selected = command.id"
                    :class="[selected === command.id ? 'bg-primary/15 shadow-[inset_2px_0_0] shadow-primary' : 'even:bg-on-surface/3', command.fixed ? 'text-on-surface-variant' : '']"
                    :data-command="command.id"
                    :data-selected="selected === command.id || undefined"
                    class="group/row grid grid-cols-[0.75rem_minmax(0,1fr)_16rem_6rem_1.5rem] items-center gap-x-2 px-2 min-h-7"
                    data-testid="keys-row"
                >
                    <span
                        v-if="hasConflict(keymap.overrides, command.id)"
                        :title="$t('keys.filter.conflicts')"
                        class="size-1.5 rounded-full bg-warning justify-self-center"
                        data-testid="keys-conflict"
                    />
                    <span
                        v-else-if="keymap.changed(command.id)"
                        :title="$t('keys.changed')"
                        class="size-1.5 rounded-full bg-primary justify-self-center"
                    />
                    <span v-else />
                    <span
                        :class="command.fixed ? '' : 'text-on-surface-strong'"
                        class="truncate"
                    >{{ $t(command.label) }}</span>
                    <span class="flex flex-wrap items-center gap-1.5 py-0.5">
                        <template
                            v-for="(hotkey, slot) in keymap.keys(command.id)"
                            :key="hotkey"
                        >
                            <span
                                v-if="recording && 'id' in recording && recording.id === command.id && recording.slot === slot"
                                class="recorder"
                                data-testid="keys-recorder"
                            >{{ recording.held ? `${keyNames(`${recording.held}+…`).join(" + ")}` : $t("keys.recording") }}</span>
                            <span
                                v-else-if="command.fixed"
                                class="kbd"
                            >{{ formatHotkey(hotkey) }}</span>
                            <span
                                v-else
                                class="inline-flex items-center rounded-sm hover:bg-surface-variant"
                            >
                                <ButtonRoot
                                    @click.stop="startRecording(command.id, slot)"
                                    :title="$t('keys.change')"
                                    data-testid="keys-chip"
                                >
                                    <ButtonContent class="kbd">{{ formatHotkey(hotkey) }}</ButtonContent>
                                </ButtonRoot>
                                <ButtonRoot
                                    @click.stop="removeKey(command.id, slot)"
                                    :aria-label="$t('keys.remove')"
                                    :title="$t('keys.remove')"
                                    class="px-1 text-on-surface-variant opacity-0 group-hover/row:opacity-100 hover:text-on-surface-strong"
                                    data-testid="keys-remove"
                                >
                                    <span class="i-lucide-x size-3" />
                                </ButtonRoot>
                            </span>
                        </template>
                        <span
                            v-if="recording && 'id' in recording && recording.id === command.id && recording.slot >= keymap.keys(command.id).length"
                            class="recorder"
                            data-testid="keys-recorder"
                        >{{ recording.held ? `${keyNames(`${recording.held}+…`).join(" + ")}` : $t("keys.recording") }}</span>
                        <span
                            v-else-if="command.fixed"
                            :title="$t('keys.fixed')"
                            class="i-lucide-lock size-3 text-on-surface-variant"
                        />
                        <ButtonRoot
                            v-else-if="keymap.keys(command.id).length === 0"
                            @click.stop="startRecording(command.id, 0)"
                            class="px-1 italic text-on-surface-variant hover:text-on-surface-strong"
                            data-testid="keys-chip"
                        >
                            <ButtonContent>{{ $t("keys.none") }}</ButtonContent>
                        </ButtonRoot>
                        <ButtonRoot
                            v-else-if="keymap.keys(command.id).length < MAX_KEYS"
                            @click.stop="startRecording(command.id, keymap.keys(command.id).length)"
                            :aria-label="$t('keys.add')"
                            :class="selected === command.id ? 'opacity-100' : 'opacity-0'"
                            :title="$t('keys.add')"
                            class="size-5 inline-flex items-center justify-center rounded-sm border border-dashed border-divider text-on-surface-variant group-hover/row:opacity-100 hover:text-on-surface-strong"
                            data-testid="keys-add"
                        >
                            <span class="i-lucide-plus size-3" />
                        </ButtonRoot>
                    </span>
                    <span class="text-[12px] text-on-surface-variant truncate">{{ scopeOf(command) }}</span>
                    <ButtonRoot
                        v-if="keymap.changed(command.id)"
                        @click.stop="keymap.reset(command.id)"
                        :aria-label="$t('keys.reset', { keys: defaultText(command) })"
                        :title="$t('keys.reset', { keys: defaultText(command) })"
                        class="size-6 inline-flex items-center justify-center rounded-sm text-on-surface-variant hover:text-on-surface-strong hover:bg-surface-variant"
                        data-testid="keys-reset"
                    >
                        <span class="i-lucide-rotate-ccw size-3.5" />
                    </ButtonRoot>
                    <span v-else />

                    <div
                        v-if="recording && 'id' in recording && recording.id === command.id"
                        class="col-start-2 col-end-6 mb-1.5 text-[12px] text-on-surface-variant"
                    >
                        {{ $t("keys.recording.hint", { keys: defaultText(command) }) }}
                    </div>
                    <div
                        v-else-if="pending && pending.id === command.id"
                        :class="pending.blocked ? 'border-error/60 bg-error/8 text-error' : 'border-warning/60 bg-warning/8 text-warning'"
                        class="col-start-2 col-end-6 mb-1.5 px-2.5 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-sm border text-[12px]"
                        data-testid="keys-pending"
                    >
                        <span class="grow">
                            <kbd class="kbd">{{ formatHotkey(pending.hotkey) }}</kbd>
                            <template v-if="pending.blocked"> {{ $t(pending.blocked) }}</template>
                            <template v-else>
                                <template v-if="pending.conflicts.length > 0"> {{ $t("keys.conflict", { names: conflictNames(pending) }) }}</template>
                                <template v-if="pending.warning"> {{ $t(pending.warning) }}</template>
                            </template>
                        </span>
                        <ButtonRoot
                            @click.stop="pending = undefined"
                            class="btn-secondary h-6.5!"
                        >
                            <ButtonContent>{{ pending.blocked ? "OK" : $t("action.cancel") }}</ButtonContent>
                        </ButtonRoot>
                        <ButtonRoot
                            v-if="!pending.blocked"
                            @click.stop="confirmPending"
                            class="btn-base h-6.5! bg-warning text-background font-semibold"
                            data-testid="keys-assign-anyway"
                        >
                            <ButtonContent>{{ $t("keys.assignAnyway") }}</ButtonContent>
                        </ButtonRoot>
                    </div>
                </div>
            </template>
        </div>

        <div
            v-if="importing"
            class="px-3 py-2.5 flex flex-col gap-1.5 rounded-sm border border-primary/60 bg-primary/6 text-[12.5px]"
            data-testid="keys-import-plan"
        >
            <strong class="text-on-surface-strong font-semibold">{{ $t("keys.import.title") }}</strong>
            <span v-if="Object.keys(importing.changes).length === 0">{{ $t("keys.import.nothing") }}</span>
            <span v-else>{{ $t("keys.import.changes", { count: Object.keys(importing.changes).length }) }}</span>
            <span
                v-if="importing.conflicts.length > 0"
                class="text-warning"
            >{{ $t("keys.import.conflicts", { count: importing.conflicts.length }) }}</span>
            <span
                v-if="importing.unknown.length > 0"
                class="text-on-surface-variant"
            >{{ $t("keys.import.unknown", { count: importing.unknown.length, ids: importing.unknown.join(", ") }) }}</span>
            <span
                v-if="importing.skipped.length > 0"
                class="text-on-surface-variant"
            >{{ $t("keys.import.skipped", { count: importing.skipped.length, keys: skippedText(importing) }) }}</span>
            <div class="flex justify-end gap-2">
                <ButtonRoot
                    @click="importing = undefined"
                    class="btn-secondary"
                >
                    <ButtonContent>{{ $t("action.cancel") }}</ButtonContent>
                </ButtonRoot>
                <ButtonRoot
                    @click="applyImport"
                    :disabled="Object.keys(importing.changes).length === 0"
                    class="btn-primary"
                    data-testid="keys-import-apply"
                >
                    <ButtonContent>{{ $t("action.apply") }}</ButtonContent>
                </ButtonRoot>
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-1">
            <ButtonRoot
                @click="resetAll"
                :disabled="counts.changed === 0"
                class="btn-ghost"
                data-testid="keys-reset-all"
            >
                <span class="i-lucide-rotate-ccw size-3.5" />
                <ButtonContent>{{ $t("keys.resetAll") }}</ButtonContent>
            </ButtonRoot>
            <ButtonRoot
                @click="exportFile"
                class="btn-ghost"
                data-testid="keys-export"
            >
                <span class="i-lucide-upload size-3.5" />
                <ButtonContent>{{ $t("keys.export") }}</ButtonContent>
            </ButtonRoot>
            <ButtonRoot
                @click="importFile"
                class="btn-ghost"
                data-testid="keys-import"
            >
                <span class="i-lucide-download size-3.5" />
                <ButtonContent>{{ $t("keys.import") }}</ButtonContent>
            </ButtonRoot>
        </div>
    </div>
</template>
