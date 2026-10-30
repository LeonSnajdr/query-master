/**
 * The BSON types of a script and their way to and from extended JSON. In a script a document is a
 * plain object; values JavaScript has no type for are instances of the classes here, so they come
 * back to the server as what they were (a NumberLong stays a 64 bit integer).
 */
import { newObjectId } from "../ejson";
import type { Doc, Json } from "../ejson";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function hexToBase64(hex: string): string {
    const bytes = hex.match(/../g)?.map(pair => parseInt(pair, 16)) ?? [];
    let out = "";
    for (let index = 0; index < bytes.length; index += 3) {
        const [a, b, c] = [bytes[index]!, bytes[index + 1], bytes[index + 2]];
        out += BASE64[a >> 2]! + BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)]!
            + (b === undefined ? "=" : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)]!)
            + (c === undefined ? "=" : BASE64[c & 63]!);
    }
    return out;
}

/** Marks a class whose instances know their extended JSON. */
abstract class BsonValue {
    abstract toEjson(): Json;
    abstract toString(): string;
}

/** Lets a class be called without `new`, as the shell allows: `ObjectId("…")`. */
function callable<A extends unknown[], T extends object>(type: new (...args: A) => T): (new (...args: A) => T) & ((...args: A) => T) {
    return new Proxy(type, { apply: (target, _, args) => new target(...(args as A)) }) as (new (...args: A) => T) & ((...args: A) => T);
}

export const ObjectId = callable(class ObjectId extends BsonValue {
    readonly str: string;

    constructor(hex?: string) {
        super();
        if (hex !== undefined && !/^[0-9a-f]{24}$/i.test(hex)) throw new Error("An ObjectId has 24 hexadecimal digits");
        this.str = (hex ?? String(newObjectId().$oid)).toLowerCase();
    }

    getTimestamp(): Date {
        return new Date(parseInt(this.str.slice(0, 8), 16) * 1000);
    }

    equals(other: unknown): boolean {
        return other instanceof ObjectId && other.str === this.str;
    }

    valueOf(): string {
        return this.str;
    }

    toEjson(): Json {
        return { $oid: this.str };
    }

    toString(): string {
        return `ObjectId("${this.str}")`;
    }
});

/** A number with a fixed BSON type; `valueOf` lets scripts calculate with it. */
function numeric(key: "$numberLong" | "$numberInt" | "$numberDecimal", shell: string, quoted: boolean) {
    return callable(class extends BsonValue {
        readonly value: string;

        constructor(value: number | string = 0) {
            super();
            this.value = String(value);
        }

        valueOf(): number {
            return Number(this.value);
        }

        /**
         * In arithmetic a number. Where JavaScript may choose (`"n: " + value`) also a number if that
         * loses nothing, else the exact digits: a 64 bit id is not printed rounded.
         */
        [Symbol.toPrimitive](hint: string): number | string {
            const number = Number(this.value);
            return hint === "number" || (hint === "default" && String(number) === this.value) ? number : this.value;
        }

        toNumber(): number {
            return Number(this.value);
        }

        toEjson(): Json {
            return { [key]: this.value };
        }

        toString(): string {
            return quoted ? `${shell}("${this.value}")` : `${shell}(${this.value})`;
        }
    });
}

export const NumberLong = numeric("$numberLong", "NumberLong", false);
export const NumberInt = numeric("$numberInt", "NumberInt", false);
export const NumberDecimal = numeric("$numberDecimal", "NumberDecimal", true);

export const BinData = callable(class BinData extends BsonValue {
    constructor(readonly subType: number, readonly base64: string) {
        super();
    }

    toEjson(): Json {
        return { $binary: { base64: this.base64, subType: this.subType.toString(16).padStart(2, "0") } };
    }

    toString(): string {
        return `BinData(${this.subType}, "${this.base64}")`;
    }
});

export const Timestamp = callable(class Timestamp extends BsonValue {
    constructor(readonly t = 0, readonly i = 0) {
        super();
    }

    toEjson(): Json {
        return { $timestamp: { t: this.t, i: this.i } };
    }

    toString(): string {
        return `Timestamp(${this.t}, ${this.i})`;
    }
});

function key(name: "$minKey" | "$maxKey", shell: string) {
    return callable(class extends BsonValue {
        toEjson(): Json {
            return { [name]: 1 };
        }

        toString(): string {
            return `${shell}()`;
        }
    });
}

export const MinKey = key("$minKey", "MinKey");
export const MaxKey = key("$maxKey", "MaxKey");

/** `UUID("…")`: binary of subtype 4. */
export function uuid(text?: string): InstanceType<typeof BinData> {
    const hex = (text ?? "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, char => Math.floor(Math.random() * (char === "x" ? 16 : 4) + (char === "x" ? 0 : 8)).toString(16))).replaceAll("-", "");
    if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`"${text}" is not a UUID`);
    return new BinData(4, hexToBase64(hex));
}

/** `ISODate("2024-05-01")`: a date without a zone is UTC, as in the shell. */
export function isoDate(text?: string): Date {
    if (text === undefined) return new Date();
    const iso = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(text) ? `${text.replace(" ", "T")}${text.length > 10 ? "" : "T00:00:00"}Z` : text;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) throw new Error(`"${text}" is not a date`);
    return date;
}

/** A value of a script as extended JSON, to send it to the server. */
export function toEjson(value: unknown): Json {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : { $numberDouble: String(value) };
    if (typeof value === "bigint") return { $numberLong: value.toString() };
    if (typeof value === "function") return { $code: String(value) };
    if (value instanceof BsonValue) return value.toEjson();
    if (value instanceof Date) return { $date: { $numberLong: String(value.getTime()) } };
    if (value instanceof RegExp) return { $regularExpression: { pattern: value.source, options: value.flags } };
    if (Array.isArray(value)) return value.map(toEjson);
    // A field set to `undefined` is left out, as drivers do.
    return Object.fromEntries(Object.entries(value as object).filter(([, item]) => item !== undefined).map(([name, item]) => [name, toEjson(item)]));
}

function wrapped(value: Doc): unknown {
    const keys = Object.keys(value);
    const first = keys[0];
    if (first === undefined || !first.startsWith("$") || keys.length > 2) return undefined;
    const inner = value[first]!;
    const part = (name: string) => (inner as Doc)[name];
    switch (first) {
        case "$oid": return new ObjectId(String(inner));
        case "$date": return new Date(Number(typeof inner === "object" && inner !== null ? (inner as Doc).$numberLong : inner));
        case "$numberInt":
        case "$numberDouble": return Number(inner);
        case "$numberLong": return new NumberLong(String(inner));
        case "$numberDecimal": return new NumberDecimal(String(inner));
        case "$regularExpression": return new RegExp(String(part("pattern")), String(part("options") ?? "").replace(/[^dgimsuvy]/g, ""));
        case "$binary": return new BinData(parseInt(String(part("subType")), 16), String(part("base64")));
        case "$timestamp": return new Timestamp(Number(part("t")), Number(part("i")));
        case "$minKey": return new MinKey();
        case "$maxKey": return new MaxKey();
        case "$undefined": return null;
        default: return undefined;
    }
}

/** A value from the server (canonical extended JSON) as a script works with it. */
export function fromEjson(value: Json): unknown {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(fromEjson);
    const special = wrapped(value);
    if (special !== undefined) return special;
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, fromEjson(item)]));
}
