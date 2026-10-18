import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotices } from "./notices";
import { warnOnce } from "./unseen";

// The browser preview's backend reads the address of the page; the tests run without one.
vi.hoisted(() => Object.assign(globalThis, { location: globalThis.location ?? { search: "" } }));

const notices = useNotices();

beforeEach(() => {
    notices.clear();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("warnOnce", () => {
    it("warns once in a session for each kind of failure, with what went wrong", () => {
        warnOnce("unseen.historyNotSaved", new Error("disk full"));
        warnOnce("unseen.historyNotSaved", new Error("disk full"));
        warnOnce("unseen.settingsNotSaved", new Error("disk full"));
        expect(notices.cards.value.map(notice => [notice.kind, notice.detail])).toEqual([["warning", "disk full"], ["warning", "disk full"]]);
        expect(notices.cards.value.map(notice => notice.title)).not.toContain("unseen.historyNotSaved");
    });
});
