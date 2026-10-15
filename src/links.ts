import { openUrl } from "@tauri-apps/plugin-opener";
import { inApp } from "./api";

/** A value that is a web address and nothing else: shown as a link in the results. */
export function isLink(value: unknown): value is string {
    return typeof value === "string" && value.length <= 2048 && /^https?:\/\/[^\s"<>]+$/i.test(value);
}

/** Opens the address in the system's browser (in the browser preview: a new tab). */
export async function openLink(url: string): Promise<void> {
    if (!isLink(url)) return;
    if (inApp) await openUrl(url);
    else window.open(url, "_blank", "noopener");
}
