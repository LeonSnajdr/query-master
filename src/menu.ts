/** A line of a menu; `"separator"` draws a rule between groups. */
export interface MenuItem {
    label: string;
    /** UnoCSS icon class. */
    icon?: string;
    /** Shown at the right, for example `Ctrl + Q`. */
    hotkey?: string;
    action: () => void;
    disabled?: boolean;
    /** Shows a check mark in place of the icon. */
    checked?: boolean;
    /** Draws the label in the color for deleting. */
    danger?: boolean;
}

export type MenuEntry = MenuItem | "separator";
