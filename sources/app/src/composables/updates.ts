import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { inApp } from "@/api";
import { useNotices } from "@/composables/notices";

/** A check runs: "Check for updates" waits for it instead of starting a second one. */
const checking = shallowRef(false);

/**
 * Updates of the app, as in sast: every release on GitHub carries a signed `latest.json`, the
 * updater plugin compares it with the running version. A newer one is offered as a card; it is
 * downloaded, installed and the app starts again only when asked to.
 */
export function useUpdates() {
    const { t } = useI18n();
    const notices = useNotices();

    /** `quiet`: at the start, nothing is said when there is no update or the check fails. */
    async function checkForUpdate(quiet = false): Promise<void> {
        if (!inApp || checking.value) return;
        checking.value = true;
        try {
            const update = await check();
            if (!update) {
                if (!quiet) notices.answer(t("update.latest"));
                return;
            }
            notices.notify({
                kind: "info",
                title: t("update.available", { version: update.version }),
                detail: update.body || undefined,
                sticky: true,
                actions: [{ label: t("update.install"), run: () => install(update) }]
            });
        } catch (error) {
            if (!quiet) notices.notify({ kind: "error", title: t("update.failed"), detail: String(error) });
        } finally {
            checking.value = false;
        }
    }

    async function install(update: NonNullable<Awaited<ReturnType<typeof check>>>): Promise<void> {
        // A download half done can not be taken back: no "Stop".
        const work = notices.progress(t("update.installing", { version: update.version }), "");
        let total = 0;
        let done = 0;
        try {
            await update.downloadAndInstall((event) => {
                if (event.event === "Started") total = event.data.contentLength ?? 0;
                if (event.event === "Progress") done += event.data.chunkLength;
                work.update(done, total);
            });
            await relaunch();
        } catch (error) {
            notices.notify({ kind: "error", title: t("update.failed"), detail: String(error) });
        } finally {
            work.finish();
        }
    }

    return { checking, checkForUpdate };
}
