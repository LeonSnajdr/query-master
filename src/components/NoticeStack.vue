<script setup lang="ts">
import { Portal, useMutationObserver } from "@vuetify/v0";
import { computed, reactive, shallowRef } from "vue";
import { useNotices, VISIBLE_CARDS } from "@/composables/notices";
import NoticeCard from "./NoticeCard.vue";

/**
 * The cards of the notices: the newest in front, the two before it as edges behind it; with the
 * pointer (or the keyboard) on it the stack fans out and the time of every card stands still.
 * At the bottom right above the status bar; while a dialog is open at the top right below the
 * title bar instead, so no card lies over the dialog's buttons. Over open dialogs as well.
 */
const notices = useNotices();
const hovering = shallowRef(false);
const focused = shallowRef(false);
const expanded = computed(() => hovering.value || focused.value);

// A dialog is open as long as a <dialog open> is in the page. The stack lives in the topmost one
// (else a modal dialog's backdrop would cover it); a closed dialog stays in the page, hidden, so
// when the topmost dialog changes the stack is mounted anew where it belongs now.
const dialogOpen = shallowRef(false);
const portalKey = shallowRef(0);
let topmost: Element | undefined;
function lookForDialogs() {
    const open = [...document.querySelectorAll("dialog[open]")];
    dialogOpen.value = open.length > 0;
    if (open.at(-1) !== topmost) {
        topmost = open.at(-1);
        portalKey.value++;
    }
}
useMutationObserver(document.body, lookForDialogs, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
lookForDialogs();
/** Which way the stack grows from its corner: up from the bottom, down from the top. */
const atTop = computed(() => dialogOpen.value);

const shown = computed(() => notices.cards.value.slice(0, VISIBLE_CARDS));
const hidden = computed(() => notices.cards.value.length - shown.value.length);
const heights = reactive(new Map<number, number>());

const GAP = 8;
/** Collapsed, each card behind the front one peeks out by this much. */
const PEEK = 10;

/** Where each card lies and how high the stack is. */
const layout = computed(() => {
    const direction = atTop.value ? 1 : -1;
    const front = heights.get(shown.value[0]?.id ?? -1) ?? 0;
    let offset = 0;
    const cards = shown.value.map((notice, index) => {
        if (expanded.value) {
            const style = { transform: `translateY(${direction * offset}px)`, zIndex: VISIBLE_CARDS - index };
            offset += (heights.get(notice.id) ?? 0) + GAP;
            return { notice, style };
        }
        return {
            notice,
            style: {
                transform: `translateY(${direction * index * PEEK}px) scale(${1 - index * 0.05})`,
                zIndex: VISIBLE_CARDS - index,
                opacity: index === 0 ? 1 : 1 - index * 0.3,
                // Behind the front card only its edge shows: as high as the front one.
                ...(index > 0 && front > 0 ? { height: `${front}px` } : {})
            }
        };
    });
    const height = expanded.value ? Math.max(0, offset - GAP) : front + Math.min(VISIBLE_CARDS - 1, shown.value.length - 1) * PEEK;
    return { cards, height };
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
        <section
            v-if="shown.length > 0"
            @focusin="focused = true"
            @focusout="focusOut"
            @mouseenter="hovering = true"
            @mouseleave="hovering = false"
            :aria-label="$t('notices.region')"
            :class="atTop ? 'top-12' : 'bottom-9'"
            :data-placement="atTop ? 'top' : 'bottom'"
            :style="{ zIndex, height: `${layout.height}px` }"
            class="fixed right-4 w-[min(calc(100vw-2rem),22rem)]"
            data-testid="notice-stack"
        >
            <span
                v-if="hidden > 0"
                :style="atTop ? { top: `${layout.height + 4}px` } : { bottom: `${layout.height + 4}px` }"
                class="absolute right-1 text-[11px] text-on-surface-variant"
                data-testid="notice-more"
            >{{ $t("notices.more", { count: hidden }, hidden) }}</span>
            <div
                v-for="card in layout.cards"
                :key="card.notice.id"
                :class="[atTop ? 'top-0 origin-bottom' : 'bottom-0 origin-top', expanded ? '' : '[&>div]:h-full']"
                :style="card.style"
                class="absolute right-0 w-full transition-[transform,opacity] duration-200 ease-out"
            >
                <NoticeCard
                    @height="measured"
                    :notice="card.notice"
                    :paused="expanded"
                />
            </div>
        </section>
    </Portal>
</template>
