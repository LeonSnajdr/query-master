import type { CommandId } from "@/keys/commands";

/** A line of a menu; `"separator"` draws a rule between groups. */
export interface MenuItem {
    label: string;
    /** UnoCSS icon class. */
    icon?: string;
    /** The command whose shortcut is shown at the right, as the user set it. */
    command?: CommandId;
    /** Other text at the right, where there is no command (for example `Alt + F4`, a version). */
    hotkey?: string;
    action: () => void;
    disabled?: boolean;
    /** Shows a check mark in place of the icon. */
    checked?: boolean;
    /** Draws the label in the color for deleting. */
    danger?: boolean;
}

/** A row of color dots, as for rows of the tree; `null` takes the color away. */
export interface MenuSwatches {
    /** Accessible name of the row. */
    label: string;
    swatches: readonly string[];
    current: string | null;
    choose: (color: string | null) => void;
}

/** A line that opens a menu of its own beside it (Documents, Fields, Copy …). */
export interface MenuGroup {
    label: string;
    icon?: string;
    children: MenuEntry[];
}

export type MenuEntry = MenuItem | MenuSwatches | MenuGroup | "separator";

export function isMenuGroup(entry: MenuEntry): entry is MenuGroup {
    return entry !== "separator" && "children" in entry;
}

export function isMenuItem(entry: MenuEntry): entry is MenuItem {
    return entry !== "separator" && "action" in entry;
}
