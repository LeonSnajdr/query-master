<script setup lang="ts">
import { PopoverActivator, PopoverContent, PopoverRoot } from "@vuetify/v0";
import { computed, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useNotices } from "@/composables/notices";
import type { Notice } from "@/composables/notices";

/**
 * The right end of the status bar: the work that runs (a click shows its card again) and the
 * bell with the session's notices, the unread ones counted on it, red when an error is among them.
 */
const { locale, t } = useI18n();
const notices = useNotices();
const open = shallowRef(false);
/** What was unread when the list opened: shown in bold this once. */
const fresh = shallowRef(new Set<number>());

watch(open, (value) => {
    if (!value) return;
    fresh.value = new Set(notices.unread.value.map(notice => notice.id));
    notices.markAllRead();
});

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
        <PopoverContent
            class="menu-panel p-0 w-[min(calc(100vw-2rem),24rem)]"
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
                    class="m-0 p-0 py-1 list-none overflow-y-auto"
                >
                    <li
                        v-for="notice in notices.history.value"
                        :key="notice.id"
                        class="grid grid-cols-[1rem_1fr_auto] gap-x-2.5 gap-y-0.5 items-start px-3 py-1.5 hover:bg-on-surface/5"
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
                        <span
                            v-if="notice.detail"
                            class="col-start-2 col-span-2 text-[12px] text-on-surface-variant break-words"
                        >{{ notice.detail }}</span>
                    </li>
                </ul>
            </div>
        </PopoverContent>
    </PopoverRoot>
</template>
