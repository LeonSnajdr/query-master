<script setup lang="ts">
import { PopoverActivator, PopoverContent, PopoverRoot } from "@vuetify/v0";
import { computed, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useNotices } from "@/composables/notices";
import type { Notice } from "@/composables/notices";
import NoticeActionButton from "./NoticeActionButton.vue";

/**
 * The right end of the status bar: the work that runs (a click shows its card again) and the
 * bell with the session's notices, the unread ones counted on it, red when an error is among them.
 * The open list takes the place of the cards (as VS Code): they go into it, with their buttons, and
 * what comes while it is open shows in it instead of as a card. Like the cards, the newest is at
 * the foot, next to the bell.
 */
const { locale, t } = useI18n();
const notices = useNotices();
const open = computed({
    get: () => notices.state.centerOpen,
    set: value => notices.setCenterOpen(value)
});
/** What was unread when the list opened, or came while it is open: shown in bold. */
const fresh = shallowRef(new Set<number>());

watch(open, (value) => {
    if (!value) return;
    fresh.value = new Set(notices.unread.value.map(notice => notice.id));
    notices.markAllRead();
});
watch(() => notices.history.value[0]?.id, (id) => {
    if (open.value && id !== undefined) fresh.value = new Set([...fresh.value, id]);
});

/** Oldest first, so the newest lies at the foot, where the cards had it. */
const entries = computed(() => [...notices.history.value].reverse());
const list = useTemplateRef("list");
// On opening and when one comes, the foot shows: the newest is in view.
watch([open, () => notices.history.value[0]?.id, list], () => {
    if (open.value && list.value) list.value.scrollTop = list.value.scrollHeight;
}, { flush: "post" });

const count = computed(() => notices.unread.value.length);
const alarming = computed(() => notices.unread.value.some(notice => notice.kind === "error" || notice.kind === "warning"));
const task = computed(() => notices.running.value[0]);
const share = computed(() => (task.value?.total ? Math.min(1, (task.value.done ?? 0) / task.value.total) : undefined));

const ICONS: Record<Notice["kind"], string> = {
    success: "i-lucide-circle-check text-success",
    info: "i-lucide-info text-primary",
    warning: "i-lucide-triangle-alert text-warning",
    error: "i-lucide-circle-x text-error",
    progress: "i-lucide-loader-circle text-primary"
};

function time(at: Date): string {
    return at.toLocaleTimeString(locale.value, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
</script>

<template>
    <button
        v-if="task"
        @click="notices.reopen(task.id)"
        :title="task.detail"
        class="min-w-0 max-w-64 flex items-center gap-2 px-1.5 h-5.5 rounded-sm hover:bg-on-surface/10"
        data-testid="status-task"
        type="button"
    >
        <span class="i-lucide-loader-circle size-3.5 shrink-0 animate-spin text-primary" />
        <span class="truncate">{{ task.title }}</span>
        <span
            v-if="share !== undefined"
            class="tabular-nums text-on-surface-variant"
        >{{ Math.round(share * 100) }} %</span>
        <span class="w-16 h-1 shrink-0 rounded-full bg-on-surface/15 overflow-hidden">
            <span
                :class="share === undefined ? 'w-1/3 animate-pulse' : ''"
                :style="share === undefined ? undefined : { width: `${share * 100}%` }"
                class="block h-full bg-primary"
            />
        </span>
    </button>
    <PopoverRoot v-model="open">
        <PopoverActivator
            :aria-label="count > 0 ? t('notices.bellUnread', { count }, count) : t('notices.bell')"
            :title="count > 0 ? t('notices.bellUnread', { count }, count) : t('notices.bell')"
            class="relative size-6 inline-flex items-center justify-center rounded-sm text-on-surface hover:bg-on-surface/10 data-[state=open]:bg-on-surface/10"
            data-testid="notice-bell"
        >
            <span class="i-lucide-bell size-4" />
            <span
                v-if="count > 0"
                :class="alarming ? 'bg-error text-on-error' : 'bg-primary text-on-primary'"
                class="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-1 rounded-full text-[9.5px] leading-3.5 text-center font-semibold"
                data-testid="notice-count"
            >{{ count > 99 ? "99+" : count }}</span>
        </PopoverActivator>
        <!-- In the cards' place: their width, and as far above the status bar (its foot 36px off the window's). -->
        <PopoverContent
            class="[margin:0_0_0.625rem]! p-0 w-[min(calc(100vw-2.25rem),22rem)] rounded-sm bg-dock text-on-surface border border-divider shadow-[0_6px_20px_rgb(0_0_0/0.4)]"
            positionArea="top span-left"
        >
            <div
                class="flex flex-col max-h-[min(70vh,28rem)] text-[13px]"
                data-testid="notice-center"
            >
                <header class="shrink-0 flex items-center gap-2 pl-3 pr-1.5 py-1.5 border-b border-divider">
                    <span class="grow font-semibold text-on-surface-strong">{{ $t("notices.title") }}</span>
                    <button
                        @click="notices.clear()"
                        :disabled="notices.history.value.length === 0"
                        class="px-2 h-6 rounded-sm text-on-surface-variant hover:text-on-surface-strong hover:bg-on-surface/10 disabled:opacity-40"
                        data-testid="notice-clear"
                        type="button"
                    >
                        {{ $t("notices.clear") }}
                    </button>
                </header>
                <p
                    v-if="notices.history.value.length === 0"
                    class="m-0 px-4 py-6 text-center text-on-surface-variant"
                >
                    {{ $t("notices.empty") }}
                </p>
                <ul
                    v-else
                    ref="list"
                    class="m-0 p-0 py-1 list-none overflow-y-auto"
                >
                    <li
                        v-for="notice in entries"
                        :key="notice.id"
                        class="group grid grid-cols-[1rem_1fr_auto_1.25rem] gap-x-2.5 gap-y-0.5 items-start pl-3 pr-1.5 py-1.5 hover:bg-on-surface/5"
                        data-testid="notice-entry"
                    >
                        <span
                            :class="ICONS[notice.kind]"
                            class="size-4 mt-px"
                        />
                        <span
                            :class="fresh.has(notice.id) ? 'font-semibold' : ''"
                            class="min-w-0 text-on-surface-strong break-words"
                        >{{ notice.title }}</span>
                        <span class="text-[11px] tabular-nums text-on-surface-variant mt-0.5">{{ time(notice.at) }}</span>
                        <button
                            @click="notices.forget(notice.id)"
                            :aria-label="$t('notices.forget')"
                            :title="$t('notices.forget')"
                            class="size-5 -mt-0.5 inline-flex items-center justify-center rounded-sm text-on-surface-variant opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-on-surface-strong hover:bg-on-surface/10"
                            data-testid="notice-forget"
                            type="button"
                        >
                            <span class="i-lucide-x size-3.5" />
                        </button>
                        <span
                            v-if="notice.detail"
                            class="col-start-2 col-span-3 text-[12px] text-on-surface-variant break-words"
                        >{{ notice.detail }}</span>
                        <div
                            v-if="notice.actions.length > 0"
                            class="col-start-2 col-span-3 flex flex-wrap gap-1.5 mt-1"
                        >
                            <NoticeActionButton
                                v-for="action in notice.actions"
                                :key="action.label"
                                :action
                                class="btn-secondary h-6! px-2.5! text-[12px]!"
                                data-testid="notice-entry-action"
                            />
                        </div>
                    </li>
                </ul>
            </div>
        </PopoverContent>
    </PopoverRoot>
</template>
