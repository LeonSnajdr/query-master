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
    /** Variables of a script that stand for a chain: `var c = db.orders`, the document in `forEach(o => …)`. */
    variables: Map<string, ChainStep[]>;
}

interface CallFrame {
    type: "call";
    chain: ChainStep[];
    argument: number;
    strings: string[];
    tokens: number;
    /** `forEach(`, `map(`: what they are called on; their callback gets its documents. */
    callback?: ChainStep[];
    /** The brackets hold the parameters of a function: `function (o)`, `(o) =>`. */
    params?: boolean;
    /** `for (const o of …)`: the name of the loop variable. */
    loopName?: string;
}
interface ObjectFrame { type: "object"; key?: string; pending?: string; expectKey: boolean }
interface ArrayFrame { type: "array" }
/** The body of a function, `if`, `for` …: statements, not keys. */
interface BlockFrame { type: "block" }
type Frame = CallFrame | ObjectFrame | ArrayFrame | BlockFrame;

/** Ends a chain that stands for one document; the names after it are fields. */
export const DOCUMENT = "[document]";

const WORD_START = /[A-Za-z_$]/;
const WORD = /[\w$]/;

/** Characters after which a `/` starts a regular expression and not a division. */
const BEFORE_REGEX = "(,:[{=!&|?;";
/** Words after which `{` opens a block. */
const BEFORE_BLOCK = ["else", "try", "do", "finally"];
/** Cursor and array methods that call a function with each document. */
const CALLBACKS = ["forEach", "map", "filter", "find", "some", "every"];

/** The brackets of `for (…)`, where `;` separates the parts instead of ending a statement. */
function isFor(frame: Frame | undefined): frame is CallFrame {
    if (frame?.type !== "call" || frame.chain.length !== 1) return false;
    const [step] = frame.chain;
    return step !== undefined && "name" in step && step.name === "for";
}

/** A variable being assigned (`var c = db.orders`): it stands for the chain written after `=`. */
interface Assignment { name: string; depth: number; started: boolean }

