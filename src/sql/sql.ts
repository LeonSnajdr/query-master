import { date, objectId, toShell } from "@/shell/ejson";
import type { Doc, Json } from "@/shell/ejson";
import { ShellError } from "@/shell/message";

/**
 * SQL for reading: `SELECT … FROM … [WHERE …] [GROUP BY …] [HAVING …] [ORDER BY …] [LIMIT n]
 * [OFFSET n]`, turned into a shell statement (`find` or `aggregate`). The statement then takes the
 * shell's way: planning, paging, editing, "Open in shell". Nothing here runs; it only reads text.
 */

type Token
    = | { kind: "word"; text: string; upper: string; quoted: boolean; at: number }
        | { kind: "string"; text: string; at: number }
        | { kind: "number"; value: number; at: number }
        | { kind: "symbol"; text: string; at: number }
        | { kind: "end"; at: number };

const KEYWORDS = new Set(["SELECT", "DISTINCT", "FROM", "WHERE", "GROUP", "BY", "HAVING", "ORDER", "LIMIT", "OFFSET", "AS",
    "AND", "OR", "NOT", "IN", "BETWEEN", "LIKE", "IS", "NULL", "TRUE", "FALSE", "ASC", "DESC"]);
const AGGREGATES = ["COUNT", "SUM", "AVG", "MIN", "MAX"] as const;
type Aggregate = typeof AGGREGATES[number];

function fail(key: string, at: number, params: Record<string, string> = {}): never {
    throw new ShellError(`error.sql.${key}`, params, at);
}

function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let at = 0;
    while (at < source.length) {
        const char = source[at]!;
        if (/\s/.test(char)) {
            at++;
        } else if (source.startsWith("--", at)) {
            while (at < source.length && source[at] !== "\n") at++;
        } else if (char === "'") {
            let text = "";
            let end = at + 1;
            for (;;) {
                if (end >= source.length) fail("unclosedString", at);
                if (source[end] === "'" && source[end + 1] === "'") {
                    text += "'";
                    end += 2;
                } else if (source[end] === "'") {
                    break;
                } else {
                    text += source[end++];
                }
            }
            tokens.push({ kind: "string", text, at });
            at = end + 1;
        } else if (char === "`" || char === "\"") {
            const end = source.indexOf(char, at + 1);
            if (end === -1) fail("unclosedName", at);
            const text = source.slice(at + 1, end);
            tokens.push({ kind: "word", text, upper: text.toUpperCase(), quoted: true, at });
            at = end + 1;
        } else if (/\d/.test(char) || (char === "-" && /\d/.test(source[at + 1] ?? "") && !lastIsValue(tokens))) {
            const match = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(source.slice(at))!;
            tokens.push({ kind: "number", value: Number(match[0]), at });
            at += match[0].length;
        } else if (/[A-Za-z_$]/.test(char)) {
            // Dotted paths of nested fields are one word: customer.name
            const match = /^[A-Za-z_$][\w$]*(\.[\w$]+)*/.exec(source.slice(at))!;
            tokens.push({ kind: "word", text: match[0], upper: match[0].toUpperCase(), quoted: false, at });
            at += match[0].length;
        } else {
            const symbol = ["<>", "!=", "<=", ">="].find(item => source.startsWith(item, at)) ?? char;
            if (!["<>", "!=", "<=", ">=", "=", "<", ">", "(", ")", ",", "*", ";"].includes(symbol)) fail("unexpected", at, { found: symbol });
            tokens.push({ kind: "symbol", text: symbol, at });
            at += symbol.length;
        }
    }
    tokens.push({ kind: "end", at: source.length });
    return tokens;
}

function lastIsValue(tokens: Token[]): boolean {
    const last = tokens.at(-1);
    return last !== undefined && (last.kind === "number" || last.kind === "string" || (last.kind === "word" && !KEYWORDS.has(last.upper)) || (last.kind === "symbol" && last.text === ")"));
}

