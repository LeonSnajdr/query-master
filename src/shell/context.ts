/**
 * Where the cursor is in a statement that is still being typed (and so often does not parse):
 * behind a dot, at a key, at a value or inside a string, and inside which method call and which
 * documents. Found by reading the text up to the cursor, bracket by bracket.
 */

/** A part of a call chain: a name, or a call with its first argument when that is one string. */
export type ChainStep = { name: string } | { call: true; firstString?: string };

/** A document or array around the cursor: the key whose value holds the next level, or `[]`. */
export type PathPart = string;

export interface CursorContext {
    /**
     * `member`: a name behind a dot. `key`: a key of a document. `value`: a value.
     * `string`: inside a string that is a value or an argument.
     */
    kind: "member" | "key" | "value" | "string";
    /** What is typed so far, and where it starts in the text. */
    word: string;
    from: number;
    /** `member`: the chain before the dot. Otherwise the chain of the call the cursor is in. */
    chain: ChainStep[];
    /** Index of the argument of that call. */
    argument: number;
    /** From the argument down to the cursor. */
    path: PathPart[];
    /** `key`: the key is written in quotes; `string`: always. */
    quoted: boolean;
    /** `value` and `string`: the key the value belongs to, when it is the value of a key. */
    key?: string;
}

interface CallFrame { type: "call"; chain: ChainStep[]; argument: number; strings: string[]; tokens: number }
interface ObjectFrame { type: "object"; key?: string; pending?: string; expectKey: boolean }
interface ArrayFrame { type: "array" }
type Frame = CallFrame | ObjectFrame | ArrayFrame;

const WORD_START = /[A-Za-z_$]/;
const WORD = /[\w$]/;

/** Characters after which a `/` starts a regular expression and not a division. */
const BEFORE_REGEX = "(,:[{=!&|?;";

