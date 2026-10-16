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
    /** Its card made room for newer ones before it was read: counted below the cards as "more behind the bell". */
    bumped?: boolean;
    /** Milliseconds the card stays; `0` until it is closed. */
    lifetime: number;
    /** A piece of work that runs: how far it got (`total` 0 when the end is not known). */
    done?: number;
    total?: number;
}

/**
 * How long a card stays (as VS Code: a problem a little longer, but it goes as well; the bell keeps
 * it, red). Only work that runs, and what is `sticky`, stays until it is closed.
 */
const LIFETIME: Record<NoticeKind, number> = { success: 4000, info: 5000, warning: 12000, error: 15000, progress: 0 };
/** Cards at once; a newer one pushes the oldest into the history behind the bell, none waits. */
export const VISIBLE_CARDS = 3;
const HISTORY_LIMIT = 200;

let nextId = 1;

const state = reactive({
    /** Newest first: the session's history, and the cards among them. */
    notices: [] as Notice[],
    /** The answer to a click, shown in the status bar for a moment. */
    status: undefined as { id: number; kind: NoticeKind; text: string } | undefined,
    /** The list behind the bell is open: no cards then (as VS Code), what comes goes into the list. */
    centerOpen: false
});

/**
 * The app's notices (plan 16, variant C): a card at the bottom right for the outcome of work and
 * for problems, a short answer in the status bar for a click, progress as a card with "Stop"
 * instead of a dialog, and everything of the session in the history behind the bell.
 */
export function useNotices() {
    function add(input: { kind: NoticeKind; title: string; detail?: string; actions?: NoticeAction[]; sticky?: boolean }, card: boolean): Notice {
        // With the list open a notice shows there, read, instead of as a card (work that runs keeps its card for later).
        const intoList = card && state.centerOpen && input.kind !== "progress";
        if (card && !intoList) makeRoom();
        state.notices.unshift({
            id: nextId++,
            kind: input.kind,
            title: input.title,
            detail: input.detail,
            actions: input.actions ?? [],
            at: new Date(),
            read: intoList,
            card: card && !intoList,
            lifetime: input.sticky ? 0 : LIFETIME[input.kind]
        });
        if (state.notices.length > HISTORY_LIMIT) state.notices.splice(HISTORY_LIMIT);
        // The reactive copy, so later changes (progress) show.
        return state.notices[0]!;
    }

    /** One card less than allowed: the oldest one that does not run goes behind the bell. */
    function makeRoom(): void {
        const shown = state.notices.filter(notice => notice.card);
        if (shown.length < VISIBLE_CARDS) return;
        const oldest = shown.findLast(notice => notice.kind !== "progress");
        if (!oldest) return;
        oldest.card = false;
        oldest.bumped = true;
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

    /** Every card goes, e.g. with Esc (work that runs goes on in the status bar). */
    function dismissAll(): void {
        for (const notice of state.notices) notice.card = false;
    }

    /** The card of a notice shows again, e.g. of the work that runs, from the status bar. */
    function reopen(id: number): void {
        const notice = state.notices.find(item => item.id === id);
        if (!notice) return;
        makeRoom();
        notice.card = true;
    }

    /** Opens or closes the list behind the bell; opening takes the cards into it. */
    function setCenterOpen(open: boolean): void {
        state.centerOpen = open;
        if (!open) return;
        for (const notice of state.notices) {
            if (notice.kind !== "progress") notice.card = false;
        }
    }

    /** Takes a notice out of the history (its ✕ there); work that runs stays. */
    function forget(id: number): void {
        const notice = state.notices.find(item => item.id === id);
        if (notice && notice.kind !== "progress") remove(id);
    }

    function remove(id: number): void {
        const index = state.notices.findIndex(item => item.id === id);
        if (index !== -1) state.notices.splice(index, 1);
    }

    function markAllRead(): void {
        for (const notice of state.notices) {
            notice.read = true;
            notice.bumped = false;
        }
    }

    /** Empties the history; work that still runs stays. */
    function clear(): void {
        state.notices = state.notices.filter(notice => notice.kind === "progress");
    }

    const cards = computed(() => state.notices.filter(notice => notice.card));
    const history = computed(() => state.notices.filter(notice => notice.kind !== "progress"));
    const unread = computed(() => history.value.filter(notice => !notice.read));
    const running = computed(() => state.notices.filter(notice => notice.kind === "progress"));
    /** Pushed out by newer cards and not read yet. */
    const bumped = computed(() => state.notices.filter(notice => notice.bumped && !notice.read));

    return { state, cards, history, unread, running, bumped, notify, answer, progress, dismiss, dismissAll, reopen, setCenterOpen, forget, markAllRead, clear };
}
