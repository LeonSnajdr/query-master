/**
 * Formatting the text of an editor: shell code with Prettier, SQL with sql-formatter. Both are
 * loaded on first use, so they cost nothing until someone formats.
 */
import { ShellError } from "./message";

/**
 * What an editor holds: a script of statements, one value (a stage, a query field, a document),
 * a value in strict extended JSON, or a SQL query.
 */
export type FormatKind = "script" | "value" | "json" | "sql";

export interface Formatted {
    text: string;
    /** Where the cursor goes, in the formatted text. */
    cursor: number;
}

/** As the app writes shell code: four spaces, double quotes, keys without quotes where they need none. */
const SHELL_OPTIONS = { tabWidth: 4, printWidth: 100, trailingComma: "none", quoteProps: "as-needed", arrowParens: "avoid" } as const;

/** A value is formatted as the right side of this assignment, which is taken off again. */
const VALUE_HEAD = "__value = ";

async function prettier(text: string, cursor: number, parser: "babel" | "json", semi: boolean): Promise<Formatted> {
    const [{ formatWithCursor }, babel, { default: estree }] = await Promise.all([import("prettier/standalone"), import("prettier/plugins/babel"), import("prettier/plugins/estree")]);
    const result = await formatWithCursor(text, { ...SHELL_OPTIONS, parser, semi, cursorOffset: cursor, plugins: [babel, estree] });
    return { text: result.formatted, cursor: result.cursorOffset };
}

/** The place of a syntax error as Prettier reports it ("(3:7)"), for the message. */
function syntaxError(error: unknown): ShellError {
    const text = error instanceof Error ? error.message : String(error);
    const at = /\((\d+):(\d+)\)/.exec(text);
    return new ShellError("error.format.syntax", { line: at?.[1] ?? "?", column: at?.[2] ?? "?" });
}

/** Statements end with a semicolon only where the text already used them. */
function usesSemicolons(text: string): boolean {
    return /;\s*(\n|$)/.test(text);
}

async function formatValue(text: string, cursor: number): Promise<Formatted> {
    // Only the right side of the assignment, so a document is not read as a block.
    const result = await prettier(VALUE_HEAD + text, cursor + VALUE_HEAD.length, "babel", false);
    const body = result.text.trimEnd();
    if (!body.startsWith(VALUE_HEAD)) throw new ShellError("error.format.notValue");
    return { text: body.slice(VALUE_HEAD.length), cursor: Math.max(0, result.cursor - VALUE_HEAD.length) };
}

async function formatSql(text: string, cursor: number): Promise<Formatted> {
    const { format } = await import("sql-formatter");
    const formatted = format(text, { language: "sql", keywordCase: "upper", tabWidth: 4 });
    // sql-formatter keeps no cursor: it stays at the same share of the text.
    return { text: formatted, cursor: Math.round(formatted.length * (text.length === 0 ? 0 : cursor / text.length)) };
}

/**
 * The text formatted. A script that is no script (a document written alone, as the dialog of a
 * document holds it) is formatted as a value. A mistake in the text is a `ShellError` with its
 * place; the text then stays as it is.
 */
export async function formatCode(text: string, kind: FormatKind, cursor = 0): Promise<Formatted> {
    if (text.trim() === "") return { text, cursor };
    switch (kind) {
        case "sql": return formatSql(text, cursor);
        case "json":
            try {
                const result = await prettier(text, cursor, "json", false);
                return { text: result.text.trimEnd(), cursor: result.cursor };
            } catch (error) {
                throw syntaxError(error);
            }
        case "value":
            try {
                return await formatValue(text, cursor);
            } catch (error) {
                throw error instanceof ShellError ? error : syntaxError(error);
            }
        case "script":
            try {
                const result = await prettier(text, cursor, "babel", usesSemicolons(text));
                return { text: result.text.trimEnd(), cursor: result.cursor };
            } catch (error) {
                try {
                    return await formatValue(text, cursor);
                } catch {
                    throw syntaxError(error);
                }
            }
    }
}
