import { errorMessage } from "@/api";
import { useNotices } from "@/composables/notices";
import i18n from "@/plugins/i18n";

/** The failures said already in this session. */
const warned = new Set<string>();

/**
 * What the app keeps by itself (settings, shortcuts, history, the session) was not read or written:
 * a warning once in a session, so it is not lost unseen, nor said again at every change after.
 * `key` is the text of the warning.
 */
export function warnOnce(key: string, error: unknown): void {
    console.warn(key, error);
    if (warned.has(key)) return;
    warned.add(key);
    const message = errorMessage(error);
    const detail = typeof message === "string" ? message : i18n.global.t(message.key, message.params ?? {});
    useNotices().notify({ kind: "warning", title: i18n.global.t(key), detail });
}
