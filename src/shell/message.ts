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
