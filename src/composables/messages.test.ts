import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShellError } from "@/shell/message";
import { useMessages } from "./messages";
import { useNotices } from "./notices";

// The browser preview's backend reads the address of the page; the tests run without one.
vi.hoisted(() => Object.assign(globalThis, { location: globalThis.location ?? { search: "" } }));

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const notices = useNotices();
const { report, tell } = useMessages();

beforeEach(() => {
    notices.clear();
    notices.state.status = undefined;
});

describe("messages", () => {
    it("shows a failure as an error card with a way to copy it", () => {
        report(new Error("not authorized on shop"));
        expect(notices.cards.value).toHaveLength(1);
        expect(notices.cards.value[0]).toMatchObject({ kind: "error", title: "not authorized on shop" });
        expect(notices.cards.value[0]!.actions[0]!.copies).toBe(true);
    });

    it("says a write the user said no to in the status bar only: no error", () => {
        tell({ key: "error.write.cancelled" });
        expect(notices.cards.value).toHaveLength(0);
        expect(notices.state.status).toMatchObject({ kind: "info", text: "error.write.cancelled" });
    });

    it("shows a lock that refused a change as a note, not as an error", () => {
        report(new ShellError("error.plan.readonlyTree", { name: "shop.orders" }));
        expect(notices.cards.value[0]).toMatchObject({ kind: "info" });
    });
});
