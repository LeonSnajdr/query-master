import { describe, expect, it } from "vitest";
import { isSystemCollection } from "./export";
import { applyProgress, overall, waitingRows } from "./progress";

describe("progress", () => {
    it("takes the updates of the Rust side into the rows", () => {
        const rows = waitingRows(2);
        applyProgress(rows, { item: 1, done: 500, total: 2000, share: 0.25, state: "running", error: null }, String);
        expect(rows[1]).toEqual({ state: "running", done: 500, total: 2000, share: 0.25, error: undefined });
        applyProgress(rows, { item: 1, done: 500, total: null, share: null, state: "failed", error: "broken" }, error => `! ${String(error)}`);
        expect(rows[1]).toMatchObject({ state: "failed", total: undefined, share: undefined, error: "! broken" });
        // An update for a row that is not there changes nothing.
        applyProgress(rows, { item: 5, done: 1, total: null, share: null, state: "done", error: null }, String);
        expect(rows).toHaveLength(2);
    });

    it("weighs the rows alike: one that ended is whole, one at work counts by its share", () => {
        const rows = waitingRows(4);
        expect(overall(rows)).toEqual({ share: 0, finished: 0, documents: 0 });
        Object.assign(rows[0]!, { state: "done", done: 1000 });
        Object.assign(rows[1]!, { state: "failed", done: 10 });
        Object.assign(rows[2]!, { state: "running", done: 300, share: 0.5 });
        expect(overall(rows)).toEqual({ share: 2.5 / 4, finished: 2, documents: 1310 });
        // Without a known end, a row at work does not move the bar.
        rows[2]!.share = undefined;
        expect(overall(rows).share).toBe(2 / 4);
        expect(overall([]).share).toBe(0);
    });

    it("knows the server's own collections", () => {
        expect(["system.profile", "system.views", " system.js"].every(isSystemCollection)).toBe(true);
        expect(["orders", "my.system.log", "systems"].some(isSystemCollection)).toBe(false);
    });
});
