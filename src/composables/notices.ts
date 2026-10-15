import { computed, reactive } from "vue";

/** What a notice is about; it decides its symbol, its color and how long its card stays. */
export type NoticeKind = "success" | "info" | "warning" | "error" | "progress";

/** A button in a notice's card, e.g. "Open folder", "Copy", "Stop". */
export interface NoticeAction {
    label: string;
    run: () => unknown;
    /** The card stays after the action (e.g. "Copy" of an error); otherwise it closes. */
    keep?: boolean;
}

export interface Notice {
    id: number;
    kind: NoticeKind;
    title: string;
    detail?: string;
    actions: NoticeAction[];
    /** When it came, for the history. */
    at: Date;
    read: boolean;
    /** Shown as a card at the bottom right; an answer to a click only goes to the status bar. */
    card: boolean;
    /** Milliseconds the card stays; `0` until it is closed. */
    lifetime: number;
    /** A piece of work that runs: how far it got (`total` 0 when the end is not known). */
    done?: number;
    total?: number;
}

/** How long a card stays: what went well goes by itself, what needs a look stays. */
const LIFETIME: Record<NoticeKind, number> = { success: 4000, info: 5000, warning: 0, error: 0, progress: 0 };
/** Cards at once; the others wait in the history behind the bell. */
export const VISIBLE_CARDS = 3;
const HISTORY_LIMIT = 200;

let nextId = 1;

const state = reactive({
    /** Newest first: the session's history, and the cards among them. */
    notices: [] as Notice[],
    /** The answer to a click, shown in the status bar for a moment. */
    status: undefined as { id: number; kind: NoticeKind; text: string } | undefined
});

/**
 * The app's notices (plan 16, variant C): a card at the bottom right for the outcome of work and
 * for problems, a short answer in the status bar for a click, progress as a card with "Stop"
 * instead of a dialog, and everything of the session in the history behind the bell.
 */
export function useNotices() {
    function add(input: { kind: NoticeKind; title: string; detail?: string; actions?: NoticeAction[]; sticky?: boolean }, card: boolean): Notice {
        state.notices.unshift({
            id: nextId++,
            kind: input.kind,
            title: input.title,
            detail: input.detail,
            actions: input.actions ?? [],
            at: new Date(),
            read: false,
            card,
            lifetime: input.sticky ? 0 : LIFETIME[input.kind]
        });
        if (state.notices.length > HISTORY_LIMIT) state.notices.splice(HISTORY_LIMIT);
        // The reactive copy, so later changes (progress) show.
        return state.notices[0]!;
    }

    /** The outcome of work or a problem: a card, and an entry in the history. */
    /** `sticky`: the card stays until it is closed or answered, whatever its kind. */
    function notify(input: { kind: Exclude<NoticeKind, "progress">; title: string; detail?: string; actions?: NoticeAction[]; sticky?: boolean }): Notice {
        return add(input, true);
    }

    /** The answer to what was just clicked ("Copied", "3 documents"): only the status bar and the history. */
    function answer(title: string, kind: "success" | "info" = "success"): void {
        const notice = add({ kind, title }, false);
        // Seen where it shows: it does not count as unread behind the bell.
        notice.read = true;
        state.status = { id: notice.id, kind, text: title };
    }

    /** A piece of work that runs, with a way to stop it; `finish` takes it away again. */
    function progress(title: string, detail: string, stop: NoticeAction) {
        const notice = add({ kind: "progress", title, detail, actions: [{ ...stop, keep: true }] }, true);
        notice.done = 0;
        notice.total = 0;
        return {
            notice,
            update(done: number, total?: number) {
                notice.done = done;
                if (total !== undefined) notice.total = total;
            },
            finish() {
                remove(notice.id);
            }
        };
    }

    /** The card goes; the notice stays in the history (a running piece of work goes on in the status bar). */
    function dismiss(id: number): void {
        const notice = state.notices.find(item => item.id === id);
        if (notice) notice.card = false;
    }

    /** The card of a notice shows again, e.g. of the work that runs, from the status bar. */
    function reopen(id: number): void {
        const notice = state.notices.find(item => item.id === id);
        if (notice) notice.card = true;
    }

    function remove(id: number): void {
        const index = state.notices.findIndex(item => item.id === id);
        if (index !== -1) state.notices.splice(index, 1);
    }

    function markAllRead(): void {
        for (const notice of state.notices) notice.read = true;
    }

    /** Empties the history; work that still runs stays. */
    function clear(): void {
        state.notices = state.notices.filter(notice => notice.kind === "progress");
    }

    const cards = computed(() => state.notices.filter(notice => notice.card));
    const history = computed(() => state.notices.filter(notice => notice.kind !== "progress"));
    const unread = computed(() => history.value.filter(notice => !notice.read));
    const running = computed(() => state.notices.filter(notice => notice.kind === "progress"));

    return { state, cards, history, unread, running, notify, answer, progress, dismiss, reopen, markAllRead, clear };
}
