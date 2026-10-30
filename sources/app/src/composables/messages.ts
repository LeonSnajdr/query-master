import { useI18n } from "vue-i18n";
import { errorMessage } from "@/api";
import { useNotices } from "@/composables/notices";
import type { Message } from "@/shell/message";

/** The messages of work the user stopped: not an error. */
const STOPPED = new Set(["error.transfer.stopped", "error.script.stopped"]);
/** The user said no when asked before a write: a word in the status bar. */
const CANCELLED = "error.write.cancelled";
/** A lock that refused a change: a note, nothing went wrong. */
const LOCKED = new Set(["error.plan.readonly", "error.plan.readonlyTree"]);

/** Texts that come as a message key or as they are (errors of the driver), in the app's language. */
export function useMessages() {
    const { t } = useI18n();
    const notices = useNotices();

    function say(message: string | Message): string {
        return typeof message === "string" ? message : t(message.key, message.params ?? {});
    }

    /**
     * Shows what went wrong as a card, with a way to copy the text: for what has no place of its
     * own to show it (a dialog, the result of a tab and the pages show their errors themselves).
     * Work stopped on purpose, a write said no to and a lock are no error: that is said briefly, and the card goes by itself.
     */
    function report(error: unknown): void {
        tell(errorMessage(error));
    }

    /** As `report`, for a message at hand (e.g. what a write of the store returned). */
    function tell(message: string | Message): void {
        const text = say(message);
        if (typeof message !== "string" && message.key === CANCELLED) {
            notices.answer(text, "info");
            return;
        }
        if (typeof message !== "string" && (STOPPED.has(message.key) || LOCKED.has(message.key))) {
            notices.notify({ kind: "info", title: text });
            return;
        }
        notices.notify({ kind: "error", title: text, actions: [{ label: t("action.copy"), run: () => navigator.clipboard.writeText(text), keep: true, copies: true }] });
    }

    return { say, report, tell };
}
