/**
 * Every command that has a keyboard shortcut, with its default keys. The hotkeys, the menus, the
 * help (F12) and the settings read from here; what the user changed lies in SQLite (`keymap.ts`).
 */

/**
 * Where a shortcut acts. `global` listens on the window; the others are the keys of one part of
 * the app, handled there: the editor, the whole results area, the result tree, the result table
 * and the tree in the dock.
 */
export type Scope = "global" | "editor" | "results" | "resultTree" | "table" | "tree";

export const GROUPS = ["connection", "tabs", "create", "manage", "view", "focus", "editor", "results", "table", "tree"] as const;
export type CommandGroup = typeof GROUPS[number];

export interface Command {
    /** Stays the same across versions: the key of the user's binding in SQLite and in exported files. */
    readonly id: string;
    /** i18n key of the name. */
    readonly label: string;
    readonly group: CommandGroup;
    readonly scope: Scope;
    /** At most two, as `ctrl+shift+q` (see `hotkey.ts`). */
    readonly keys: readonly string[];
    /** Shown, but not changeable (keys of the editor and the plain handling of rows). */
    readonly fixed?: boolean;
    /** Global commands act also while a text field has the focus, unless this is `false`. */
    readonly inputs?: boolean;
}

/** Scopes that can be active at the same moment; a key used in both is a conflict. */
const OVERLAP: Record<Scope, readonly Scope[]> = {
    global: ["global", "editor", "results", "resultTree", "table", "tree"],
    editor: ["global", "editor"],
    results: ["global", "results", "resultTree", "table"],
    // The tree and the table of the results are never shown together.
    resultTree: ["global", "results", "resultTree"],
    table: ["global", "results", "table"],
    tree: ["global", "tree"]
};

export function overlaps(a: Scope, b: Scope): boolean {
    return OVERLAP[a].includes(b);
}

export const MAX_KEYS = 2;

const command = <const T extends Command>(value: T) => value;

