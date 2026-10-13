import { createThemePlugin } from "@vuetify/v0";

/** The themes of the View menu, in its order. */
export const THEMES = ["one-dark", "one-light", "ayu-light", "ayu-mirage", "ayu-dark"] as const;
export type ThemeName = typeof THEMES[number];

interface Palette {
    dark: boolean;
    /** Editor and results. */
    background: string;
    /** The connection dock, the tab strip and the status bar. */
    dock: string;
    /** Rows under the pointer, inputs. */
    raised: string;
    divider: string;
    text: string;
    /** Headings, keys, the active tab. */
    strong: string;
    muted: string;
    primary: string;
    onPrimary: string;
    error: string;
    success: string;
    warning: string;
    key: string;
    string: string;
    number: string;
    keyword: string;
    /** ObjectId, dates and other BSON types. */
    type: string;
    /** Function names in code. */
    call: string;
}

// The `code-*` colors are for the editor and for values in results.
function theme(palette: Palette) {
    return {
        dark: palette.dark,
        colors: {
            "primary": palette.primary,
            "secondary": palette.muted,
            "error": palette.error,
            "info": palette.primary,
            "success": palette.success,
            "warning": palette.warning,
            "background": palette.background,
            "surface": palette.background,
            "surface-tint": palette.raised,
            "surface-variant": palette.raised,
            "dock": palette.dock,
            "divider": palette.divider,
            "on-primary": palette.onPrimary,
            "on-secondary": palette.background,
            "on-error": palette.background,
            "on-info": palette.onPrimary,
            "on-success": palette.background,
            "on-warning": palette.background,
            "on-background": palette.text,
            "on-surface": palette.text,
            "on-surface-strong": palette.strong,
            "on-surface-variant": palette.muted,
            "code-key": palette.key,
            "code-string": palette.string,
            "code-number": palette.number,
            "code-keyword": palette.keyword,
            "code-type": palette.type,
            "code-call": palette.call,
            "code-comment": palette.muted
        }
    };
}

export default createThemePlugin({
    default: "one-dark",
    target: "html",
    themes: {
        "one-dark": theme({
            dark: true,
            background: "#282c34",
            dock: "#21252b",
            raised: "#2f343e",
            divider: "#3a3f4b",
            text: "#abb2bf",
            strong: "#d7dae0",
            muted: "#6b7280",
            primary: "#528bff",
            onPrimary: "#ffffff",
            error: "#e06c75",
            success: "#98c379",
            warning: "#e5c07b",
            key: "#e06c75",
            string: "#98c379",
            number: "#d19a66",
            keyword: "#c678dd",
            type: "#e06c75",
            call: "#e5c07b"
        }),
        "one-light": theme({
            dark: false,
            background: "#fafafa",
            dock: "#eaeaeb",
            raised: "#e5e5e6",
            divider: "#d4d4d5",
            text: "#383a42",
            strong: "#232429",
            muted: "#9d9d9f",
            primary: "#526fff",
            onPrimary: "#ffffff",
            error: "#e45649",
            success: "#50a14f",
            warning: "#c18401",
            key: "#e45649",
            string: "#50a14f",
            number: "#986801",
            keyword: "#a626a4",
            type: "#e45649",
            call: "#c18401"
        }),
        "ayu-light": theme({
            dark: false,
            background: "#fafafa",
            dock: "#f0f1f2",
            raised: "#e7e8e9",
            divider: "#d9dadb",
            text: "#5c6166",
            strong: "#33373b",
            muted: "#a0a6ac",
            primary: "#fa8d3e",
            onPrimary: "#ffffff",
            error: "#f07171",
            success: "#86b300",
            warning: "#f2ae49",
            key: "#399ee6",
            string: "#86b300",
            number: "#a37acc",
            keyword: "#fa8d3e",
            type: "#f07171",
            call: "#f2ae49"
        }),
        "ayu-mirage": theme({
            dark: true,
            background: "#1f2430",
            dock: "#1a1f29",
            raised: "#2a3040",
            divider: "#33394a",
            text: "#cbccc6",
            strong: "#ecece6",
            muted: "#707a8c",
            primary: "#ffcc66",
            onPrimary: "#1f2430",
            error: "#f28779",
            success: "#bae67e",
            warning: "#ffd580",
            key: "#5ccfe6",
            string: "#bae67e",
            number: "#d4bfff",
            keyword: "#ffa759",
            type: "#f28779",
            call: "#ffd580"
        }),
        "ayu-dark": theme({
            dark: true,
            background: "#0a0e14",
            dock: "#0d1017",
            raised: "#161b24",
            divider: "#1f2733",
            text: "#b3b1ad",
            strong: "#e6e1cf",
            muted: "#626a73",
            primary: "#e6b450",
            onPrimary: "#0a0e14",
            error: "#f07178",
            success: "#c2d94c",
            warning: "#ffb454",
            key: "#39bae6",
            string: "#c2d94c",
            number: "#d2a6ff",
            keyword: "#ff8f40",
            type: "#f07178",
            call: "#ffb454"
        })
    }
});
