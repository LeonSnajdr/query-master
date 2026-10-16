import { useTimer } from "@vuetify/v0";
import { shallowRef } from "vue";
import { useMessages } from "@/composables/messages";

/** How long a copy button says "Copied" (as GitHub's Primer). */
export const COPIED_FOR = 2000;

/**
 * "Copied" for a moment on whatever runs a piece of work, e.g. a notice's "Copy" button: only once
 * it went through, so the word is true. A failure is the caller's to show.
 */
export function useConfirmed() {
    const confirmed = shallowRef(false);
    const timer = useTimer(() => (confirmed.value = false), { duration: COPIED_FOR });

    async function run(work: () => unknown): Promise<void> {
        await work();
        confirmed.value = true;
        timer.start();
    }

    return { confirmed, run };
}

/** A copy button's text to the clipboard, and its "Copied" afterwards; a failure goes to a card. */
export function useCopy() {
    const { report } = useMessages();
    const { confirmed: copied, run } = useConfirmed();

    async function copy(text: string): Promise<void> {
        await run(() => navigator.clipboard.writeText(text)).catch(report);
    }

    return { copied, copy };
}
