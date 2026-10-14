/**
 * A key combination as text: the modifiers in the order `ctrl`, `alt`, `shift`, then one key, joined
 * by `+`, all in lower case (`ctrl+shift+q`, `f5`, `alt+1`, `ctrl+enter`). The key is what
 * `KeyboardEvent.key` names, lower case; the space bar is `space`, the plus key `plus`.
 */

export interface Combination {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    key: string;
}

/** What is read of a key event (a plain object in tests). */
export type KeyInput = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

const MODIFIER_KEYS = new Set(["control", "alt", "shift", "meta", "altgraph", "os", "capslock", "numlock", "scrolllock", "fn"]);

const NAMED: Record<string, string> = { " ": "space", "+": "plus", "del": "delete", "esc": "escape", "spacebar": "space" };

export function parseHotkey(hotkey: string): Combination | undefined {
    const parts = hotkey.toLowerCase().split("+");
    const key = parts.pop();
    if (!key) return undefined;
    const combination = { ctrl: false, alt: false, shift: false, key };
    for (const part of parts) {
        if (part === "ctrl" || part === "alt" || part === "shift") combination[part] = true;
        else return undefined;
    }
    return combination;
}

export function toHotkey(combination: Combination): string {
    return [combination.ctrl && "ctrl", combination.alt && "alt", combination.shift && "shift", combination.key].filter(Boolean).join("+");
}

/** The same combination in the canonical form; `undefined` for text that is none. */
export function normalizeHotkey(hotkey: string): string | undefined {
    const combination = parseHotkey(hotkey.trim().replace(/\s+/g, ""));
    return combination ? toHotkey(combination) : undefined;
}

/**
 * The key of an event in the names above. A character that a modifier changed (AltGr+Q gives
 * `@` on a German keyboard, Shift+1 gives `!`) is replaced by the letter or digit of the key itself.
 */
export function keyOfEvent(event: Pick<KeyboardEvent, "key" | "code">): string {
    const raw = event.key.length === 1 ? event.key : event.key.toLowerCase();
    const named = NAMED[raw] ?? raw.toLowerCase();
    if ((named.length === 1 && !/^[a-z0-9]$/.test(named)) || named === "dead" || named === "unidentified") {
        const fromCode = /^Key([A-Z])$/.exec(event.code)?.[1] ?? /^(?:Digit|Numpad)(\d)$/.exec(event.code)?.[1];
        if (fromCode) return fromCode.toLowerCase();
    }
    return named;
}

export function isModifierKey(event: Pick<KeyboardEvent, "key">): boolean {
    return MODIFIER_KEYS.has(event.key.toLowerCase());
}

/** The combination an event makes; `undefined` while only modifiers are down. */
export function hotkeyOfEvent(event: KeyInput): string | undefined {
    if (isModifierKey(event)) return undefined;
    return toHotkey({ ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, key: keyOfEvent(event) });
}

/** Whether the event is the combination; the key counts as typed or as the key itself. */
export function matchesHotkey(event: KeyInput, hotkey: string): boolean {
    const combination = parseHotkey(hotkey);
    if (!combination || event.metaKey) return false;
    if (event.ctrlKey !== combination.ctrl || event.altKey !== combination.alt || event.shiftKey !== combination.shift) return false;
    const typed = NAMED[event.key] ?? event.key.toLowerCase();
    return typed === combination.key || keyOfEvent(event) === combination.key;
}

const KEY_NAMES: Record<string, string> = {
    ctrl: "Ctrl", alt: "Alt", shift: "Shift", enter: "Enter", space: "Space", tab: "Tab", backspace: "Backspace",
    delete: "Del", escape: "Esc", insert: "Ins", home: "Home", end: "End", pageup: "PgUp", pagedown: "PgDn",
    arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→", plus: "+"
};

/** The keys as printed on a keyboard, for example `["Ctrl", "Shift", "Q"]`. */
export function keyNames(hotkey: string): string[] {
    const combination = parseHotkey(hotkey);
    if (!combination) return [hotkey];
    const modifiers = (["ctrl", "alt", "shift"] as const).filter(name => combination[name]).map(name => KEY_NAMES[name]!);
    const key = KEY_NAMES[combination.key] ?? (/^f\d+$/.test(combination.key) ? combination.key.toUpperCase() : combination.key.length === 1 ? combination.key.toUpperCase() : combination.key);
    return [...modifiers, key];
}

