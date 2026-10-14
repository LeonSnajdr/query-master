import { useI18n } from "vue-i18n";
import { errorMessage } from "@/api";
import { useNotices } from "@/composables/notices";
import type { Message } from "@/shell/message";

/** The messages of work the user stopped: not an error. */
const STOPPED = new Set(["error.copy.stopped", "error.transfer.stopped", "error.script.stopped"]);

/** Texts that come as a message key or as they are (errors of the driver), in the app's language. */
export function useMessages() {
    const { t } = useI18n();
    const notices = useNotices();

    function say(message: string | Message): string {
        return typeof message === "string" ? message : t(message.key, message.params ?? {});
    }

    /**
     * Shows what went wrong as a card that stays until it is closed, with a way to copy the text.
     * Work stopped on purpose is no error: that is said briefly, and the card goes by itself.
     */
    function report(error: unknown): void {
        const message = errorMessage(error);
        const text = say(message);
        if (typeof message !== "string" && STOPPED.has(message.key)) {
            notices.notify({ kind: "info", title: text });
            return;
        }
        notices.notify({ kind: "error", title: text, actions: [{ label: t("action.copy"), run: () => navigator.clipboard.writeText(text), keep: true }] });
    }

    return { say, report };
}
