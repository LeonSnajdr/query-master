import { reactive } from "vue";
import { backend } from "@/api";

/** The long piece of work that is running (a copy, an export, an import), for the progress dialog. */
const running = reactive({
    runId: undefined as string | undefined,
    title: "",
    text: "",
    done: 0,
    /** `0` when the end is not known beforehand. */
    total: 0
});

/** One long piece of work at a time, shown with its progress and a way to stop it. */
export function useTask() {
    /** Runs `work` with a new run id; the dialog shows while it lasts. */
    async function track<T>(title: string, text: string, work: (runId: string, progress: (done: number, total?: number) => void) => Promise<T>): Promise<T> {
        const runId = `task-${Date.now()}`;
        Object.assign(running, { runId, title, text, done: 0, total: 0 });
        try {
            return await work(runId, (done, total) => {
                running.done = done;
                if (total !== undefined) running.total = total;
            });
        } finally {
            running.runId = undefined;
        }
    }

    function stop() {
        if (running.runId) void backend.stopRun(running.runId);
    }

    return { running, track, stop };
}
