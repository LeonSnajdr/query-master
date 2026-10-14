/** One entry of a choice field: the value it stands for, its text, a grey hint on the right. */
export interface Choice<T = string> {
    value: T;
    label: string;
    hint?: string;
    disabled?: boolean;
}

/** A piece of a label, marked when it matches what was typed. */
export interface LabelPart {
    text: string;
    match: boolean;
}

/** Text folded for comparing: lower case, accents dropped (ä → a, é → e). */
function foldChar(char: string): string {
    return char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * The folded text with, for each folded character, the index of the character it came from;
 * so a match in the folded text marks the right characters of the label.
 */
function fold(text: string): { folded: string; origin: number[] } {
    let folded = "";
    const origin: number[] = [];
    let index = 0;
    for (const char of text) {
        const part = foldChar(char);
        folded += part;
        for (let count = 0; count < part.length; count++) origin.push(index);
        index += char.length;
    }
    return { folded, origin };
}

/** Where `query` occurs in `label`, ignoring case and accents; `undefined` when it does not. */
export function matchRange(label: string, query: string): [number, number] | undefined {
    const needle = fold(query.trim()).folded;
    if (!needle) return [0, 0];
    const { folded, origin } = fold(label);
    const at = folded.indexOf(needle);
    if (at === -1) return undefined;
    const start = origin[at]!;
    const lastOrigin = origin[at + needle.length - 1]!;
    // The end lies after the whole last character, which may be two code units.
    const end = lastOrigin + String.fromCodePoint(label.codePointAt(lastOrigin)!).length;
    return [start, end];
}

/**
 * The entries containing `query` (case and accents ignored), those starting with it first;
 * otherwise in their given order. An empty query keeps all.
 */
export function filterChoices<T>(choices: Choice<T>[], query: string): Choice<T>[] {
    if (!query.trim()) return choices;
    const starts: Choice<T>[] = [];
    const contains: Choice<T>[] = [];
    for (const choice of choices) {
        const range = matchRange(choice.label, query);
        if (!range) continue;
        (range[0] === 0 ? starts : contains).push(choice);
    }
    return [...starts, ...contains];
}

/** The label cut into parts, the match of `query` marked, for drawing it highlighted. */
export function highlight(label: string, query: string): LabelPart[] {
    const range = matchRange(label, query);
    if (!range || range[0] === range[1]) return [{ text: label, match: false }];
    const [start, end] = range;
    return [
        { text: label.slice(0, start), match: false },
        { text: label.slice(start, end), match: true },
        { text: label.slice(end), match: false }
    ].filter(part => part.text !== "");
}

/** Names as entries, each standing for itself; with a hint where `hints` has one. */
export function namesAsChoices(names: string[], hints: Record<string, string | undefined> = {}): Choice[] {
    return names.map(name => ({ value: name, label: name, hint: hints[name] }));
}