type Condition
    = | { kind: "and" | "or"; parts: Condition[] }
        | { kind: "not"; part: Condition }
        | { kind: "compare"; field: string; op: string; value: Json }
        | { kind: "in"; field: string; values: Json[]; negated: boolean }
        | { kind: "between"; field: string; low: Json; high: Json }
        | { kind: "like"; field: string; pattern: string; negated: boolean }
        | { kind: "null"; field: string; negated: boolean };

type Column
    = | { kind: "star" }
        | { kind: "field"; field: string; alias?: string }
        | { kind: "aggregate"; fn: Aggregate; field?: string; alias?: string };

interface Select {
    distinct: boolean;
    columns: Column[];
    from: string;
    where?: Condition;
    groupBy: string[];
    having?: Condition;
    orderBy: { name: string; direction: 1 | -1 }[];
    limit?: number;
    offset?: number;
}

class Parser {
    private position = 0;
    constructor(private readonly tokens: Token[]) {}

    private get next(): Token {
        return this.tokens[this.position]!;
    }

    private describe(token: Token): string {
        switch (token.kind) {
            case "end": return "end";
            case "number": return String(token.value);
            case "string": return `'${token.text}'`;
            default: return token.text;
        }
    }

    private isKeyword(...words: string[]): boolean {
        const token = this.next;
        return token.kind === "word" && !token.quoted && words.includes(token.upper);
    }

    private keyword(...words: string[]): void {
        if (!this.isKeyword(...words)) fail("expected", this.next.at, { what: words.join(" "), found: this.describe(this.next) });
        this.position++;
    }

    private isSymbol(text: string): boolean {
        return this.next.kind === "symbol" && this.next.text === text;
    }

    private symbol(text: string): void {
        if (!this.isSymbol(text)) fail("expected", this.next.at, { what: text, found: this.describe(this.next) });
        this.position++;
    }

    /** A field or collection name; keywords only when quoted. */
    private name(): string {
        const token = this.next;
        if (token.kind !== "word" || (!token.quoted && KEYWORDS.has(token.upper))) fail("expectedName", token.at, { found: this.describe(token) });
        this.position++;
        return token.text;
    }

    private integer(): number {
        const token = this.next;
        if (token.kind !== "number" || !Number.isInteger(token.value) || token.value < 0) fail("expectedCount", token.at, { found: this.describe(token) });
        this.position++;
        return token.value;
    }

    select(): Select {
        this.keyword("SELECT");
        const distinct = this.isKeyword("DISTINCT");
        if (distinct) this.position++;
        const columns = [this.column()];
        while (this.isSymbol(",")) {
            this.position++;
            columns.push(this.column());
        }
        this.keyword("FROM");
        const query: Select = { distinct, columns, from: this.name(), groupBy: [], orderBy: [] };
        if (this.isKeyword("WHERE")) {
            this.position++;
            query.where = this.or();
        }
        if (this.isKeyword("GROUP")) {
            this.position++;
            this.keyword("BY");
            query.groupBy.push(this.name());
            while (this.isSymbol(",")) {
                this.position++;
                query.groupBy.push(this.name());
            }
        }
        if (this.isKeyword("HAVING")) {
            this.position++;
            query.having = this.or();
        }
        if (this.isKeyword("ORDER")) {
            this.position++;
            this.keyword("BY");
            do {
                if (this.isSymbol(",")) this.position++;
                const name = this.orderName();
                let direction: 1 | -1 = 1;
                if (this.isKeyword("ASC", "DESC")) {
                    direction = this.isKeyword("DESC") ? -1 : 1;
                    this.position++;
                }
                query.orderBy.push({ name, direction });
            } while (this.isSymbol(","));
        }
        if (this.isKeyword("LIMIT")) {
            this.position++;
            query.limit = this.integer();
        }
        if (this.isKeyword("OFFSET")) {
            this.position++;
            query.offset = this.integer();
        }
        if (this.isSymbol(";")) this.position++;
        if (this.next.kind !== "end") fail("unexpected", this.next.at, { found: this.describe(this.next) });
        return query;
    }

