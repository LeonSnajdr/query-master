import { describe, expect, it } from "vitest";
import en from "../../i18n/locales/en/en.json";
import { assess, assign, exportKeymap, hasConflict, isChanged, keysOf, planImport } from "./bindings";
import { COMMANDS, MAX_KEYS } from "./commands";
import { checkHotkey, codeMirrorKey, formatHotkey, hotkeyOfEvent, keyNames, matchesHotkey, normalizeHotkey } from "./hotkey";
import type { KeyInput } from "./hotkey";

const key = (init: Partial<KeyInput> & { key: string }): KeyInput => ({ code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init });

describe("commands", () => {
    it("have unique ids, a name in the texts and at most two default keys in canonical form", () => {
        const texts = en as Record<string, string>;
        expect(new Set(COMMANDS.map(command => command.id)).size).toBe(COMMANDS.length);
        for (const command of COMMANDS) {
            expect({ id: command.id, label: texts[command.label] !== undefined }).toEqual({ id: command.id, label: true });
            expect(command.keys.length).toBeLessThanOrEqual(MAX_KEYS);
            for (const hotkey of command.keys) expect(normalizeHotkey(hotkey)).toBe(hotkey);
        }
    });

    it("have no conflicts among the defaults", () => {
        expect(COMMANDS.filter(command => hasConflict({}, command.id)).map(command => command.id)).toEqual([]);
    });

    it("may use one key in the result tree and the table, which are never shown together", () => {
        expect(keysOf({}, "result.expand")).toEqual(keysOf({}, "table.embedded.show"));
    });
});

describe("hotkeys", () => {
    it("are written in one order", () => {
        expect(normalizeHotkey("Shift + Ctrl + Q")).toBe("ctrl+shift+q");
        expect(normalizeHotkey("alt+ctrl+F2")).toBe("ctrl+alt+f2");
        expect(normalizeHotkey("meta+q")).toBeUndefined();
        expect(normalizeHotkey("")).toBeUndefined();
    });

    it("are shown as printed on the keyboard", () => {
        expect(formatHotkey("ctrl+shift+q")).toBe("Ctrl + Shift + Q");
        expect(keyNames("delete")).toEqual(["Del"]);
        expect(keyNames("ctrl+enter")).toEqual(["Ctrl", "Enter"]);
        expect(keyNames("f12")).toEqual(["F12"]);
        expect(keyNames("ctrl+plus")).toEqual(["Ctrl", "+"]);
    });

    it("are named for CodeMirror", () => {
        expect(codeMirrorKey("ctrl+enter")).toBe("Ctrl-Enter");
        expect(codeMirrorKey("f5")).toBe("F5");
        expect(codeMirrorKey("ctrl+shift+q")).toBe("Ctrl-Shift-q");
    });

    it("are read from key events", () => {
        expect(hotkeyOfEvent(key({ key: "Q", code: "KeyQ", ctrlKey: true, shiftKey: true }))).toBe("ctrl+shift+q");
        expect(hotkeyOfEvent(key({ key: " ", code: "Space", ctrlKey: true }))).toBe("ctrl+space");
        expect(hotkeyOfEvent(key({ key: "Control", code: "ControlLeft", ctrlKey: true }))).toBeUndefined();
    });

    it("take the key itself where AltGr or Shift changed the character", () => {
        // German keyboard: Ctrl+Alt is AltGr, and Ctrl+Alt+Q types "@".
        const altGraphQ = key({ key: "@", code: "KeyQ", ctrlKey: true, altKey: true });
        expect(hotkeyOfEvent(altGraphQ)).toBe("ctrl+alt+q");
        expect(matchesHotkey(altGraphQ, "ctrl+alt+q")).toBe(true);
        expect(hotkeyOfEvent(key({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true }))).toBe("ctrl+shift+1");
    });

    it("match only with exactly the modifiers", () => {
        expect(matchesHotkey(key({ key: "q", code: "KeyQ", ctrlKey: true }), "ctrl+q")).toBe(true);
        expect(matchesHotkey(key({ key: "Q", code: "KeyQ", ctrlKey: true, shiftKey: true }), "ctrl+q")).toBe(false);
        expect(matchesHotkey(key({ key: "F5", code: "F5" }), "f5")).toBe(true);
        expect(matchesHotkey(key({ key: "Enter", code: "Enter", ctrlKey: true }), "ctrl+enter")).toBe(true);
    });

    it("can not take keys of Windows, the window or the editing of text", () => {
        expect(checkHotkey("alt+f4", true).blocked).toBe("keys.blocked.window");
        expect(checkHotkey("ctrl+c", true).blocked).toBe("keys.blocked.editing");
        expect(checkHotkey("q", true).blocked).toBe("keys.blocked.typing");
        expect(checkHotkey("shift+q", true).blocked).toBe("keys.blocked.typing");
        expect(checkHotkey("f9", true)).toEqual({});
        expect(checkHotkey("q", false)).toEqual({});
        expect(checkHotkey("enter", false).blocked).toBe("keys.blocked.navigation");
    });

    it("warn where AltGr types a character", () => {
        expect(checkHotkey("ctrl+alt+e", true).warning).toBe("keys.warning.altGraph");
        expect(checkHotkey("ctrl+alt+k", true).warning).toBeUndefined();
    });
});

