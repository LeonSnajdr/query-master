import { parse, parseExpressionAt } from "acorn";
import type { Expression, Node, PrivateIdentifier, SpreadElement, Super } from "acorn";
import { date, newObjectId, objectId, uuid } from "./ejson";
import type { Doc, Json } from "./ejson";
import { ShellError } from "./message";

/** A method with its arguments, as written after a dot. */
export interface Call {
    name: string;
    args: Json[];
}

/** One shell statement: `db.orders.find({ … }).sort({ … })`. */
export interface Statement {
    /** From `db.getSiblingDB("…")`; otherwise the database chosen for the tab. */
    database?: string;
    /** Absent for methods of the database itself (`db.runCommand(…)`). */
    collection?: string;
    method: string;
    args: Json[];
    /** What follows the method: `.sort(…)`, `.limit(…)`. */
    modifiers: Call[];
    start: number;
    end: number;
}

/**
 * The statements are read, not run: only literals and the shell's BSON helpers are values. So
 * nothing typed into a query executes as code in the app.
 */
export function parseStatements(source: string): Statement[] {
    let program;
    try {
        program = parse(source, { ecmaVersion: "latest" });
    } catch (error) {
        const position = (error as { pos?: number }).pos;
        throw new ShellError("error.shell.syntax", { detail: (error as Error).message.replace(/ \(\d+:\d+\)$/, "") }, position);
    }
    const statements: Statement[] = [];
    for (const node of program.body) {
        if (node.type === "EmptyStatement") continue;
        if (node.type !== "ExpressionStatement") throw new ShellError("error.shell.statement", undefined, node.start);
        statements.push(statementOf(node.expression));
    }
    return statements;
}

/** A single value in shell notation (`{ a: ObjectId("…") }`), as edited in a document dialog or a cell. */
export function parseValue(source: string): Json {
    let node;
    try {
        node = parseExpressionAt(source, 0, { ecmaVersion: "latest" });
    } catch (error) {
        const position = (error as { pos?: number }).pos;
        throw new ShellError("error.shell.syntax", { detail: (error as Error).message.replace(/ \(\d+:\d+\)$/, "") }, position);
    }
    if (source.slice(node.end).trim() !== "") throw new ShellError("error.shell.trailing", undefined, node.end);
    return evaluate(node);
}

/** The statement the cursor is in (or right behind), else the last one before it. */
export function statementAt(statements: Statement[], position: number): Statement | undefined {
    return statements.find(statement => position >= statement.start && position <= statement.end)
        ?? statements.findLast(statement => statement.end <= position)
        ?? statements[0];
}

type Step = { name: string; position: number } | { args: Json[]; position: number };

function steps(node: Expression | Super): Step[] {
    switch (node.type) {
        case "Identifier":
            return [{ name: node.name, position: node.start }];
        case "MemberExpression": {
            const name = propertyName(node.property, node.computed);
            return [...steps(node.object), { name, position: node.property.start }];
        }
        case "CallExpression":
            return [...steps(node.callee), { args: node.arguments.map(evaluate), position: node.start }];
        default:
            throw new ShellError("error.shell.start", undefined, node.start);
    }
}

function propertyName(node: Expression | PrivateIdentifier, computed: boolean): string {
    if (!computed && node.type === "Identifier") return node.name;
    if (computed && node.type === "Literal" && typeof node.value === "string") return node.value;
    throw new ShellError("error.shell.bracketName", undefined, node.start);
}