    /** A name to sort by: a field, an alias, or an aggregate as written in the columns. */
    private orderName(): string {
        const aggregate = this.aggregate();
        return aggregate ? aggregateName(aggregate) : this.name();
    }

    private aggregate(): { fn: Aggregate; field?: string } | undefined {
        const token = this.next;
        const following = this.tokens[this.position + 1];
        if (token.kind !== "word" || token.quoted || !AGGREGATES.includes(token.upper as Aggregate) || following?.kind !== "symbol" || following.text !== "(") return undefined;
        this.position += 2;
        const fn = token.upper as Aggregate;
        let field: string | undefined;
        if (this.isSymbol("*")) {
            if (fn !== "COUNT") fail("starOnlyInCount", this.next.at);
            this.position++;
        } else {
            field = this.name();
        }
        this.symbol(")");
        return { fn, field };
    }

    private alias(): string | undefined {
        if (this.isKeyword("AS")) {
            this.position++;
            return this.name();
        }
        const token = this.next;
        return token.kind === "word" && (token.quoted || !KEYWORDS.has(token.upper)) ? this.name() : undefined;
    }

    private column(): Column {
        if (this.isSymbol("*")) {
            this.position++;
            return { kind: "star" };
        }
        const aggregate = this.aggregate();
        if (aggregate) return { kind: "aggregate", ...aggregate, alias: this.alias() };
        return { kind: "field", field: this.name(), alias: this.alias() };
    }

    private or(): Condition {
        const parts = [this.and()];
        while (this.isKeyword("OR")) {
            this.position++;
            parts.push(this.and());
        }
        return parts.length === 1 ? parts[0]! : { kind: "or", parts };
    }

    private and(): Condition {
        const parts = [this.not()];
        while (this.isKeyword("AND")) {
            this.position++;
            parts.push(this.not());
        }
        return parts.length === 1 ? parts[0]! : { kind: "and", parts };
    }

    private not(): Condition {
        if (this.isKeyword("NOT")) {
            this.position++;
            return { kind: "not", part: this.not() };
        }
        if (this.isSymbol("(")) {
            this.position++;
            const inner = this.or();
            this.symbol(")");
            return inner;
        }
        return this.comparison();
    }

    private comparison(): Condition {
        const aggregate = this.aggregate();
        const field = aggregate ? aggregateName(aggregate) : this.name();
        const negated = this.isKeyword("NOT");
        if (negated) this.position++;
        if (this.isKeyword("IN")) {
            this.position++;
            this.symbol("(");
            const values = [this.value()];
            while (this.isSymbol(",")) {
                this.position++;
                values.push(this.value());
            }
            this.symbol(")");
            return { kind: "in", field, values, negated };
        }
        if (this.isKeyword("LIKE")) {
            this.position++;
            const token = this.next;
            if (token.kind !== "string") fail("expectedPattern", token.at, { found: this.describe(token) });
            this.position++;
            return { kind: "like", field, pattern: token.text, negated };
        }
        if (this.isKeyword("BETWEEN")) {
            this.position++;
            const low = this.value();
            this.keyword("AND");
            const range: Condition = { kind: "between", field, low, high: this.value() };
            return negated ? { kind: "not", part: range } : range;
        }
        if (negated) fail("expected", this.next.at, { what: "IN LIKE BETWEEN", found: this.describe(this.next) });
        if (this.isKeyword("IS")) {
            this.position++;
            const not = this.isKeyword("NOT");
            if (not) this.position++;
            this.keyword("NULL");
            return { kind: "null", field, negated: not };
        }
        const token = this.next;
        if (token.kind !== "symbol" || !["=", "<>", "!=", "<", "<=", ">", ">="].includes(token.text)) {
            fail("expected", token.at, { what: "= <> < <= > >= IN LIKE BETWEEN IS", found: this.describe(token) });
        }
        this.position++;
        return { kind: "compare", field, op: token.text, value: this.value() };
    }

