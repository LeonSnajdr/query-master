<script setup lang="ts">
import { computed } from "vue";
import { overall, rowShare } from "@/transfer/progress";
import type { RowProgress } from "@/transfer/progress";

/** The last page of the export and import wizards: the whole run, then each row with its own bar and count. */
const props = defineProps<{
    rows: { source: string; target: string }[];
    progress: RowProgress[];
    running: boolean;
    /** `export` or `import`: the test ids. */
    kind: string;
}>();

const STATE_ICONS: Record<RowProgress["state"], string> = {
    waiting: "i-lucide-circle-dashed text-on-surface-variant",
    running: "i-lucide-loader-circle animate-spin text-primary",
    done: "i-lucide-circle-check text-success",
    failed: "i-lucide-circle-x text-error",
    stopped: "i-lucide-circle-pause text-warning"
};

const whole = computed(() => overall(props.progress));
const percent = (share: number) => `${Math.floor(share * 100)} %`;
</script>

<template>
    <div class="grow min-h-0 flex flex-col px-6 pt-4 gap-2">
        <div class="flex items-baseline gap-3 text-on-surface-variant tabular-nums">
            <span
                :data-testid="`${kind}-progress-summary`"
                class="grow"
            >{{ $t("transfer.progress.summary", { finished: whole.finished, rows: rows.length, documents: whole.documents.toLocaleString() }, whole.documents) }}</span>
            <span>{{ percent(whole.share) }}</span>
        </div>
        <div class="h-1.5 rounded-full bg-on-surface/15 overflow-hidden">
            <div
                :class="running && whole.share === 0 && 'animate-pulse'"
                :style="{ width: `${Math.max(whole.share, running ? 0.02 : 0) * 100}%` }"
                class="h-full bg-primary transition-[width] duration-300"
            />
        </div>
        <div class="grow min-h-0 overflow-auto rounded-sm bg-background border border-divider mt-1">
            <table
                :data-testid="`${kind}-progress`"
                class="w-full border-collapse"
            >
                <tbody>
                    <tr
                        v-for="(row, index) in rows"
                        :key="index"
                        :data-state="progress[index]?.state"
                        :data-testid="`${kind}-progress-row`"
                        class="align-top"
                    >
                        <td class="w-8 pl-2.5 py-1.5 border-b border-divider">
                            <span
                                :class="STATE_ICONS[progress[index]?.state ?? 'waiting']"
                                class="size-4 block"
                            />
                        </td>
                        <td class="py-1.5 pr-3 border-b border-divider">
                            <span class="text-on-surface-strong">{{ row.source }}</span>
                            <span class="text-on-surface-variant"> → {{ row.target }}</span>
                            <!-- A bar only while the row is at work and its end is known. -->
                            <div
                                v-if="progress[index]?.state === 'running' && progress[index]?.share !== undefined"
                                class="mt-1 h-1 rounded-full bg-on-surface/10 overflow-hidden"
                            >
                                <div
                                    :style="{ width: `${rowShare(progress[index]!) * 100}%` }"
                                    class="h-full bg-primary/70 transition-[width] duration-300"
                                />
                            </div>
                            <span
                                v-if="progress[index]?.error"
                                class="block text-error break-words"
                            >{{ progress[index]?.error }}</span>
                        </td>
                        <td
                            :data-testid="`${kind}-progress-count`"
                            class="w-56 py-1.5 pr-3 border-b border-divider text-right tabular-nums text-on-surface-variant whitespace-nowrap"
                        >
                            <template v-if="progress[index]?.total !== undefined && progress[index]?.state === 'running'">
                                {{ $t("task.countOf", { done: progress[index]!.done.toLocaleString(), total: progress[index]!.total!.toLocaleString() }) }}
                            </template>
                            <template v-else>
                                {{ $t("task.count", { done: (progress[index]?.done ?? 0).toLocaleString() }, progress[index]?.done ?? 0) }}
                            </template>
                            <span
                                v-if="progress[index]?.state === 'running' && progress[index]?.share !== undefined"
                                class="inline-block w-12"
                            >{{ percent(progress[index]!.share!) }}</span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
