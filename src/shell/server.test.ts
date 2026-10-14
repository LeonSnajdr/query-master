import { describe, expect, it } from "vitest";
import { formatUptime, keepLine, parseLogLine, runningOperation, summarize } from "./server";

const reply = (inserts: number, bytesIn: number) => ({
    host: "db1:27017",
    version: "8.0.4",
    process: "mongod",
    uptime: { $numberDouble: "93784" },
    connections: { current: { $numberInt: "5" }, available: { $numberInt: "100" }, totalCreated: { $numberInt: "40" } },
    opcounters: { insert: { $numberLong: String(inserts) }, query: 10, update: 0, delete: 0, getmore: 0, command: 100 },
    network: { bytesIn: { $numberLong: String(bytesIn) }, bytesOut: 0 },
    mem: { resident: { $numberInt: "120" }, virtual: { $numberInt: "2048" } },
    repl: { setName: "rs0", isWritablePrimary: true }
});

describe("summarize", () => {
    it("reads the figures and leaves rates out for the first reply", () => {
        const summary = summarize({ reply: reply(50, 0), at: 0 });
        expect(summary).toMatchObject({
            host: "db1:27017",
            uptimeSeconds: 93784,
            connections: { current: 5, available: 100, totalCreated: 40 },
            totals: { insert: 50, command: 100 },
            memory: { resident: 120, virtual: 2048 },
            replication: { setName: "rs0", primary: true }
        });
        expect(summary.rates).toBeUndefined();
    });

    it("counts per second between two replies, never below zero", () => {
        const summary = summarize({ reply: reply(70, 4096), at: 2000 }, { reply: reply(50, 0), at: 0 });
        expect(summary.rates).toMatchObject({ insert: 10, query: 0, bytesIn: 2048 });
        // The server restarted in between: its counters started again.
        expect(summarize({ reply: reply(5, 0), at: 2000 }, { reply: reply(50, 0), at: 0 }).rates?.insert).toBe(0);
    });

    it("has no replication for a single server", () => {
        const single: Record<string, unknown> = reply(0, 0);
        delete single.repl;
        expect(summarize({ reply: single as ReturnType<typeof reply>, at: 0 }).replication).toBeUndefined();
    });
});

describe("formatUptime", () => {
    it("names days, hours and minutes", () => {
        expect(formatUptime(93784)).toBe("1d 2h 3m");
        expect(formatUptime(42)).toBe("42s");
    });
});

describe("parseLogLine", () => {
    it("reads structured lines", () => {
        const raw = "{\"t\":{\"$date\":\"2026-10-14T07:00:00.000+00:00\"},\"s\":\"I\",  \"c\":\"NETWORK\",  \"id\":22943,   \"ctx\":\"listener\",\"msg\":\"Connection accepted\",\"attr\":{\"remote\":\"127.0.0.1:5000\"}}";
        expect(parseLogLine(raw)).toEqual({
            time: "2026-10-14T07:00:00.000+00:00",
            severity: "I",
            component: "NETWORK",
            context: "listener",
            message: "Connection accepted",
            attributes: "{\"remote\":\"127.0.0.1:5000\"}",
            raw
        });
    });

    it("keeps a text line of an old server whole", () => {
        const raw = "2019-01-01T00:00:00.000+0000 I NETWORK  [listener] connection accepted";
        expect(parseLogLine(raw)).toMatchObject({ severity: "", message: raw });
    });

    it("filters by severity and text", () => {
        const warning = parseLogLine("{\"s\":\"W\",\"c\":\"STORAGE\",\"msg\":\"Disk slow\"}");
        const info = parseLogLine("{\"s\":\"I\",\"c\":\"NETWORK\",\"msg\":\"Hello\"}");
        expect(keepLine(warning, "warning", "")).toBe(true);
        expect(keepLine(info, "warning", "")).toBe(false);
        expect(keepLine(warning, "error", "")).toBe(false);
        expect(keepLine(info, "all", "hello")).toBe(true);
        expect(keepLine(info, "all", "disk")).toBe(false);
    });
});

describe("runningOperation", () => {
    it("takes the columns of the table", () => {
        expect(runningOperation({ opid: 12, op: "query", ns: "shop.orders", secs_running: { $numberLong: "3" }, client: "1.2.3.4:5", desc: "conn7", command: { find: "orders" } })).toEqual({
            opid: 12,
            op: "query",
            namespace: "shop.orders",
            seconds: 3,
            client: "1.2.3.4:5",
            description: "conn7",
            command: "{ find: \"orders\" }"
        });
    });
});