    /** A literal: text, number, TRUE/FALSE/NULL, or ObjectId('…') / ISODate('…'). */
    private value(): Json {
        const token = this.next;
        if (token.kind === "string") {
            this.position++;
            return token.text;
        }
        if (token.kind === "number") {
            this.position++;
            return token.value;
        }
        if (token.kind === "word" && !token.quoted) {
            if (token.upper === "TRUE" || token.upper === "FALSE" || token.upper === "NULL") {
                this.position++;
                return token.upper === "NULL" ? null : token.upper === "TRUE";
            }
            if (token.upper === "OBJECTID" || token.upper === "ISODATE" || token.upper === "DATE") {
                this.position++;
                this.symbol("(");
                const argument = this.next;
                if (argument.kind !== "string") fail("expectedString", argument.at, { found: this.describe(argument) });
                this.position++;
                this.symbol(")");
                if (token.upper === "OBJECTID") {
                    if (!/^[0-9a-f]{24}$/i.test(argument.text)) fail("objectId", argument.at);
                    return objectId(argument.text.toLowerCase());
                }
                const millis = Date.parse(argument.text);
                if (Number.isNaN(millis)) fail("date", argument.at);
                return date(millis);
            }
        }
        fail("expectedValue", token.at, { found: this.describe(token) });
    }
}

/** The name an aggregate gets in the result when it has no alias: `count`, `sum_total`. */
function aggregateName(aggregate: { fn: Aggregate; field?: string }): string {
    const fn = aggregate.fn.toLowerCase();
    return aggregate.field === undefined ? fn : `${fn}_${aggregate.field.replaceAll(".", "_")}`;
}

/** `%` and `_` of LIKE as a regular expression anchored at both ends; the rest literal. */
export function likePattern(pattern: string): string {
    let regex = "";
    for (const char of pattern) {
        if (char === "%") regex += ".*";
        else if (char === "_") regex += ".";
        else regex += char.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    }
    return `^${regex}$`;
}

const OPERATORS: Record<string, string> = { "<>": "$ne", "!=": "$ne", "<": "$lt", "<=": "$lte", ">": "$gt", ">=": "$gte" };

/** A condition as a query filter; `rename` maps names of the result (after GROUP BY) to paths. */
function filterOf(condition: Condition, rename: (name: string) => string = name => name): Doc {
    switch (condition.kind) {
        case "and": return { $and: condition.parts.map(part => filterOf(part, rename)) };
        case "or": return { $or: condition.parts.map(part => filterOf(part, rename)) };
        case "not": return { $nor: [filterOf(condition.part, rename)] };
        case "compare": return { [rename(condition.field)]: condition.op === "=" ? condition.value : { [OPERATORS[condition.op]!]: condition.value } };
        case "in": return { [rename(condition.field)]: { [condition.negated ? "$nin" : "$in"]: condition.values } };
        case "between": return { [rename(condition.field)]: { $gte: condition.low, $lte: condition.high } };
        case "like": {
            const regex: Doc = { $regularExpression: { pattern: likePattern(condition.pattern), options: "" } };
            return { [rename(condition.field)]: condition.negated ? { $not: regex } : regex };
        }
        case "null": return { [rename(condition.field)]: condition.negated ? { $ne: null } : null };
    }
}

function accumulator(column: Extract<Column, { kind: "aggregate" }>): Doc {
    const path = column.field === undefined ? undefined : `$${column.field}`;
    switch (column.fn) {
        // COUNT(field) counts the documents in which the field is set and not null.
        case "COUNT": return { $sum: path === undefined ? 1 : { $cond: [{ $gt: [path, null] }, 1, 0] } };
        case "SUM": return { $sum: path! };
        case "AVG": return { $avg: path! };
        case "MIN": return { $min: path! };
        case "MAX": return { $max: path! };
    }
}

/** The key of a grouped field in `_id` and in the result: a dot is not allowed there. */
function groupKey(field: string): string {
    return field.replaceAll(".", "_");
}

