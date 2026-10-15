/** A text of the interface by its key in `i18n/locales`, with what goes into its placeholders. */
export interface Message {
    key: string;
    params?: Record<string, string | number>;
}

/** A statement the shell does not take, with the place in the text. */
export class ShellError extends Error implements Message {
    constructor(readonly key: string, readonly params?: Record<string, string | number>, readonly position?: number) {
        super(key);
        this.name = "ShellError";
    }
}

/**
 * Where a script failed, as an offset in its text: the engine names the place `script:<line>:<column>`
 * (both from 1). Places in the runtime the app puts before the script are named differently.
 */
export function scriptErrorPosition(detail: string, source: string): number | undefined {
    const place = /(?<![\w.])script:(\d+):(\d+)/.exec(detail);
    if (!place) return undefined;
    const lines = source.split("\n");
    const line = Number(place[1]) - 1;
    if (line >= lines.length) return source.length;
    const start = lines.slice(0, line).reduce((total, text) => total + text.length + 1, 0);
    return start + Math.min(Number(place[2]) - 1, lines[line]!.length);
}
