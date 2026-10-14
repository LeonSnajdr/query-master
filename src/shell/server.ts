import { isDoc, toNumber } from "@/shell/ejson";
import type { Doc, Json } from "@/shell/ejson";

/** Operation counters of `serverStatus.opcounters`, in this order. */
export const OPERATIONS = ["insert", "query", "update", "delete", "getmore", "command"] as const;
export type Operation = typeof OPERATIONS[number];

/** The figures the status tab shows, out of one `serverStatus` reply (and the one before it). */
export interface ServerSummary {
    host: string;
    version: string;
    process: string;
    uptimeSeconds: number;
    connections: { current: number; available: number; totalCreated: number };
    /** Per second since the reply before; absent for the first reply. */
    rates?: Record<Operation, number> & { bytesIn: number; bytesOut: number };
    /** Counted since the server started. */
    totals: Record<Operation, number>;
    /** Megabytes. */
    memory: { resident: number; virtual: number };
    /** Name of the replica set and this member's part; absent for a single server. */
    replication?: { setName: string; primary: boolean };
}

/** One `serverStatus` reply with when it was taken, in milliseconds. */
export interface StatusSample {
    reply: Doc;
    at: number;
}

function path(document: Json | undefined, ...keys: string[]): Json | undefined {
    let value = document;
    for (const key of keys) value = isDoc(value) ? value[key] : undefined;
    return value;
}

function number(document: Json | undefined, ...keys: string[]): number {
    return toNumber(path(document, ...keys)) ?? 0;
}

function text(document: Json | undefined, ...keys: string[]): string {
    const value = path(document, ...keys);
    return typeof value === "string" ? value : "";
}

export function summarize(current: StatusSample, previous?: StatusSample): ServerSummary {
    const reply = current.reply;
    const totals = Object.fromEntries(OPERATIONS.map(name => [name, number(reply, "opcounters", name)])) as Record<Operation, number>;
    const summary: ServerSummary = {
        host: text(reply, "host"),
        version: text(reply, "version"),
        process: text(reply, "process"),
        uptimeSeconds: number(reply, "uptime"),
        connections: {
            current: number(reply, "connections", "current"),
            available: number(reply, "connections", "available"),
            totalCreated: number(reply, "connections", "totalCreated")
        },
        totals,
        memory: { resident: number(reply, "mem", "resident"), virtual: number(reply, "mem", "virtual") }
    };
    const seconds = previous ? (current.at - previous.at) / 1000 : 0;
    if (previous && seconds > 0) {
        // A counter that went down means the server restarted in between: no rate then.
        const rate = (now: number, before: number) => Math.max(0, now - before) / seconds;
        summary.rates = {
            ...Object.fromEntries(OPERATIONS.map(name => [name, rate(totals[name], number(previous.reply, "opcounters", name))])) as Record<Operation, number>,
            bytesIn: rate(number(reply, "network", "bytesIn"), number(previous.reply, "network", "bytesIn")),
            bytesOut: rate(number(reply, "network", "bytesOut"), number(previous.reply, "network", "bytesOut"))
        };
    }
    const setName = text(reply, "repl", "setName");
    if (setName) {
        const primary = path(reply, "repl", "isWritablePrimary") ?? path(reply, "repl", "ismaster");
        summary.replication = { setName, primary: primary === true };
    }
    return summary;
}

/** `1d 4h 3m` out of seconds; seconds only below a minute. */
export function formatUptime(seconds: number): string {
    const units: [number, string][] = [[86_400, "d"], [3600, "h"], [60, "m"]];
    const parts: string[] = [];
    let rest = Math.floor(seconds);
    for (const [size, unit] of units) {
        if (rest >= size) {
            parts.push(`${Math.floor(rest / size)}${unit}`);
            rest %= size;
        }
    }
    return parts.length > 0 ? parts.join(" ") : `${rest}s`;
}

/** One line of the server log. */
export interface LogLine {
    /** ISO time; empty when the line is not structured. */
    time: string;
    /** `F`, `E`, `W`, `I`, `D1` … `D5`; empty when the line is not structured. */
    severity: string;
    component: string;
    context: string;
    message: string;
    /** The attributes as compact JSON, empty when there are none. */
    attributes: string;
    /** The line as the server gave it, for search and copying. */
    raw: string;
}

/**
 * Reads the lines of `getLog`. Since MongoDB 4.4 every line is a JSON document; older servers
 * write text, which is kept whole as the message.
 */
export function parseLogLine(raw: string): LogLine {
    try {
        const entry = JSON.parse(raw) as unknown;
        if (typeof entry === "object" && entry !== null && "msg" in entry) {
            const line = entry as { t?: { $date?: string }; s?: string; c?: string; ctx?: string; msg?: string; attr?: unknown };
            return {
                time: line.t?.$date ?? "",
                severity: (line.s ?? "").trim(),
                component: (line.c ?? "").trim(),
                context: line.ctx ?? "",
                message: line.msg ?? "",
                attributes: line.attr === undefined ? "" : JSON.stringify(line.attr),
                raw
            };
        }
    } catch {
        // Not JSON: a line of a server before 4.4.
    }
    return { time: "", severity: "", component: "", context: "", message: raw, attributes: "", raw };
}

/** The level a severity filter keeps; debug levels count as one. */
export type SeverityFilter = "all" | "warning" | "error";

export function keepLine(line: LogLine, severity: SeverityFilter, search: string): boolean {
    if (severity === "error" && !["F", "E"].includes(line.severity)) return false;
    if (severity === "warning" && !["F", "E", "W"].includes(line.severity)) return false;
    const needle = search.trim().toLowerCase();
    return needle === "" || line.raw.toLowerCase().includes(needle);
}

/** A running operation out of `$currentOp`, as the table of the status tab shows it. */
export interface RunningOperation {
    opid: Json;
    op: string;
    namespace: string;
    seconds: number;
    client: string;
    description: string;
    /** The command, shortened to one line. */
    command: string;
}

export function runningOperation(entry: Doc): RunningOperation {
    return {
        opid: entry.opid ?? null,
        op: text(entry, "op"),
        namespace: text(entry, "ns"),
        seconds: number(entry, "secs_running"),
        client: text(entry, "client") || text(entry, "client_s"),
        description: text(entry, "desc"),
        command: isDoc(entry.command) ? JSON.stringify(entry.command).slice(0, 200) : ""
    };
}
