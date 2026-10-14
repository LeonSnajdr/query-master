import { reactive } from "vue";
import { useI18n } from "vue-i18n";
import { backend } from "@/api";
import { useNotices } from "@/composables/notices";

/** The long piece of work that is running (a copy, an upload, a download): one at a time. */
const running = reactive({
    runId: undefined as string | undefined
});

/**
 * One long piece of work at a time, shown as a notice with its progress and "Stop"; the app stays
 * usable meanwhile. Closed, the notice goes on in the status bar.
 */
export function useTask() {
    const { t } = useI18n();
    const notices = useNotices();

    /** Runs `work` with a new run id; the notice shows while it lasts. */
    async function track<T>(title: string, text: string, work: (runId: string, progress: (done: number, total?: number) => void) => Promise<T>): Promise<T> {
        const runId = `task-${Date.now()}`;
        running.runId = runId;
        const shown = notices.progress(title, text, { label: t("action.stop"), run: () => void backend.stopRun(runId) });
        try {
            return await work(runId, (done, total) => shown.update(done, total));
        } finally {
            running.runId = undefined;
            shown.finish();
        }
    }

    function stop() {
        if (running.runId) void backend.stopRun(running.runId);
    }

    return { running, track, stop };
}
