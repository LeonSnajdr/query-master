import { describe, expect, it } from "vitest";

/** The sources of the app, read as text. */
const SOURCES = import.meta.glob<string>(["./**/*.vue", "./**/*.ts", "!./**/*.test.ts"], { query: "?raw", import: "default", eager: true });

/** One function, several actions: each of them keeps its own icon. */
const SEVERAL_ACTIONS: Record<string, string> = {
    "actions.moveFolder": "into a folder, and out of it",
    "actions.moveToFolder": "into a folder, and out of it",
    "actions.moveManyToFolder": "into a folder, and out of it",
    "dialogs.openHelp": "a page of the help each"
};

/**
 * The icon each action is drawn with, in menus and on buttons, by the text of its label and by
 * the function it calls: an entry `{ label: t("key"), icon: "i-…", action: … }` on one line, or
 * an `IconButton` with a `$t('key')` label, an `icon` and an `@click`.
 */
function actionIcons(): Map<string, Map<string, string[]>> {
    const found = new Map<string, Map<string, string[]>>();
    const note = (key: string, icon: string, where: string) => {
        const icons = found.get(key) ?? new Map<string, string[]>();
        icons.set(icon, [...(icons.get(icon) ?? []), where]);
        found.set(key, icons);
    };
    for (const [name, text] of Object.entries(SOURCES)) {
        text.split("\n").forEach((line, index) => {
            const icon = /icon:\s*"(i-[\w-]+)"/.exec(line);
            if (!icon) return;
            const label = /label:\s*(?:`\$\{)?t\("([\w.]+)"/.exec(line);
            if (label) note(label[1]!, icon[1]!, `${name}:${index + 1}`);
            const call = /action:[^,]*?\b((?:actions|dialogs)\.\w+)\(/.exec(line);
            if (call) note(call[1]!, icon[1]!, `${name}:${index + 1}`);
        });
        for (const match of text.matchAll(/<IconButton\b([^>]*)>/g)) {
            const attributes = match[1]!;
            const icon = /\sicon="(i-[\w-]+)"/.exec(attributes);
            if (!icon) continue;
            const where = `${name}:${text.slice(0, match.index).split("\n").length}`;
            const label = /:label="[^"]*?\$t\('([\w.]+)'/.exec(attributes);
            if (label) note(label[1]!, icon[1]!, where);
            const call = /@click="[^"]*?\b((?:actions|dialogs)\.\w+)\(/.exec(attributes);
            if (call) note(call[1]!, icon[1]!, where);
        }
    }
    return found;
}

describe("icons of actions", () => {
    it("reads the sources", () => {
        expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    });

    it("draws every action with the same icon in all menus and on all buttons", () => {
        const mixed = [...actionIcons()]
            .filter(([key, icons]) => icons.size > 1 && !(key in SEVERAL_ACTIONS))
            .map(([key, icons]) => `${key}: ${[...icons].map(([icon, places]) => `${icon} (${places.join(", ")})`).join(" | ")}`);
        expect(mixed).toEqual([]);
    });
});
