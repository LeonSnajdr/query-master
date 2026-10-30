import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotices } from "./notices";

const notices = useNotices();

beforeEach(() => {
    for (const task of notices.running.value) notices.state.notices.splice(notices.state.notices.indexOf(task), 1);
    notices.clear();
    notices.state.status = undefined;
    notices.state.centerOpen = false;
});

describe("notices", () => {
    it("shows work and problems as cards that go by themselves, problems a little later; sticky ones stay", () => {
        const done = notices.notify({ kind: "success", title: "Export done" });
        const failed = notices.notify({ kind: "error", title: "Insert refused" });
        const kept = notices.notify({ kind: "info", title: "Pick a file", sticky: true });
        expect(notices.cards.value.map(notice => notice.title)).toEqual(["Pick a file", "Insert refused", "Export done"]);
        expect(done.lifetime).toBeGreaterThan(0);
        expect(failed.lifetime).toBeGreaterThan(done.lifetime);
        expect(kept.lifetime).toBe(0);
        expect(notices.unread.value).toHaveLength(3);
    });

    it("lets a new card push the oldest behind the bell instead of keeping it waiting", () => {
        for (const title of ["one", "two", "three", "four"]) notices.notify({ kind: "error", title });
        expect(notices.cards.value.map(notice => notice.title)).toEqual(["four", "three", "two"]);
        expect(notices.bumped.value.map(notice => notice.title)).toEqual(["one"]);
        // Closing a card brings nothing back.
        notices.dismiss(notices.cards.value[0]!.id);
        expect(notices.cards.value.map(notice => notice.title)).toEqual(["three", "two"]);
        notices.dismissAll();
        expect(notices.cards.value).toHaveLength(0);
        notices.markAllRead();
        expect(notices.bumped.value).toHaveLength(0);
    });

    it("takes the cards into the open list, and shows what comes then in the list only", () => {
        notices.notify({ kind: "error", title: "Insert refused" });
        notices.setCenterOpen(true);
        expect(notices.cards.value).toHaveLength(0);
        const later = notices.notify({ kind: "warning", title: "Read-only" });
        expect(later.card).toBe(false);
        expect(later.read).toBe(true);
        notices.setCenterOpen(false);
        expect(notices.cards.value).toHaveLength(0);
        notices.forget(later.id);
        expect(notices.history.value.map(notice => notice.title)).toEqual(["Insert refused"]);
    });

    it("answers a click in the status bar only, as read, and keeps it in the history", () => {
        notices.answer("Copied");
        expect(notices.cards.value).toHaveLength(0);
        expect(notices.state.status).toMatchObject({ kind: "success", text: "Copied" });
        expect(notices.history.value.map(notice => notice.title)).toEqual(["Copied"]);
        expect(notices.unread.value).toHaveLength(0);
    });

    it("keeps a closed card in the history, and reading it there counts it as read", () => {
        const notice = notices.notify({ kind: "warning", title: "Read-only" });
        notices.dismiss(notice.id);
        expect(notices.cards.value).toHaveLength(0);
        expect(notices.unread.value).toHaveLength(1);
        notices.markAllRead();
        expect(notices.unread.value).toHaveLength(0);
        notices.clear();
        expect(notices.history.value).toHaveLength(0);
    });

    it("runs work as a card with Stop that goes on in the status bar when closed, and leaves no trace when done", () => {
        const stop = vi.fn();
        const task = notices.progress("Copying", "a → b", { label: "Stop", run: stop });
        task.update(10, 40);
        expect(notices.running.value[0]).toMatchObject({ title: "Copying", done: 10, total: 40, card: true });
        notices.dismiss(task.notice.id);
        expect(notices.running.value[0]?.card).toBe(false);
        notices.reopen(task.notice.id);
        expect(notices.cards.value[0]?.id).toBe(task.notice.id);
        void notices.running.value[0]?.actions[0]?.run();
        expect(stop).toHaveBeenCalledOnce();
        // Clearing the history does not take away what still runs; finishing does.
        notices.clear();
        expect(notices.running.value).toHaveLength(1);
        task.finish();
        expect(notices.running.value).toHaveLength(0);
        expect(notices.history.value).toHaveLength(0);
    });
});