const LIST = [
    command({ id: "connection.list", label: "connection.list.hint", group: "connection", scope: "global", keys: ["f2"] }),
    command({ id: "connection.add", label: "connection.add", group: "connection", scope: "global", keys: ["ctrl+f2"] }),
    command({ id: "connection.uri", label: "connection.uri", group: "connection", scope: "global", keys: ["ctrl+alt+f2"] }),
    command({ id: "connection.disconnect", label: "connection.disconnect", group: "connection", scope: "global", keys: ["ctrl+alt+d"] }),

    command({ id: "tab.browse", label: "tab.browse", group: "tabs", scope: "global", keys: ["ctrl+q"] }),
    command({ id: "tab.shell", label: "tab.shell", group: "tabs", scope: "global", keys: ["ctrl+t"] }),
    command({ id: "tab.aggregation", label: "tab.aggregation", group: "tabs", scope: "global", keys: ["ctrl+shift+q"] }),
    command({ id: "tab.sql", label: "tab.sql", group: "tabs", scope: "global", keys: ["ctrl+alt+q"] }),
    command({ id: "tab.schema", label: "schema.open", group: "tabs", scope: "global", keys: [] }),
    command({ id: "tab.refresh", label: "action.refresh", group: "tabs", scope: "global", keys: ["ctrl+r"] }),
    command({ id: "tab.next", label: "tab.next", group: "tabs", scope: "global", keys: ["ctrl+tab"] }),
    command({ id: "tab.previous", label: "tab.previous", group: "tabs", scope: "global", keys: ["ctrl+shift+tab"] }),
    command({ id: "tab.duplicate", label: "tab.duplicate", group: "tabs", scope: "global", keys: ["ctrl+shift+t"] }),
    command({ id: "tab.close", label: "tab.close.current", group: "tabs", scope: "global", keys: ["ctrl+w"] }),
    command({ id: "tab.closeOthers", label: "tab.close.others", group: "tabs", scope: "global", keys: ["ctrl+shift+w"] }),

    command({ id: "database.create", label: "database.create", group: "create", scope: "global", keys: ["ctrl+shift+d"] }),
    command({ id: "folder.add", label: "folder.add", group: "create", scope: "global", keys: ["ctrl+g"] }),
    command({ id: "collection.create", label: "collection.create", group: "create", scope: "global", keys: ["ctrl+h"] }),
    command({ id: "view.create", label: "view.create", group: "create", scope: "global", keys: ["ctrl+shift+h"] }),
    command({ id: "validator.edit", label: "validator.edit", group: "create", scope: "global", keys: ["ctrl+alt+v"] }),
    command({ id: "index.create", label: "index.create", group: "create", scope: "global", keys: ["ctrl+i"] }),
    command({ id: "index.recreate", label: "index.recreate", group: "create", scope: "global", keys: ["ctrl+alt+i"] }),
    command({ id: "index.duplicate", label: "index.duplicate", group: "create", scope: "global", keys: ["ctrl+shift+i"] }),

    command({ id: "users.manage", label: "users.manage", group: "manage", scope: "global", keys: ["ctrl+alt+u"] }),
    command({ id: "roles.manage", label: "roles.manage", group: "manage", scope: "global", keys: ["ctrl+alt+r"] }),
    command({ id: "export.wizard", label: "export.menu", group: "manage", scope: "global", keys: ["ctrl+shift+s"] }),
    command({ id: "import.wizard", label: "import.menu", group: "manage", scope: "global", keys: ["ctrl+shift+o"] }),
    command({ id: "tree.collapse", label: "tree.collapse", group: "manage", scope: "global", keys: ["ctrl+shift+u"] }),
    command({ id: "settings.open", label: "settings.open", group: "manage", scope: "global", keys: ["ctrl+alt+p"] }),

    command({ id: "view.tree", label: "view.tree.long", group: "view", scope: "global", keys: ["alt+1"] }),
    command({ id: "view.table", label: "view.table.long", group: "view", scope: "global", keys: ["alt+2"] }),
    command({ id: "view.json", label: "view.json.long", group: "view", scope: "global", keys: ["alt+3"] }),
    command({ id: "view.plan", label: "view.plan.long", group: "view", scope: "global", keys: ["alt+4"] }),
    command({ id: "help.shortcuts", label: "help.shortcuts", group: "view", scope: "global", keys: ["f12"] }),
    command({ id: "palette.open", label: "palette.open", group: "view", scope: "global", keys: ["ctrl+shift+p"] }),
    command({ id: "keys.open", label: "keys.open", group: "view", scope: "global", keys: [] }),

    command({ id: "focus.tree", label: "focus.tree", group: "focus", scope: "global", keys: ["f4"] }),
    command({ id: "focus.editor", label: "focus.editor", group: "focus", scope: "global", keys: ["f6"] }),
    command({ id: "focus.results", label: "focus.results", group: "focus", scope: "global", keys: ["f7"] }),

    // In the editor through its keymap; outside a text field also on the window (the tab in front).
    command({ id: "query.run", label: "shortcut.run", group: "editor", scope: "editor", keys: ["ctrl+enter", "f5"] }),
    // Ctrl+S is the export: saving a query is a bookmark, as in a browser.
    command({ id: "query.save", label: "savedQuery.title", group: "editor", scope: "global", keys: ["ctrl+d"] }),
    //: stops a running query or script of the tab in front, also in the editor.
    command({ id: "query.stop", label: "query.stop", group: "editor", scope: "global", keys: ["shift+f5"] }),
    // As in VS Code; through the editor's keymap, so the editor with the focus is formatted.
    command({ id: "editor.format", label: "shortcut.format", group: "editor", scope: "editor", keys: ["alt+shift+f"] }),
    command({ id: "editor.complete", label: "shortcut.complete", group: "editor", scope: "editor", keys: ["ctrl+space"], fixed: true }),
    command({ id: "editor.comment", label: "shortcut.comment", group: "editor", scope: "editor", keys: ["ctrl+/"], fixed: true }),
    command({ id: "editor.indent", label: "shortcut.indent", group: "editor", scope: "editor", keys: ["ctrl+]"], fixed: true }),
    command({ id: "editor.outdent", label: "shortcut.outdent", group: "editor", scope: "editor", keys: ["ctrl+["], fixed: true }),
    command({ id: "editor.undo", label: "shortcut.undo", group: "editor", scope: "editor", keys: ["ctrl+z"], fixed: true }),

    command({ id: "result.export", label: "result.export", group: "results", scope: "results", keys: ["ctrl+s"] }),
    command({ id: "result.import", label: "result.import", group: "results", scope: "results", keys: ["ctrl+o"] }),
    // Outside text fields only: in an editor Ctrl+F is its own search.
    command({ id: "result.search", label: "result.search.focus", group: "results", scope: "results", keys: ["ctrl+f"], inputs: false }),
    command({ id: "result.importClipboard", label: "result.importClipboard", group: "results", scope: "results", keys: ["ctrl+shift+v"], inputs: false }),
    command({ id: "result.pin", label: "result.pin", group: "results", scope: "resultTree", keys: ["ctrl+p"] }),
    command({ id: "result.expand", label: "result.expand.node", group: "results", scope: "resultTree", keys: ["ctrl+j"] }),
    command({ id: "result.collapse", label: "result.collapse.node", group: "results", scope: "resultTree", keys: ["ctrl+shift+j"] }),

    command({ id: "table.embedded.show", label: "table.embedded.show", group: "table", scope: "table", keys: ["ctrl+j"] }),
    command({ id: "table.embedded.showAll", label: "table.embedded.showAll", group: "table", scope: "table", keys: ["ctrl+shift+j"] }),
    command({ id: "table.embedded.hideAll", label: "table.embedded.hideAll", group: "table", scope: "table", keys: ["ctrl+alt+j"] }),
    command({ id: "table.stepInto", label: "table.stepInto", group: "table", scope: "table", keys: ["ctrl+enter"] }),
    command({ id: "table.stepBack", label: "table.stepBack", group: "table", scope: "table", keys: ["backspace"], fixed: true }),
    command({ id: "table.pin", label: "table.pin", group: "table", scope: "table", keys: ["ctrl+p"] }),
    command({ id: "table.hide", label: "table.hide", group: "table", scope: "table", keys: ["ctrl+k"] }),
    command({ id: "table.hideOthers", label: "table.hideOthers", group: "table", scope: "table", keys: ["ctrl+alt+k"] }),
    command({ id: "table.showAll", label: "table.showAll", group: "table", scope: "table", keys: ["ctrl+shift+k"] }),

    command({ id: "tree.drop", label: "keys.command.drop", group: "tree", scope: "tree", keys: ["delete"], fixed: true }),
    command({ id: "tree.copy", label: "collection.copy", group: "tree", scope: "tree", keys: ["ctrl+c"], fixed: true }),
    command({ id: "tree.paste", label: "collection.paste", group: "tree", scope: "tree", keys: ["ctrl+v"], fixed: true })
] as const satisfies readonly Command[];

export type CommandId = typeof LIST[number]["id"];

/** A command of the list, its id one of those known. */
export interface KnownCommand extends Command {
    readonly id: CommandId;
}

export const COMMANDS: readonly KnownCommand[] = LIST;

const BY_ID = new Map<string, KnownCommand>(COMMANDS.map(entry => [entry.id, entry]));

export function commandOf(id: string): KnownCommand | undefined {
    return BY_ID.get(id);
}

export function isCommandId(id: string): id is CommandId {
    return BY_ID.has(id);
}