export function cursorContext(text: string): CursorContext {
    const frames: Frame[] = [];
    // The call chain being written at the current level: `db`, `orders`, `find`, a call …
    let chain: ChainStep[] = [];
    let afterDot = false;
    let last = "";
    let lastWord = "";
    let functionNext = false;
    let assignment: Assignment | undefined;
    const variables = new Map<string, ChainStep[]>();
    let index = 0;

    const top = () => frames.at(-1);
    const blockDepth = () => frames.findLastIndex(frame => frame.type === "block") + 1;
    const track = () => {
        if (assignment?.started && frames.length === assignment.depth) variables.set(assignment.name, [...chain]);
    };
    const endAssignment = () => {
        if (assignment && frames.length < assignment.depth) assignment = undefined;
    };
    const startExpression = () => {
        chain = [];
        afterDot = false;
    };
    const countToken = () => {
        const frame = top();
        if (frame?.type === "call") frame.tokens++;
    };

    const result = (kind: CursorContext["kind"], word: string, from: number, quoted: boolean, memberChain?: ChainStep[]): CursorContext => {
        // In a block only what is written there counts, not the call the function is passed to.
        const own = frames.slice(blockDepth());
        // The innermost call around the cursor, and the documents between it and the cursor.
        const callIndex = own.findLastIndex(frame => frame.type === "call");
        const call = own[callIndex] as CallFrame | undefined;
        const inner = own.slice(callIndex + 1);
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
        return { kind, word, from, chain: memberChain ?? call?.chain ?? [], argument: call?.argument ?? 0, path, quoted, key, variables };
    };

    /** `{` opens a block behind `)`, `=>`, `else` … and where a statement starts; otherwise a document. */
    const opensBlock = () => {
        if (last === "" || last === ";" || last === ")" || last === "}" || last === "=>") return true;
        if (last === "w") return BEFORE_BLOCK.includes(lastWord);
        return last === "{" && top()?.type === "block";
    };
    /** The first parameter of a callback to `forEach`, `map` … is a document of what they are called on. */
    const parameter = (frame: CallFrame, word: string) => {
        if (frame.argument !== 0 || frame.tokens !== 0) return;
        const parent = frames.at(-2);
        if (frame.params && parent?.type === "call" && parent.callback && parent.argument === 0) {
            variables.set(word, [...parent.callback, { name: DOCUMENT }]);
        } else if (frame.callback && /^\s*=>/.test(text.slice(index))) {
            variables.set(word, [...frame.callback, { name: DOCUMENT }]);
        }
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

        if (char === "/" && (last === "" || last === "=>" || BEFORE_REGEX.includes(last))) {
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
                if (frame?.type === "call") parameter(frame, word);
                // Without a dot before it, the word starts a new chain (the next statement, a value).
                if (!afterDot) {
                    // The second chain at the level of an assignment is the next statement.
                    if (assignment && frames.length === assignment.depth) {
                        if (assignment.started) assignment = undefined;
                        else assignment.started = true;
                    }
                    chain = [];
                }
                chain.push({ name: word });
                track();
            }
            countToken();
            if (word === "function") functionNext = true;
            if (word === "of" && isFor(frame)) frame.loopName = lastWord;
            afterDot = false;
            last = "w";
            lastWord = word;
            continue;
        }

        index++;
        const frame = top();
        switch (char) {
            case ".":
                afterDot = true;
                break;
            case "(": {
                const method = chain.at(-1);
                const callback = chain.length > 1 && method && "name" in method && CALLBACKS.includes(method.name) ? chain.slice(0, -1) : undefined;
                const params = functionNext || /^[^()]*\)\s*=>/.test(text.slice(index));
                frames.push({ type: "call", chain, argument: 0, strings: [], tokens: 0, callback, params });
                functionNext = false;
                startExpression();
                break;
            }
            case ")": {
                const closed = frames.pop();
                if (closed?.type === "call") {
                    if (closed.loopName !== undefined) variables.set(closed.loopName, [...chain, { name: DOCUMENT }]);
                    const single = closed.argument === 0 && closed.tokens === 1 ? closed.strings[0] : undefined;
                    chain = [...closed.chain, { call: true, firstString: single }];
                    track();
                } else startExpression();
                endAssignment();
                afterDot = false;
                break;
            }
            case "{":
                countToken();
                frames.push(opensBlock() ? { type: "block" } : { type: "object", expectKey: true });
                startExpression();
                break;
            case "[":
                // `db["orders"]` continues the chain; anything else is an array.
                if (last === "w" && frame?.type !== "object" && chain.length > 0 && /^\s*["'][^"']*["']\s*\]/.test(text.slice(index))) {
                    const close = text.indexOf("]", index);
                    chain.push({ name: text.slice(index, close).trim().slice(1, -1) });
                    track();
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
                endAssignment();
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
                else if (assignment && frames.length === assignment.depth) assignment = undefined;
                startExpression();
                break;
            case ";":
                if (isFor(frame)) {
                    frame.argument++;
                    startExpression();
                    break;
                }
                // The statement ends; the blocks around it stay.
                frames.length = blockDepth();
                if (assignment && frames.length <= assignment.depth) assignment = undefined;
                startExpression();
                break;
            case "=":
                countToken();
                // `name = …` as a statement; not `==`, `=>`, `+=` or a property `a.b = …`.
                if (last === "w" && !"=>".includes(text[index] ?? "=") && (frame === undefined || frame.type === "block")
                    && chain.length === 1 && "name" in chain[0]!) {
                    assignment = { name: chain[0].name, depth: frames.length, started: false };
                    variables.delete(assignment.name);
                    startExpression();
                }
                break;
            default:
                // A number or an operator: part of a value.
                countToken();
        }
        last = char === ">" && last === "=" ? "=>" : char;
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
    /** The chain is one document of the collection (`findOne()`, a `forEach` callback); the names after it. */
    document?: string[];
}

/** Methods whose result is one document. */
const ONE_DOCUMENT = ["findOne", "next"];

/**
 * Reads a chain as the parser reads a statement; `undefined` if it does not start with `db` or a
 * variable that stands for such a chain.
 */
export function chainTarget(chain: ChainStep[], variables?: Map<string, ChainStep[]>, depth = 0): Target | undefined {
    const [root, ...rest] = chain;
    if (!root || !("name" in root)) return undefined;
    if (root.name !== "db") {
        const value = depth < 10 ? variables?.get(root.name) : undefined;
        return value ? chainTarget([...value, ...rest], variables, depth + 1) : undefined;
    }
    const target: Target = { modifiers: [], open: false };
    const names: string[] = [];
    for (const step of rest) {
        if (target.document) {
            if ("name" in step) target.document.push(step.name);
            continue;
        }
        if ("name" in step && step.name === DOCUMENT) {
            target.document = [];
            continue;
        }
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
        if (ONE_DOCUMENT.includes(name)) target.document = [];
    }
    if (target.document) return target;
    if (names.length > 0) {
        if (target.method === undefined && target.collection === undefined) target.collection = names.join(".");
        target.open = true;
    }
    return target;
}
