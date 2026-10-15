import { getCurrentScope, onScopeDispose, reactive, ref } from "vue";
import { backend } from "@/api";
import { isChanged, keysOf, sameKeys } from "./bindings";
import type { Overrides } from "./bindings";
import { COMMANDS, commandOf, isCommandId, MAX_KEYS } from "./commands";
import type { CommandId } from "./commands";
import { formatHotkey, keyNames, matchesHotkey, normalizeHotkey, reloadsPage } from "./hotkey";

/** What the user changed, by command id; read before mounting, kept in SQLite. */
const overrides = reactive<Record<string, string[]>>({});
/** While a shortcut is being recorded in the settings, no shortcut acts. */
const recording = ref(false);

/** Reads the user's keys (call before mounting, so no default acts for a moment). */
export async function loadKeymap(): Promise<void> {
    try {
        for (const [id, keys] of Object.entries(await backend.getKeybindings())) {
            // Ids of a newer version stay in the database and are passed over here.
            if (!isCommandId(id)) continue;
            overrides[id] = keys.map(normalizeHotkey).filter((key): key is string => key !== undefined).slice(0, MAX_KEYS);
        }
    } catch (error) {
        console.warn("Keyboard shortcuts could not be read", error);
    }
}

function save(ids: string[]): void {
    const changes = ids.map(id => ({ commandId: id, keys: isCommandId(id) && isChanged(overrides, id) ? overrides[id]! : null }));
    void backend.saveKeybindings(changes).catch(error => console.warn("Keyboard shortcuts were not saved", error));
}

/** The keys of the commands, for menus, the help and the settings. */
export function useKeymap() {
    function keys(id: CommandId): readonly string[] {
        return keysOf(overrides, id);
    }

    return {
        overrides: overrides as Overrides,
        recording,
        keys,
        /** The first key as the menus show it, `Ctrl + Q`; `undefined` without one. */
        label(id: CommandId): string | undefined {
            const first = keys(id)[0];
            return first === undefined ? undefined : formatHotkey(first);
        },
        /** Every key, each as the names printed on the keyboard. */
        names(id: CommandId): string[][] {
            return keys(id).map(keyNames);
        },
        /** Every key of the command for a sentence: `Ctrl + Enter or F5`; `undefined` without one. */
        spoken(id: CommandId, or: string): string | undefined {
            const all = keys(id).map(formatHotkey);
            return all.length === 0 ? undefined : all.join(` ${or} `);
        },
        /** A button's name with its shortcut in brackets: `Shell öffnen (Ctrl + T)`. */
        titled(text: string, id: CommandId): string {
            const first = keys(id)[0];
            return first === undefined ? text : `${text} (${formatHotkey(first)})`;
        },
        changed: (id: CommandId) => isChanged(overrides, id),
        matches: (event: KeyboardEvent, id: CommandId) => keys(id).some(hotkey => matchesHotkey(event, hotkey)),
        /** Sets the keys of several commands at once (an assignment that takes a key from another, an import). */
        apply(changes: Record<string, readonly string[]>): void {
            for (const [id, next] of Object.entries(changes)) {
                const command = commandOf(id);
                if (!command || command.fixed) continue;
                if (sameKeys(next, command.keys)) delete overrides[id];
                else overrides[id] = [...next];
            }
            save(Object.keys(changes));
        },
        reset(id: CommandId): void {
            delete overrides[id];
            save([id]);
        },
        async resetAll(): Promise<void> {
            for (const id of Object.keys(overrides)) delete overrides[id];
            await backend.clearKeybindings().catch(error => console.warn("Keyboard shortcuts were not reset", error));
        }
    };
}

interface Handler {
    run: (event: KeyboardEvent) => void;
    enabled?: () => boolean;
}

/** What acts on each command, in the order the parts of the app registered it. */
const handlers = new Map<CommandId, Handler[]>();
let listening = false;

/** Whether the focus is in something to type into, where a key alone belongs to the text. */
function typing(): boolean {
    const element = document.activeElement as HTMLElement | null;
    if (!element) return false;
    if (["textbox", "searchbox", "combobox", "spinbutton"].includes(element.getAttribute("role") ?? "")) return true;
    if (element instanceof HTMLInputElement) return !["button", "checkbox", "radio", "range", "color", "file", "submit", "reset"].includes(element.type);
    return element instanceof HTMLTextAreaElement || element.isContentEditable;
}

function onKeydown(event: KeyboardEvent): void {
    if (recording.value) return;
    const inText = typing();
    for (const [id, list] of handlers) {
        const command = commandOf(id)!;
        // Global commands act in text fields unless they say otherwise; the run key of the
        // editor only outside it, inside the editor's own keymap has it.
        if (inText && (command.inputs === false || command.scope === "editor")) continue;
        if (!keysOf(overrides, id).some(hotkey => matchesHotkey(event, hotkey))) continue;
        const handler = list.findLast(entry => entry.enabled?.() ?? true);
        if (!handler) continue;
        event.preventDefault();
        handler.run(event);
        return;
    }
    // Without a shortcut on them, these would reload the app.
    if (reloadsPage(event)) event.preventDefault();
}

/**
 * Runs `run` when a key of the command is pressed anywhere in the window. Several parts may
 * register the same command (one per tab); the last one that is enabled acts.
 */
export function useShortcut(id: CommandId, run: (event: KeyboardEvent) => void, enabled?: () => boolean): void {
    const handler: Handler = { run, enabled };
    handlers.set(id, [...(handlers.get(id) ?? []), handler]);
    if (!listening) {
        window.addEventListener("keydown", onKeydown);
        listening = true;
    }
    if (getCurrentScope()) {
        onScopeDispose(() => {
            const rest = (handlers.get(id) ?? []).filter(entry => entry !== handler);
            if (rest.length > 0) handlers.set(id, rest);
            else handlers.delete(id);
        });
    }
}

/**
 * Runs a command as its keys would (the command palette): the last enabled handler acts.
 * `false` when nothing can run it right now.
 */
export function runCommand(id: CommandId): boolean {
    const handler = (handlers.get(id) ?? []).findLast(entry => entry.enabled?.() ?? true);
    if (!handler) return false;
    handler.run(new KeyboardEvent("keydown"));
    return true;
}

/** Whether a command has a handler that would act right now. */
export function canRun(id: CommandId): boolean {
    return (handlers.get(id) ?? []).some(entry => entry.enabled?.() ?? true);
}

/** The commands of a group in the order of the list, for the help and the settings. */
export function commandsOfGroup(group: string) {
    return COMMANDS.filter(command => command.group === group);
}