export function cursorContext(text: string): CursorContext {
    const frames: Frame[] = [];
    // The call chain being written at the current level: `db`, `orders`, `find`, a call …
    let chain: ChainStep[] = [];
    let afterDot = false;
    let last = "";
    let index = 0;

    const top = () => frames.at(-1);
    const startExpression = () => {
        chain = [];
        afterDot = false;
    };
    const countToken = () => {
        const frame = top();
        if (frame?.type === "call") frame.tokens++;
    };

    const result = (kind: CursorContext["kind"], word: string, from: number, quoted: boolean, memberChain?: ChainStep[]): CursorContext => {
        // The innermost call around the cursor, and the documents between it and the cursor.
        const callIndex = frames.findLastIndex(frame => frame.type === "call");
        const call = frames[callIndex] as CallFrame | undefined;
        const inner = frames.slice(callIndex + 1);
        const current = inner.at(-1);
        const path = inner
            .slice(0, kind === "key" ? -1 : undefined)
            .map(frame => (frame.type === "array" ? "[]" : (frame as ObjectFrame).key ?? ""));
        // At a value the innermost document contributes its key as `key`, not as a level.
        let key: string | undefined;
        if (kind !== "key" && kind !== "member" && current?.type === "object") {
            key = current.key;
            path.pop();
        }
        return { kind, word, from, chain: memberChain ?? call?.chain ?? [], argument: call?.argument ?? 0, path, quoted, key };
    };

    while (index < text.length) {
        const char = text[index]!;

        if (/\s/.test(char)) {
            index++;
            continue;
        }
        if (char === "/" && text[index + 1] === "/") {
            const end = text.indexOf("\n", index);
            if (end === -1) return result("value", "", text.length, false);
            index = end + 1;
            continue;
        }
        if (char === "/" && text[index + 1] === "*") {
            const end = text.indexOf("*/", index + 2);
            if (end === -1) return result("value", "", text.length, false);
            index = end + 2;
            continue;
        }

        if (char === "\"" || char === "'" || char === "`") {
            const start = index;
            index++;
            while (index < text.length && text[index] !== char) index += text[index] === "\\" ? 2 : 1;
            const frame = top();
            if (index >= text.length) {
                // The cursor is inside this string.
                const word = text.slice(start + 1);
                if (frame?.type === "object" && frame.expectKey) return result("key", word, start + 1, true);
                return result("string", word, start + 1, true);
            }
            const value = text.slice(start + 1, index);
            index++;
            if (frame?.type === "object" && frame.expectKey) frame.pending = value;
            else if (frame?.type === "call") {
                frame.strings.push(value);
                frame.tokens++;
            }
            last = "s";
            continue;
        }

        if (char === "/" && (last === "" || BEFORE_REGEX.includes(last))) {
            index++;
            while (index < text.length && text[index] !== "/" && text[index] !== "\n") index += text[index] === "\\" ? 2 : 1;
            index++;
            while (index < text.length && /[a-z]/.test(text[index]!)) index++;
            countToken();
            last = "s";
            continue;
        }

        if (WORD_START.test(char)) {
            const start = index;
            while (index < text.length && WORD.test(text[index]!)) index++;
            const word = text.slice(start, index);
            const frame = top();
            if (index === text.length) {
                // The word under the cursor.
                if (afterDot) return result("member", word, start, false, chain);
                if (frame?.type === "object" && frame.expectKey) return result("key", word, start, false);
                return result("value", word, start, false);
            }
            if (frame?.type === "object" && frame.expectKey) frame.pending = word;
            else {
                // Without a dot before it, the word starts a new chain (the next statement, a value).
                if (!afterDot) chain = [];
                chain.push({ name: word });
            }
            countToken();
            afterDot = false;
            last = "w";
            continue;
        }

        index++;
        const frame = top();
        switch (char) {
            case ".":
                afterDot = true;
                break;
            case "(":
                frames.push({ type: "call", chain, argument: 0, strings: [], tokens: 0 });
                startExpression();
                break;
            case ")": {
                const closed = frames.pop();
                if (closed?.type === "call") {
                    const single = closed.argument === 0 && closed.tokens === 1 ? closed.strings[0] : undefined;
                    chain = [...closed.chain, { call: true, firstString: single }];
                } else startExpression();
                afterDot = false;
                break;
            }
            case "{":
                countToken();
                frames.push({ type: "object", expectKey: true });
                startExpression();
                break;
            case "[":
                // `db["orders"]` continues the chain; anything else is an array.
                if (last === "w" && frame?.type !== "object" && chain.length > 0 && /^\s*["'][^"']*["']\s*\]/.test(text.slice(index))) {
                    const close = text.indexOf("]", index);
                    chain.push({ name: text.slice(index, close).trim().slice(1, -1) });
                    index = close + 1;
                    last = "w";
                    continue;
                }
                countToken();
                frames.push({ type: "array" });
                startExpression();
                break;
            case "}":
            case "]":
                frames.pop();
                startExpression();
                break;
            case ":":
                if (frame?.type === "object") {
                    frame.key = frame.pending;
                    frame.pending = undefined;
                    frame.expectKey = false;
                }
                startExpression();
                break;
            case ",":
                if (frame?.type === "object") {
                    frame.expectKey = true;
                    frame.key = undefined;
                } else if (frame?.type === "call") frame.argument++;
                startExpression();
                break;
            case ";":
                frames.length = 0;
                startExpression();
                break;
            default:
                // A number or an operator: part of a value.
                countToken();
        }
        last = char;
    }

    const frame = top();
    if (afterDot) return result("member", "", text.length, false, chain);
    if (frame?.type === "object" && frame.expectKey) return result("key", "", text.length, false);
    return result("value", "", text.length, false);
}

/** What a chain names: the collection, the method called on it, and what was chained after. */
export interface Target {
    database?: string;
    collection?: string;
    method?: string;
    /** Methods called after `method`. */
    modifiers: string[];
    /** The chain ends in a name that is not called yet (`db.orders.find` without brackets). */
    open: boolean;
}

/** Reads a chain as the parser reads a statement; `undefined` if it does not start with `db`. */
export function chainTarget(chain: ChainStep[]): Target | undefined {
    const [root, ...rest] = chain;
    if (!root || !("name" in root) || root.name !== "db") return undefined;
    const target: Target = { modifiers: [], open: false };
    const names: string[] = [];
    for (const step of rest) {
        if ("name" in step) {
            names.push(step.name);
            continue;
        }
        const name = names.pop();
        if (name === undefined) continue;
        if (target.method !== undefined) target.modifiers.push(name);
        else if (name === "getSiblingDB" && names.length === 0 && target.collection === undefined) target.database = step.firstString;
        else if (name === "getCollection" && names.length === 0 && target.collection === undefined) target.collection = step.firstString ?? "";
        else {
            if (names.length > 0) target.collection = names.splice(0).join(".");
            target.method = name;
        }
    }
    if (names.length > 0) {
        if (target.method === undefined && target.collection === undefined) target.collection = names.join(".");
        target.open = true;
    }
    return target;
}
