<script setup lang="ts">
import { computed } from "vue";
import { overall, rowShare } from "@/transfer/progress";
import type { RowProgress } from "@/transfer/progress";

/**
 * The last page of the export and import wizards: the whole run, then a table of the rows. Every
 * row keeps its height from start to end: the symbol in front is its progress (a ring that
 * closes), the number at the right what is done. A failure's message stands next to the buttons
 * (`TransferFailure`); clicking a failed row shows its own.
 */
const props = defineProps<{
    rows: { source: string; target: string }[];
    /** The heads of the source and target columns. */
    heads: [string, string];
    progress: RowProgress[];
    running: boolean;
    /** `export` or `import`: the test ids. */
    kind: string;
}>();
const selected = defineModel<number>("selected");

const STATE_ICONS: Record<Exclude<RowProgress["state"], "running">, string> = {
    waiting: "i-lucide-circle-dashed text-on-surface-variant",
    done: "i-lucide-circle-check text-success",
    failed: "i-lucide-circle-x text-error",
    stopped: "i-lucide-circle-pause text-warning"
};

/** The ring: radius and length of its circle in a box of 16. */
const RADIUS = 6.5;
const LENGTH = 2 * Math.PI * RADIUS;

const whole = computed(() => overall(props.progress));
const percent = (share: number) => `${Math.floor(share * 100)} %`;

function count(row: RowProgress | undefined): string {
    if (!row || row.state === "waiting") return "";
    if (row.state === "running" && row.total !== undefined) return `${row.done.toLocaleString()} / ${row.total.toLocaleString()}`;
    return row.done.toLocaleString();
}

function choose(index: number) {
    if (props.progress[index]?.state === "failed") selected.value = index;
}
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
        <div class="h-1.5 shrink-0 rounded-full bg-on-surface/15 overflow-hidden">
            <div
                :class="running && whole.share === 0 && 'animate-pulse'"
                :style="{ width: `${Math.max(whole.share, running ? 0.02 : 0) * 100}%` }"
                class="h-full bg-primary transition-[width] duration-300"
            />
        </div>
        <div class="grow min-h-0 overflow-auto rounded-sm bg-background border border-divider mt-1">
            <table
                :data-testid="`${kind}-progress`"
                class="w-full border-collapse table-fixed"
            >
                <thead class="sticky top-0 bg-background text-xs text-on-surface-variant">
                    <tr class="h-7">
                        <th class="w-8 border-b border-divider" />
                        <th class="text-left font-normal pr-3 border-b border-divider">
                            {{ heads[0] }}
                        </th>
                        <th class="text-left font-normal pr-3 border-b border-divider">
                            {{ heads[1] }}
                        </th>
                        <th class="w-40 text-right font-normal pr-3 border-b border-divider">
                            {{ $t("transfer.progress.documents") }}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="(row, index) in rows"
                        :key="index"
                        @click="choose(index)"
                        :class="[progress[index]?.state === 'failed' && 'cursor-pointer', selected === index && 'bg-error/8']"
                        :data-state="progress[index]?.state"
                        :data-testid="`${kind}-progress-row`"
                        :title="progress[index]?.error"
                        class="h-[31px]"
                    >
                        <td class="pl-2.5 border-b border-divider">
                            <!-- At work: a ring that closes; without a known end a piece of it turns. -->
                            <svg
                                v-if="progress[index]?.state === 'running'"
                                :class="progress[index]?.share === undefined && 'animate-spin'"
                                class="size-4 block"
                                viewBox="0 0 16 16"
                            >
                                <circle
                                    :r="RADIUS"
                                    class="fill-none stroke-on-surface/15"
                                    cx="8"
                                    cy="8"
                                    stroke-width="2.2"
                                />
                                <circle
                                    :r="RADIUS"
                                    :stroke-dasharray="progress[index]?.share === undefined ? `${LENGTH / 4} ${LENGTH}` : LENGTH"
                                    :stroke-dashoffset="progress[index]?.share === undefined ? 0 : LENGTH * (1 - rowShare(progress[index]!))"
                                    class="fill-none stroke-primary -rotate-90 origin-center transition-[stroke-dashoffset] duration-300"
                                    cx="8"
                                    cy="8"
                                    stroke-linecap="round"
                                    stroke-width="2.2"
                                />
                            </svg>
                            <span
                                v-else
                                :class="STATE_ICONS[progress[index]?.state ?? 'waiting']"
                                class="size-4 block"
                            />
                        </td>
                        <td class="pr-3 border-b border-divider truncate text-on-surface-strong">
                            {{ row.source }}
                        </td>
                        <td class="pr-3 border-b border-divider truncate text-on-surface-variant">
                            {{ row.target }}
                        </td>
                        <td
                            :data-testid="`${kind}-progress-count`"
                            class="pr-3 border-b border-divider text-right tabular-nums text-on-surface-variant whitespace-nowrap"
                        >
                            {{ count(progress[index]) }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
