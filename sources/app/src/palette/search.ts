/**
 * The search of the command palette (stage 22): collections, saved queries, commands and
 * connections in one list. Fuzzy but predictable: matches at the start of a word first, then inside
 * a word, then letters spread over the name.
 */

export const PALETTE_GROUPS = ["collection", "query", "command", "connection"] as const;
export type PaletteGroup = typeof PALETTE_GROUPS[number];

/** Typed first, these narrow the list to one group. */
export const PREFIXES: Record<string, PaletteGroup> = { ">": "command", "@": "collection", "#": "query" };

/** Entries shown per group while something is typed; without input, the recent ones. */
export const PER_GROUP = 5;
export const RECENT_SHOWN = 8;

export interface PaletteItem {
    /** Stays the same for the same thing: what "recently used" remembers. */
    key: string;
    group: PaletteGroup;
    label: string;
    /** On the right: the path (`connection › database`), the shortcut, the collection. */
    detail?: string;
    /** Shown grey, with the reason as a tooltip, and not run. */
    disabled?: string;
    /** A red dot before the path: the connection is marked production. */
    production?: boolean;
}

/** Where in the label the typed text was found, to highlight it. */
export interface Ranked<T extends PaletteItem = PaletteItem> {
    item: T;
    rank: number;
    /** Indexes of the matched characters of the label. */
    hits: number[];
}

/** Characters that start a new word: after a space, a dot, a hyphen, an underscore, a slash, or a lower-case letter followed by a capital. */
function wordStarts(label: string): Set<number> {
    const starts = new Set<number>([0]);
    for (let index = 1; index < label.length; index++) {
        const before = label[index - 1]!;
        const here = label[index]!;
        if (/[\s.\-_/:›]/.test(before) || (/[a-z]/.test(before) && /[A-Z]/.test(here))) starts.add(index);
    }
    return starts;
}

/**
 * How well the label matches: lower is better; `undefined` when it does not. 0 at the start of the
 * label, 1 at the start of a word, 2 inside a word, 3 letters spread in order.
 */
export function rank(query: string, label: string): { rank: number; hits: number[] } | undefined {
    const needle = query.trim().toLowerCase();
    if (!needle) return { rank: 0, hits: [] };
    const haystack = label.toLowerCase();
    const at = haystack.indexOf(needle);
    const range = (start: number) => Array.from({ length: needle.length }, (_, offset) => start + offset);
    if (at === 0) return { rank: 0, hits: range(0) };
    const starts = wordStarts(label);
    for (const start of starts) {
        if (haystack.startsWith(needle, start)) return { rank: 1, hits: range(start) };
    }
    if (at > 0) return { rank: 2, hits: range(at) };
    // Spread: each letter after the one before, word starts preferred.
    const hits: number[] = [];
    let from = 0;
    for (const char of needle) {
        if (char === " ") continue;
        let found = -1;
        for (let index = from; index < haystack.length; index++) {
            if (haystack[index] === char && (starts.has(index) || found === -1)) {
                found = index;
                if (starts.has(index)) break;
            }
        }
        if (found === -1) return undefined;
        hits.push(found);
        from = found + 1;
    }
    return { rank: 3, hits };
}

/** The group a prefix asks for, and the text after it. */
export function readQuery(text: string): { group?: PaletteGroup; query: string } {
    const first = text.trimStart()[0];
    if (first !== undefined && PREFIXES[first]) return { group: PREFIXES[first], query: text.trimStart().slice(1).trimStart() };
    return { query: text };
}

/**
 * The entries to show, in the fixed order of the groups. Without text: the recently used ones,
 * then the commands. With text: at most `PER_GROUP` per group (all of a group named by a prefix),
 * best rank first, then recently used, then by name.
 */
export function paletteItems<T extends PaletteItem>(items: T[], text: string, recent: string[]): Ranked<T>[] {
    const { group, query } = readQuery(text);
    const pool = group ? items.filter(item => item.group === group) : items;
    const recency = (item: T) => {
        const index = recent.indexOf(item.key);
        return index === -1 ? Number.POSITIVE_INFINITY : index;
    };
    if (!query.trim()) {
        if (group) return pool.sort((a, b) => recency(a) - recency(b) || a.label.localeCompare(b.label)).map(item => ({ item, rank: 0, hits: [] }));
        const recentItems = recent.map(key => pool.find(item => item.key === key)).filter((item): item is T => item !== undefined).slice(0, RECENT_SHOWN);
        const commands = pool.filter(item => item.group === "command" && !recentItems.includes(item)).sort((a, b) => a.label.localeCompare(b.label));
        return [...recentItems, ...commands].map(item => ({ item, rank: 0, hits: [] }));
    }
    const ranked: Ranked<T>[] = [];
    for (const item of pool) {
        const found = rank(query, item.label);
        if (found) ranked.push({ item, ...found });
    }
    ranked.sort((a, b) => a.rank - b.rank || recency(a.item) - recency(b.item) || a.item.label.localeCompare(b.item.label));
    const result: Ranked<T>[] = [];
    for (const name of PALETTE_GROUPS) {
        const of = ranked.filter(entry => entry.item.group === name);
        result.push(...(group ? of : of.slice(0, PER_GROUP)));
    }
    return result;
}

/** Puts a key at the front of the recently used ones; at most 50 are kept, for the session only. */
export function remember(recent: string[], key: string): string[] {
    return [key, ...recent.filter(item => item !== key)].slice(0, 50);
}
