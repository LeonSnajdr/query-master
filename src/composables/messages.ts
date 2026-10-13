import { useNotifications } from "@vuetify/v0";
import { useI18n } from "vue-i18n";
import { errorMessage } from "@/api";
import type { Message } from "@/shell/message";

/** Texts that come as a message key or as they are (errors of the driver), in the app's language. */
export function useMessages() {
    const { t } = useI18n();
    const notifications = useNotifications();

    function say(message: string | Message): string {
        return typeof message === "string" ? message : t(message.key, message.params ?? {});
    }

    /** Shows what went wrong as a toast. */
    function report(error: unknown): void {
        notifications.send({ subject: say(errorMessage(error)), severity: "error", timeout: 8000 });
    }

    return { say, report };
}
