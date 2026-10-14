import { defineConfig, presetIcons, presetWind4 } from "unocss";

export default defineConfig({
    presets: [
        presetWind4(),
        presetIcons({
            scale: 1,
            extraProperties: { "display": "inline-block", "vertical-align": "middle" }
        })
    ],
    shortcuts: {
        // v0 popovers carry an inline `margin: unset`: only !important spaces them from their anchor.
        "flyout-gap": "[margin:0.125rem_0_0]!",
        // Drop-down and context menus.
        "menu-panel": "flyout-gap rounded-sm bg-dock text-on-surface border border-divider shadow-[0_6px_20px_rgb(0_0_0/0.4)]",
        "toolbar-rule": "w-px h-4.5 mx-1.5 shrink-0 bg-divider",
        // Rows of the connection tree; the selected one carries a frame, as a focused one does.
        "tree-row": "h-[19px] mr-4.5 flex items-center gap-1.5 pr-2 whitespace-nowrap border border-transparent outline-none hover:bg-on-surface/5 focus-visible:border-primary/60",
        "tree-row-on": "border-primary/80! bg-on-surface/6",
        "start-title": "m-0 mb-3 pb-1 border-b border-divider text-[21px] font-normal text-on-surface-strong",
        "btn-base": "h-8 px-3 inline-flex items-center justify-center gap-1.5 rounded-sm text-[13px] whitespace-nowrap disabled:opacity-50",
        "btn-primary": "btn-base bg-primary text-on-primary font-semibold",
        "btn-danger": "btn-base bg-error text-on-error font-semibold",
        "btn-secondary": "btn-base border border-divider text-on-surface-strong hover:bg-surface-variant",
        "btn-ghost": "btn-base text-on-surface-strong hover:bg-surface-variant",
        "dialog": "m-auto w-[min(92vw,34rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-md bg-dock text-on-surface border border-divider p-5 shadow-2xl backdrop:bg-black/45",
        "dialog-title": "m-0 text-[17px] font-normal text-on-surface-strong",
        "field": "h-8 px-2.5 rounded-sm bg-background border border-divider outline-none focus:border-primary text-[13px] text-on-surface-strong",
        // Label and field side by side connection dialog.
        "form-grid": "grid grid-cols-[9.5rem_1fr] items-center gap-x-4 gap-y-2",
        "switch-track": "w-8 h-4.5 flex items-center px-0.5 rounded-full bg-on-surface/20 data-[state=checked]:bg-primary/70",
        "switch-thumb": "size-3.5 rounded-full bg-on-surface-strong transition-transform data-[state=checked]:translate-x-3.5",
        // Figures of the server status: a label, the value, a note below it.
        "stat-card": "flex flex-col gap-0.5 px-3 py-2.5 rounded-sm border border-divider",
        "stat-label": "text-[12px] text-on-surface-variant",
        "stat-value": "text-[18px] text-on-surface-strong tabular-nums",
        "stat-note": "min-h-4 text-[11.5px] text-on-surface-variant",
        // Plain tables of the server pages.
        "plain-table": "w-full border-collapse text-[12.5px]",
        "plain-head": "sticky top-0 z-1 bg-background py-0.5 pr-3 text-left font-normal text-on-surface-variant whitespace-nowrap",
        "plain-cell": "py-0.5 pr-3 border-t border-divider align-top"
    },
    preflights: [
        {
            getCSS: () => `
        html, body, #app {
          height: 100%;
        }

        html, body {
          margin: 0;
          font-family: "Open Sans", system-ui, sans-serif;
          overscroll-behavior: none;
        }

        button:not(:disabled),
        [role="button"]:not(:disabled) {
          cursor: pointer;
        }

        *:focus-visible {
          outline: 1px solid var(--v0-primary);
          outline-offset: -1px;
        }

        .font-mono, .cm-editor .cm-scroller {
          font-family: "JetBrains Mono", ui-monospace, Consolas, monospace;
        }

        * {
          scrollbar-width: thin;
          scrollbar-color: color-mix(in srgb, var(--v0-on-surface) 30%, transparent) transparent;
        }
      `
        }
    ],
    theme: {
        colors: {
            "primary": "var(--v0-primary)",
            "secondary": "var(--v0-secondary)",
            "error": "var(--v0-error)",
            "info": "var(--v0-info)",
            "success": "var(--v0-success)",
            "warning": "var(--v0-warning)",
            "background": "var(--v0-background)",
            "surface": "var(--v0-surface)",
            "surface-tint": "var(--v0-surface-tint)",
            "surface-variant": "var(--v0-surface-variant)",
            "divider": "var(--v0-divider)",
            "on-primary": "var(--v0-on-primary)",
            "on-secondary": "var(--v0-on-secondary)",
            "on-error": "var(--v0-on-error)",
            "on-info": "var(--v0-on-info)",
            "on-success": "var(--v0-on-success)",
            "on-warning": "var(--v0-on-warning)",
            "on-background": "var(--v0-on-background)",
            "on-surface": "var(--v0-on-surface)",
            "on-surface-variant": "var(--v0-on-surface-variant)",
            "dock": "var(--v0-dock)",
            "on-surface-strong": "var(--v0-on-surface-strong)",
            "code-call": "var(--v0-code-call)",
            "code-key": "var(--v0-code-key)",
            "code-string": "var(--v0-code-string)",
            "code-number": "var(--v0-code-number)",
            "code-keyword": "var(--v0-code-keyword)",
            "code-type": "var(--v0-code-type)",
            "code-comment": "var(--v0-code-comment)"
        }
    }
});