function shellOf(query: Select): string {
    const collection = `db.getCollection(${JSON.stringify(query.from)})`;
    const aggregates = query.columns.filter((column): column is Extract<Column, { kind: "aggregate" }> => column.kind === "aggregate");
    const fields = query.columns.filter((column): column is Extract<Column, { kind: "field" }> => column.kind === "field");
    const star = query.columns.some(column => column.kind === "star");
    const filter = query.where ? filterOf(query.where) : {};
    const sort: Doc = Object.fromEntries(query.orderBy.map(item => [item.name, item.direction]));

    if (aggregates.length === 0 && query.groupBy.length === 0 && !query.distinct) {
        if (query.having) fail("havingWithoutGroup", 0);
        if (fields.some(column => column.alias !== undefined)) {
            // Renaming needs a pipeline: $project computes the new names.
            const project: Doc = Object.fromEntries(fields.map(column => [column.alias ?? column.field, `$${column.field}`]));
            const pipeline: Json[] = [{ $match: filter }, { $project: star ? project : { _id: 0, ...project } }];
            if (query.orderBy.length > 0) pipeline.push({ $sort: sort });
            if (query.offset) pipeline.push({ $skip: query.offset });
            if (query.limit !== undefined) pipeline.push({ $limit: query.limit });
            return `${collection}.aggregate(${toShell(pipeline)})`;
        }
        const projection: Doc = star ? {} : Object.fromEntries(fields.map(column => [column.field, 1]));
        let text = `${collection}.find(${toShell(filter)}${Object.keys(projection).length > 0 ? `, ${toShell(projection)}` : ""})`;
        if (query.orderBy.length > 0) text += `.sort(${toShell(sort)})`;
        if (query.offset) text += `.skip(${query.offset})`;
        if (query.limit !== undefined) text += `.limit(${query.limit})`;
        return text;
    }

    if (star) fail("starWithGroup", 0);
    // With DISTINCT and no GROUP BY the chosen fields are the groups.
    const groups = query.groupBy.length > 0 ? query.groupBy : query.distinct ? fields.map(column => column.field) : [];
    for (const column of fields) {
        if (!groups.includes(column.field)) fail("notGrouped", 0, { field: column.field });
    }
    const group: Doc = { _id: groups.length === 0 ? null : Object.fromEntries(groups.map(field => [groupKey(field), `$${field}`])) };
    for (const column of aggregates) group[column.alias ?? aggregateName(column)] = accumulator(column);
    const pipeline: Json[] = [];
    if (Object.keys(filter).length > 0) pipeline.push({ $match: filter });
    pipeline.push({ $group: group });
    const project: Doc = { _id: 0 };
    for (const field of groups) {
        const column = fields.find(item => item.field === field);
        project[column?.alias ?? groupKey(field)] = `$_id.${groupKey(field)}`;
    }
    for (const column of aggregates) project[column.alias ?? aggregateName(column)] = 1;
    pipeline.push({ $project: project });
    if (query.having) pipeline.push({ $match: filterOf(query.having, groupKey) });
    if (query.orderBy.length > 0) pipeline.push({ $sort: Object.fromEntries(query.orderBy.map(item => [groupKey(item.name), item.direction])) });
    if (query.offset) pipeline.push({ $skip: query.offset });
    if (query.limit !== undefined) pipeline.push({ $limit: query.limit });
    return `${collection}.aggregate(${toShell(pipeline)})`;
}

/** The shell statement for a SQL `SELECT`; a mistake comes as a `ShellError` with its place. */
export function sqlToShell(source: string): string {
    if (source.trim() === "") throw new ShellError("error.sql.empty");
    return shellOf(new Parser(tokenize(source)).select());
}

/** The collection a SQL text reads from, for suggestions; `undefined` before FROM is typed. */
export function sqlCollection(source: string): string | undefined {
    return /\bfrom\s+[`"]?([\w.$-]+)/i.exec(source)?.[1];
}