/** As the menus show it: `Ctrl + Shift + Q`. */
export function formatHotkey(hotkey: string): string {
    return keyNames(hotkey).join(" + ");
}

const CODEMIRROR_KEYS: Record<string, string> = {
    enter: "Enter", space: "Space", tab: "Tab", backspace: "Backspace", delete: "Delete", escape: "Escape", insert: "Insert",
    home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown", arrowup: "ArrowUp", arrowdown: "ArrowDown",
    arrowleft: "ArrowLeft", arrowright: "ArrowRight", plus: "+"
};

/** The name CodeMirror's keymaps use: `Ctrl-Enter`, `F5`, `Ctrl-Shift-q`. */
export function codeMirrorKey(hotkey: string): string | undefined {
    const combination = parseHotkey(hotkey);
    if (!combination) return undefined;
    const key = CODEMIRROR_KEYS[combination.key] ?? (/^f\d+$/.test(combination.key) ? combination.key.toUpperCase() : combination.key);
    return [combination.ctrl && "Ctrl", combination.alt && "Alt", combination.shift && "Shift", key].filter(Boolean).join("-");
}

/** Keys that reload the web view unless the app takes them. */
const RELOAD = new Set(["f5", "ctrl+r", "ctrl+shift+r", "ctrl+f5", "shift+f5"]);

export function reloadsPage(event: KeyInput): boolean {
    const hotkey = hotkeyOfEvent(event);
    return hotkey !== undefined && RELOAD.has(hotkey);
}

/** Taken by Windows or the window, or the plain editing of text fields: never a shortcut. */
const RESERVED: Record<string, string> = {
    "alt+f4": "keys.blocked.window",
    "alt+tab": "keys.blocked.system",
    "alt+shift+tab": "keys.blocked.system",
    "ctrl+alt+delete": "keys.blocked.system",
    "ctrl+escape": "keys.blocked.system",
    "ctrl+shift+escape": "keys.blocked.system",
    "alt+space": "keys.blocked.window",
    "ctrl+c": "keys.blocked.editing",
    "ctrl+x": "keys.blocked.editing",
    "ctrl+v": "keys.blocked.editing",
    "ctrl+a": "keys.blocked.editing",
    "ctrl+z": "keys.blocked.editing",
    "ctrl+y": "keys.blocked.editing",
    "ctrl+insert": "keys.blocked.editing",
    "shift+insert": "keys.blocked.editing",
    "shift+delete": "keys.blocked.editing"
};

/** Moving and confirming in lists and fields; they stay what they are. */
const NAVIGATION = new Set(["enter", "escape", "tab", "space", "arrowup", "arrowdown", "arrowleft", "arrowright", "home", "end", "pageup", "pagedown"]);

/** On keyboards with AltGr (German and others) Ctrl+Alt with these keys types a character instead. */
const ALT_GRAPH = new Set(["q", "e", "m", "2", "3", "7", "8", "9", "0", "ß", "plus", "<", "\\"]);

export interface HotkeyCheck {
    /** i18n key of why the combination can not be used. */
    blocked?: string;
    /** i18n key of a warning; the combination may be used. */
    warning?: string;
}

/**
 * Whether a combination may be a shortcut. Where text is typed (`global`, `editor`, `results`) a key
 * needs Ctrl or Alt unless it is a function key; elsewhere plain keys are allowed except those
 * that move and confirm.
 */
export function checkHotkey(hotkey: string, typing: boolean): HotkeyCheck {
    const combination = parseHotkey(hotkey);
    if (!combination) return { blocked: "keys.blocked.invalid" };
    const reserved = RESERVED[hotkey];
    if (reserved) return { blocked: reserved };
    const functionKey = /^f\d+$/.test(combination.key);
    const plain = !combination.ctrl && !combination.alt;
    if (plain && !functionKey && typing) return { blocked: "keys.blocked.typing" };
    if (plain && NAVIGATION.has(combination.key)) return { blocked: "keys.blocked.navigation" };
    if (combination.ctrl && combination.alt && !combination.shift && ALT_GRAPH.has(combination.key)) return { warning: "keys.warning.altGraph" };
    return {};
}
