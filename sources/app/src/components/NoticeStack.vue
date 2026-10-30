<script setup lang="ts">
import { Portal, useMutationObserver } from "@vuetify/v0";
import { computed, reactive, shallowRef } from "vue";
import { useNotices, VISIBLE_CARDS } from "@/composables/notices";
import NoticeCard from "./NoticeCard.vue";

/**
 * The cards of the notices, like VS Code's toasts: a plain column at the bottom right above the
 * status bar, the newest nearest the corner. A new card fades in, a closed one fades out and the
 * others slide into place; nothing else moves. With the pointer (or the keyboard) on the column the
 * time of every card stands still; Esc closes them all. Over open dialogs as well, in the same
 * corner. While the list behind the bell is open there are no cards: they are in the list.
 */
const notices = useNotices();
const hovering = shallowRef(false);
const focused = shallowRef(false);
const paused = computed(() => hovering.value || focused.value);

// The stack lives in the topmost open <dialog> (else a modal dialog's backdrop would cover it); a
// closed dialog stays in the page, hidden, so when the topmost dialog changes the stack is mounted
// anew where it belongs now. Same corner, no appear transition: nothing shows of the move.
const portalKey = shallowRef(0);
let topmost: Element | undefined;
function lookForDialogs() {
    const open = [...document.querySelectorAll("dialog[open]")].at(-1);
    if (open !== topmost) {
        topmost = open;
        portalKey.value++;
    }
}
useMutationObserver(document.body, lookForDialogs, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
lookForDialogs();

const shown = computed(() => (notices.state.centerOpen ? [] : notices.cards.value.slice(0, VISIBLE_CARDS)));
const more = computed(() => notices.bumped.value.length);
const heights = reactive(new Map<number, number>());

const GAP = 8;

/** Where each card lies (upwards from the corner) and how high the column is. */
const layout = computed(() => {
    let offset = 0;
    const cards = shown.value.map((notice) => {
        const style = { transform: `translateY(${-offset}px)` };
        offset += (heights.get(notice.id) ?? 0) + GAP;
        return { notice, style };
    });
    return { cards, height: Math.max(0, offset - GAP) };
});

function measured(id: number, height: number) {
    heights.set(id, height);
}

function focusOut(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (!next || !(event.currentTarget as HTMLElement).contains(next)) focused.value = false;
}
</script>

<template>
    <Portal
        :key="portalKey"
        v-slot="{ zIndex }"
        :scrim="false"
        to="top-layer"
    >
        <!-- Stays in the page while empty, so the last card can fade out. -->
        <section
            @focusin="focused = true"
            @focusout="focusOut"
            @keydown.esc.stop="notices.dismissAll()"
            @mouseenter="hovering = true"
            @mouseleave="hovering = false"
            :aria-label="$t('notices.region')"
            :style="{ zIndex, height: `${layout.height}px` }"
            class="fixed bottom-9 right-4.5 w-[min(calc(100vw-2.25rem),22rem)]"
            data-testid="notice-stack"
        >
            <!-- Above the column: what newer cards pushed behind the bell, and closing them all. -->
            <div
                v-if="shown.length > 0"
                :style="{ bottom: `${layout.height + 4}px` }"
                class="absolute inset-x-0 flex items-center gap-2 text-[11px] transition-[bottom] duration-200 ease-out motion-reduce:transition-none"
            >
                <button
                    v-if="more > 0"
                    @click="notices.setCenterOpen(true)"
                    class="px-1 rounded-sm text-on-surface-variant hover:text-on-surface-strong hover:underline"
                    data-testid="notice-more"
                    type="button"
                >
                    {{ $t("notices.more", { count: more }, more) }}
                </button>
                <button
                    v-if="shown.length > 1"
                    @click="notices.dismissAll()"
                    :class="paused ? 'opacity-100' : 'opacity-0'"
                    class="ml-auto px-1 rounded-sm text-on-surface-variant hover:text-on-surface-strong hover:underline transition-opacity duration-150 focus-visible:opacity-100"
                    data-testid="notice-close-all"
                    type="button"
                >
                    {{ $t("notices.closeAll") }}
                </button>
            </div>
            <TransitionGroup name="notice">
                <div
                    v-for="card in layout.cards"
                    :key="card.notice.id"
                    :style="card.style"
                    class="notice-slot absolute bottom-0 right-0 w-full"
                >
                    <NoticeCard
                        @height="measured"
                        :notice="card.notice"
                        :paused="paused"
                    />
                </div>
            </TransitionGroup>
        </section>
    </Portal>
</template>