function statementOf(expression: Expression): Statement {
    const chain = steps(expression);
    const root = chain[0]!;
    if (!("name" in root) || root.name !== "db") throw new ShellError("error.shell.start", undefined, expression.start);

    const statement: Statement = { method: "", args: [], modifiers: [], start: expression.start, end: expression.end };
    const names: string[] = [];
    let index = 1;
    // Up to the first call that is neither getSiblingDB nor getCollection: database, collection, method.
    for (; index < chain.length; index++) {
        const step = chain[index]!;
        if ("name" in step) {
            names.push(step.name);
            continue;
        }
        const name = names.pop();
        if (name === undefined) throw new ShellError("error.shell.dbCall", undefined, step.position);
        const [first] = step.args;
        if (name === "getSiblingDB" && names.length === 0 && statement.collection === undefined) {
            if (typeof first !== "string") throw new ShellError("error.shell.siblingName", undefined, step.position);
            statement.database = first;
        } else if (name === "getCollection" && names.length === 0 && statement.collection === undefined) {
            if (typeof first !== "string") throw new ShellError("error.shell.collectionName", undefined, step.position);
            statement.collection = first;
        } else {
            // `db.system.profile.find()`: every name before the method belongs to the collection.
            if (names.length > 0) statement.collection = names.join(".");
            statement.method = name;
            statement.args = step.args;
            index++;
            break;
        }
    }
    if (!statement.method) throw new ShellError("error.shell.noMethod", undefined, expression.end);

    for (; index < chain.length; index += 2) {
        const name = chain[index]!;
        const call = chain[index + 1];
        if (!("name" in name) || !call || !("args" in call)) throw new ShellError("error.shell.methodCall", undefined, name.position);
        statement.modifiers.push({ name: name.name, args: call.args });
    }
    return statement;
}

function fail(node: Node, key = "error.shell.literal", params?: Record<string, string>): never {
    throw new ShellError(key, params, node.start);
}

function numeric(node: Node, value: Json): number {
    return typeof value === "number" ? value : fail(node, "error.shell.number");
}

function double(value: number): Json {
    return Number.isFinite(value) ? value : { $numberDouble: String(value) };
}

function evaluate(node: Expression | SpreadElement): Json {
    switch (node.type) {
        case "Literal":
            if (node.regex) return { $regularExpression: { pattern: node.regex.pattern, options: node.regex.flags } };
            if (typeof node.value === "bigint") return { $numberLong: node.value.toString() };
            if (node.value === null || typeof node.value === "string" || typeof node.value === "boolean") return node.value;
            if (typeof node.value === "number") return double(node.value);
            return fail(node);
        case "TemplateLiteral":
            if (node.expressions.length > 0) return fail(node, "error.shell.template");
            return node.quasis.map(part => part.value.cooked ?? "").join("");
        case "ObjectExpression": {
            const entries: [string, Json][] = [];
            for (const property of node.properties) {
                if (property.type !== "Property" || property.kind !== "init" || property.method) return fail(property);
                const key = property.key;
                let name: string;
                if (!property.computed && key.type === "Identifier") name = key.name;
                else if (key.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number")) name = String(key.value);
                else return fail(key, "error.shell.key");
                entries.push([name, evaluate(property.value)]);
            }
            // Also a key named `__proto__` becomes a property of its own.
            return Object.fromEntries(entries) as Doc;
        }
        case "ArrayExpression":
            return node.elements.map(element => (element ? evaluate(element) : fail(node, "error.shell.holes")));
        case "UnaryExpression": {
            const value = evaluate(node.argument);
            if (node.operator === "-") return double(-numeric(node.argument, value));
            if (node.operator === "+") return double(numeric(node.argument, value));
            if (node.operator === "!" && typeof value === "boolean") return !value;
            return fail(node);
        }
        case "BinaryExpression": {
            if (node.left.type === "PrivateIdentifier") return fail(node);
            const left = evaluate(node.left);
            const right = evaluate(node.right);
            if (node.operator === "+" && typeof left === "string" && typeof right === "string") return left + right;
            const a = numeric(node.left, left);
            const b = numeric(node.right, right);
            switch (node.operator) {
                case "+": return double(a + b);
                case "-": return double(a - b);
                case "*": return double(a * b);
                case "/": return double(a / b);
                case "%": return double(a % b);
                case "**": return double(a ** b);
                default: return fail(node);
            }
        }
        case "Identifier":
            if (node.name === "undefined") return { $undefined: true };
            if (node.name === "Infinity" || node.name === "NaN") return { $numberDouble: node.name };
            return fail(node, "error.shell.undefined", { name: node.name });
        case "NewExpression":
        case "CallExpression": {
            const callee = node.callee;
            if (callee.type === "Identifier") return construct(node, callee.name, node.arguments.map(evaluate));
            if (callee.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "Date"
                && propertyName(callee.property, callee.computed) === "now") return Date.now();
            return fail(node);
        }
        default:
            return fail(node);
    }
}

function text(node: Node, value: Json | undefined, name: string): string {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const wrapped = value.$numberLong ?? value.$numberInt ?? value.$numberDouble ?? value.$numberDecimal;
        if (typeof wrapped === "string") return wrapped;
    }
    return fail(node, "error.shell.numberArgument", { name });
}