describe("bindings", () => {
    it("assign a key and take it from the command that had it", () => {
        expect(assess({}, "tab.shell", "ctrl+q").conflicts.map(command => command.id)).toEqual(["tab.browse"]);
        const changes = assign({}, "tab.shell", 0, "ctrl+q");
        expect(changes).toEqual({ "tab.shell": ["ctrl+q"], "tab.browse": [] });
    });

    it("add a second key and keep a key once", () => {
        expect(assign({}, "tab.shell", 1, "f9")).toEqual({ "tab.shell": ["ctrl+t", "f9"] });
        expect(assign({}, "query.run", 1, "ctrl+enter")).toEqual({ "query.run": ["ctrl+enter"] });
    });

    it("do not take keys from fixed commands", () => {
        expect(assess({}, "tab.shell", "ctrl+space").blocked).toBe("keys.blocked.fixed");
        expect(assess({}, "editor.undo", "ctrl+u").blocked).toBe("keys.blocked.fixed");
    });

    it("know what differs from the default", () => {
        expect(isChanged({ "tab.shell": ["ctrl+t"] }, "tab.shell")).toBe(false);
        expect(isChanged({ "tab.shell": [] }, "tab.shell")).toBe(true);
    });
});

describe("export and import", () => {
    it("export only what differs", () => {
        const file = JSON.parse(exportKeymap({ "tab.browse": ["ctrl+b"], "tab.shell": ["ctrl+t"], "tab.sql": [] }));
        expect(file).toEqual({ querymaster: "keybindings", version: 1, bindings: { "tab.browse": ["ctrl+b"], "tab.sql": [] } });
    });

    it("import what can be, and name the rest", () => {
        const text = JSON.stringify({
            querymaster: "keybindings",
            version: 1,
            bindings: { "tab.browse": ["Ctrl+B"], "tab.diagram": ["ctrl+d"], "tab.sql": ["alt+f4", "ctrl+alt+s"], "editor.undo": ["ctrl+u"], "tab.duplicate": ["ctrl+b"] }
        });
        const plan = planImport({}, text);
        expect(plan.changes).toEqual({ "tab.browse": ["ctrl+b"], "tab.sql": ["ctrl+alt+s"], "tab.duplicate": ["ctrl+b"] });
        expect(plan.unknown).toEqual(["tab.diagram"]);
        expect(plan.skipped).toEqual([{ id: "tab.sql", hotkey: "alt+f4" }, { id: "editor.undo", hotkey: "ctrl+u" }]);
        expect(plan.conflicts).toEqual(["tab.browse", "tab.duplicate"]);
    });

    it("refuse files that are not theirs or from a newer version", () => {
        expect(() => planImport({}, "nope")).toThrow("keys.import.notJson");
        expect(() => planImport({}, JSON.stringify({ bindings: {} }))).toThrow("keys.import.foreign");
        expect(() => planImport({}, JSON.stringify({ querymaster: "keybindings", version: 2, bindings: {} }))).toThrow("keys.import.newer");
    });
});
