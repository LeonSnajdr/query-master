import { COMMANDS, MAX_KEYS, commandOf, overlaps } from "./commands";
import type { CommandId, KnownCommand } from "./commands";
import { ShellError } from "@/shell/message";
import { checkHotkey, normalizeHotkey } from "./hotkey";

/** What the user changed: keys per command id; `[]` takes the shortcut away. */
export type Overrides = Readonly<Record<string, readonly string[]>>;

export function keysOf(overrides: Overrides, id: CommandId): readonly string[] {
    return overrides[id] ?? commandOf(id)?.keys ?? [];
}

export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((key, index) => key === b[index]);
}

export function isChanged(overrides: Overrides, id: CommandId): boolean {
    const keys = overrides[id];
    return keys !== undefined && !sameKeys(keys, commandOf(id)?.keys ?? []);
}

/** Text is typed where these shortcuts act, so a key alone would be taken from the text. */
export function typesText(command: KnownCommand): boolean {
    return command.scope === "global" || command.scope === "editor" || command.scope === "results";
}

/** Other commands that have `hotkey` and act at the same time as `id`. */
export function conflictsOf(overrides: Overrides, id: CommandId, hotkey: string): KnownCommand[] {
    const command = commandOf(id);
    if (!command) return [];
    return COMMANDS.filter(other => other.id !== id && overlaps(command.scope, other.scope) && keysOf(overrides, other.id).includes(hotkey));
}

export function hasConflict(overrides: Overrides, id: CommandId): boolean {
    return keysOf(overrides, id).some(hotkey => conflictsOf(overrides, id, hotkey).length > 0);
}

/** What happens when `hotkey` becomes key number `slot` of the command. */
export interface Assignment {
    hotkey: string;
    /** i18n key of why it can not be. */
    blocked?: string;
    warning?: string;
    /** Commands that would lose the key. */
    conflicts: KnownCommand[];
}

export function assess(overrides: Overrides, id: CommandId, hotkey: string): Assignment {
    const command = commandOf(id);
    if (!command || command.fixed) return { hotkey, blocked: "keys.blocked.fixed", conflicts: [] };
    const check = checkHotkey(hotkey, typesText(command));
    const conflicts = conflictsOf(overrides, id, hotkey);
    if (!check.blocked && conflicts.some(other => other.fixed)) return { hotkey, blocked: "keys.blocked.fixed", conflicts };
    return { hotkey, ...check, conflicts };
}

/** The keys of the command after `hotkey` took key number `slot`; a key twice stays once. */
export function withKey(keys: readonly string[], slot: number, hotkey: string): string[] {
    const next = [...keys];
    next[Math.min(slot, next.length)] = hotkey;
    return [...new Set(next)].slice(0, MAX_KEYS);
}

/** The changes of an assignment: the command's new keys and those of the commands that lose the key. */
export function assign(overrides: Overrides, id: CommandId, slot: number, hotkey: string): Record<string, string[]> {
    const changes: Record<string, string[]> = { [id]: withKey(keysOf(overrides, id), slot, hotkey) };
    for (const other of conflictsOf(overrides, id, hotkey)) changes[other.id] = keysOf(overrides, other.id as CommandId).filter(key => key !== hotkey);
    return changes;
}

const FILE_TAG = "keybindings";
const FILE_VERSION = 1;

export interface KeymapFile {
    querymaster: typeof FILE_TAG;
    version: number;
    bindings: Record<string, string[]>;
}

/** The file of an export: only what differs from the defaults. */
export function exportKeymap(overrides: Overrides): string {
    const bindings: Record<string, string[]> = {};
    for (const entry of COMMANDS) {
        if (isChanged(overrides, entry.id)) bindings[entry.id] = [...keysOf(overrides, entry.id)];
    }
    const file: KeymapFile = { querymaster: FILE_TAG, version: FILE_VERSION, bindings };
    return `${JSON.stringify(file, null, 2)}\n`;
}

/** What an import would do, shown before it is applied. */
export interface ImportPlan {
    /** New keys per command, only those that differ from the current ones. */
    changes: Record<string, string[]>;
    /** Ids this version does not know (a file of a newer one). */
    unknown: string[];
    /** Keys that can not be shortcuts, or of fixed commands; left out. */
    skipped: { id: string; hotkey: string }[];
    /** Commands that share a key with another after the import. */
    conflicts: string[];
}

/** Reads an exported file; throws a `ShellError` with the i18n key of what is wrong with it. */
export function planImport(overrides: Overrides, text: string): ImportPlan {
    let file: unknown;
    try {
        file = JSON.parse(text);
    } catch {
        throw new ShellError("keys.import.notJson");
    }
    if (typeof file !== "object" || file === null || (file as KeymapFile).querymaster !== FILE_TAG) throw new ShellError("keys.import.foreign");
    const { version, bindings } = file as KeymapFile;
    if (typeof version !== "number" || version > FILE_VERSION) throw new ShellError("keys.import.newer");
    if (typeof bindings !== "object" || bindings === null || Array.isArray(bindings)) throw new ShellError("keys.import.foreign");

    const plan: ImportPlan = { changes: {}, unknown: [], skipped: [], conflicts: [] };
    for (const [id, value] of Object.entries(bindings)) {
        const command = commandOf(id);
        if (!command) {
            plan.unknown.push(id);
            continue;
        }
        if (!Array.isArray(value)) throw new ShellError("keys.import.foreign");
        const keys: string[] = [];
        for (const raw of value) {
            const hotkey = typeof raw === "string" ? normalizeHotkey(raw) : undefined;
            const blocked = command.fixed || hotkey === undefined || checkHotkey(hotkey, typesText(command)).blocked !== undefined;
            if (blocked) plan.skipped.push({ id, hotkey: String(raw) });
            else if (!keys.includes(hotkey) && keys.length < MAX_KEYS) keys.push(hotkey);
        }
        if (command.fixed) continue;
        if (!sameKeys(keys, keysOf(overrides, command.id as CommandId))) plan.changes[id] = keys;
    }
    const after = { ...overrides, ...plan.changes };
    plan.conflicts = COMMANDS.filter(entry => hasConflict(after, entry.id)).map(entry => entry.id);
    return plan;
}