function dateOf(node: Node, args: Json[]): Json {
    const [first] = args;
    let milliseconds: number;
    if (args.length === 0) milliseconds = Date.now();
    else if (args.length > 1) {
        const [year, month, ...rest] = args.map(arg => numeric(node, arg));
        milliseconds = new Date(year!, month!, ...(rest as [number])).getTime();
    } else if (typeof first === "number") milliseconds = first;
    else if (typeof first === "string") {
        // Like ISODate in the shell: a date without a zone is UTC.
        const iso = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(first) ? `${first.replace(" ", "T")}${first.length > 10 ? "" : "T00:00:00"}Z` : first;
        milliseconds = new Date(iso).getTime();
    } else return fail(node, "error.shell.dateArgument");
    if (Number.isNaN(milliseconds)) return fail(node, "error.shell.date");
    return date(milliseconds);
}

function construct(node: Node, name: string, args: Json[]): Json {
    const [first, second] = args;
    switch (name) {
        case "ObjectId":
        case "ObjectID": {
            if (first === undefined) return newObjectId();
            if (typeof first !== "string" || !/^[0-9a-f]{24}$/i.test(first)) return fail(node, "error.shell.objectId");
            return objectId(first.toLowerCase());
        }
        case "ISODate":
        case "Date":
            return dateOf(node, args);
        case "NumberLong":
        case "Long":
            return { $numberLong: text(node, first ?? 0, "NumberLong") };
        case "NumberInt":
        case "Int32":
            return { $numberInt: text(node, first ?? 0, "NumberInt") };
        case "NumberDecimal":
        case "Decimal128":
            return { $numberDecimal: text(node, first ?? 0, "NumberDecimal") };
        case "Double":
            return { $numberDouble: text(node, first ?? 0, "Double") };
        case "UUID":
            if (first !== undefined && typeof first !== "string") return fail(node, "error.shell.uuidArgument");
            return uuid(first ?? crypto.randomUUID()) ?? fail(node, "error.shell.uuid", { text: first ?? "" });
        case "BinData":
            if (typeof first !== "number" || typeof second !== "string") return fail(node, "error.shell.binData");
            return { $binary: { base64: second, subType: first.toString(16).padStart(2, "0") } };
        case "Timestamp": {
            const parts = first && typeof first === "object" && !Array.isArray(first) ? [first.t, first.i] : [first ?? 0, second ?? 0];
            return { $timestamp: { t: numeric(node, parts[0] ?? 0), i: numeric(node, parts[1] ?? 0) } };
        }
        case "MinKey": return { $minKey: 1 };
        case "MaxKey": return { $maxKey: 1 };
        case "RegExp":
            if (typeof first !== "string") return fail(node, "error.shell.regExp");
            return { $regularExpression: { pattern: first, options: typeof second === "string" ? second : "" } };
        default:
            return fail(node, "error.shell.undefined", { name });
    }
}
