<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import ChoiceField from "@/components/ChoiceField.vue";
import CodeEditor from "@/components/CodeEditor.vue";
import { useDialogs } from "@/composables/dialogs";
import { toShell } from "@/shell/ejson";
import { NODE_HEIGHT, NODE_WIDTH, layoutPlan, strokeFor } from "@/shell/explain";
import type { PlanHint, PlanNode } from "@/shell/explain";
import { useConnectionsStore } from "@/stores/connections";
import { useTabsStore } from "@/stores/tabs";

/**
 * The plan of a query as a flow (stage 19): source → stages → result. Line width is the number of
 * documents, the bar in a stage its share of the time; numbers on hints mark their stage, the
 * sentence and its action stand once below. Colors only on icons and short text, never on areas.
 */
const props = defineProps<{
    tabId: string;
}>();

const { t, locale } = useI18n();
const dialogs = useDialogs();
const tabs = useTabsStore();
const connections = useConnectionsStore();

const tab = computed(() => tabs.tabs.find(item => item.id === props.tabId)!);
const explain = computed(() => tab.value.explain);
const plan = computed(() => explain.value?.plan);
const selected = shallowRef<string>();

const host = useTemplateRef<HTMLElement>("host");
const width = shallowRef(900);
let observer: ResizeObserver | undefined;
onMounted(() => {
    observer = new ResizeObserver(() => (width.value = Math.max(300, (host.value?.clientWidth ?? 900) - 32 - PAD)));
    if (host.value) observer.observe(host.value);
});
onBeforeUnmount(() => observer?.disconnect());

const format = (n: number) => n.toLocaleString(locale.value);
/** Room on the left for the arrow that leads into a new row. */
const PAD = 30;

/** A box of the flow: the source, a stage, or the result. */
interface Box {
    id: string;
    kind: "source" | "stage" | "result";
    title: string;
    sub: string;
    ms?: number;
    node?: PlanNode;
    /** Documents that leave the box towards the next. */
    out?: number;
}

const boxes = computed<Box[]>(() => {
    const current = plan.value;
    if (!current) return [];
    const first = current.stages[0];
    const sourceCount = first?.keysExamined ?? first?.docsExamined ?? first?.returned;
    const source: Box = {
        id: "source",
        kind: "source",
        title: current.source.name || "?",
        sub: current.source.kind === "index" ? t("explain.source.index", { count: format(sourceCount ?? 0) }) : t("explain.source.collection"),
        out: sourceCount
    };
    const stages = current.stages.map((node): Box => ({
        id: node.id,
        kind: "stage",
        title: node.stage,
        sub: node.detail ?? (node.docsExamined !== undefined && node.stage !== "COLLSCAN" ? t("explain.examined", { count: format(node.docsExamined) }) : ""),
        ms: node.ms,
        node,
        out: node.returned
    }));
    const result: Box = { id: "result", kind: "result", title: t("explain.result"), sub: t("explain.documents", { count: format(current.returned) }) };
    return [source, ...stages, result];
});

const placed = computed(() => {
    const layout = layoutPlan(boxes.value.map(box => box.id), width.value);
    return new Map(layout.map(item => [item.id, item]));
});
const maxDocuments = computed(() => Math.max(1, ...boxes.value.map(box => box.out ?? 0), ...(plan.value?.stages.flatMap(node => node.side ?? []).map(node => node.docsExamined ?? 0) ?? [])));
const totalMs = computed(() => Math.max(1, plan.value?.stages.reduce((total, node) => total + (node.ms ?? 0), 0) ?? 1));
const rows = computed(() => Math.max(...[...placed.value.values()].map(item => item.row)) + 1);
const hasSide = computed(() => plan.value?.stages.some(node => node.side?.length) ?? false);
const svgHeight = computed(() => rows.value * 200 - (hasSide.value ? 0 : 90));
const svgWidth = computed(() => Math.max(...[...placed.value.values()].map(item => item.x)) + NODE_WIDTH + 12 + PAD);

/** The hint numbers of each stage, as marked on it. */
const marks = computed(() => {
    const result = new Map<string, number[]>();
    (plan.value?.hints ?? []).forEach((hint, index) => {
        if (!hint.node) return;
        result.set(hint.node, [...(result.get(hint.node) ?? []), index + 1]);
    });
    return result;
});

/** The arrow between two boxes; across rows it bends down and back to the left. */
function edgePath(from: Box, to: Box): string {
    const a = placed.value.get(from.id)!;
    const b = placed.value.get(to.id)!;
    const y = a.y + NODE_HEIGHT / 2 + 20;
    if (a.row === b.row) return `M${a.x + NODE_WIDTH} ${y} H${b.x - 8}`;
    const down = a.y + NODE_HEIGHT + 20 + 44;
    return `M${a.x + NODE_WIDTH / 2} ${a.y + NODE_HEIGHT + 20} V${down} H${b.x - 26} V${b.y + NODE_HEIGHT / 2 + 20} H${b.x - 8}`;
}

function arrowHead(to: Box): string {
    const b = placed.value.get(to.id)!;
    const y = b.y + NODE_HEIGHT / 2 + 20;
    return `M${b.x - 9} ${y - 6} L${b.x - 1} ${y} L${b.x - 9} ${y + 6}Z`;
}

function labelPosition(from: Box, to: Box): { x: number; y: number } {
    const a = placed.value.get(from.id)!;
    const b = placed.value.get(to.id)!;
    if (a.row === b.row) return { x: (a.x + NODE_WIDTH + b.x) / 2, y: a.y + NODE_HEIGHT / 2 + 20 - strokeFor(from.out ?? 0, maxDocuments.value) / 2 - 6 };
    return { x: a.x + NODE_WIDTH / 2 + 10, y: a.y + NODE_HEIGHT + 20 + 34 };
}

const details = computed(() => {
    const node = plan.value?.stages.flatMap(item => [item, ...(item.side ?? [])]).find(item => item.id === selected.value);
    return node ? toShell(node.raw) : undefined;
});

/** The indexes of the collection, to force one; "automatic" lets the server choose. */
const collection = computed(() => tab.value.plan?.command.find ?? tab.value.plan?.command.aggregate ?? tab.value.collection);
const indexOptions = computed(() => {
    const name = typeof collection.value === "string" ? collection.value : undefined;
    const database = connections.sessions[tab.value.connectionId]?.databases.find(item => item.name === (tab.value.plan?.database ?? tab.value.database));
    const indexes = name ? database?.details[name]?.indexes ?? [] : [];
    return [{ value: "", label: t("explain.index.auto") }, ...indexes.map(index => ({ value: String(index.name), label: String(index.name) }))];
});
watch(collection, (name) => {
    if (typeof name === "string") void connections.loadIndexes(tab.value.connectionId, tab.value.plan?.database ?? tab.value.database, name).catch(() => undefined);
}, { immediate: true });
const forced = computed({
    get: () => explain.value?.hint ?? "",
    set: (name: string) => void tabs.explainResult(tab.value, name || null)
});

/** The numbers of a hint as the language writes them. */
function paramsOf(hint: PlanHint): Record<string, string | number> {
    return Object.fromEntries(Object.entries(hint.params).map(([key, value]) => [key, typeof value === "number" ? format(value) : value]));
}

function createIndex(hint: PlanHint) {
    if (!hint.index) return;
    dialogs.editIndex({ connectionId: tab.value.connectionId, database: tab.value.plan?.database ?? tab.value.database, collection: hint.index.collection, index: { key: hint.index.keys } });
}

function nodeTip(box: Box): string | undefined {
    if (box.ms === undefined) return undefined;
    return t("explain.nodeTip", { stage: box.title, ms: format(box.ms), share: Math.round((box.ms / totalMs.value) * 100) });
}
</script>

<template>
    <div
        ref="host"
        class="px-4 py-3 font-sans text-[13px]"
        data-testid="plan-view"
    >
        <p
            v-if="!plan"
            class="m-0 text-on-surface-variant"
        >
            {{ tab.running ? $t("explain.loading") : $t("explain.none") }}
        </p>
        <template v-else>
            <!-- What one reads first: examined, returned, time; the index choice on the right. -->
            <div class="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3">
                <span data-testid="plan-examined"><b class="text-on-surface-strong">{{ format(plan.examined) }}</b> {{ $t("explain.examinedShort") }}</span>
                <span data-testid="plan-returned"><b class="text-on-surface-strong">{{ format(plan.returned) }}</b> {{ $t("explain.returnedShort") }}</span>
                <span data-testid="plan-ms">
                    <b class="text-on-surface-strong">{{ format(plan.ms) }} ms</b>
                    <span
                        v-if="explain?.previousMs !== undefined"
                        class="text-on-surface-variant"
                    > ({{ $t("explain.before", { ms: format(explain.previousMs) }) }})</span>
                </span>
                <span class="grow" />
                <span class="text-on-surface-variant">{{ $t("explain.index") }}</span>
                <ChoiceField
                    v-model="forced"
                    :label="$t('explain.index')"
                    :options="indexOptions"
                    class="w-64"
                    data-testid="plan-index"
                    size="compact"
                />
            </div>

            <div class="overflow-x-auto">
                <svg
                    :aria-label="$t('explain.title')"
                    :height="svgHeight"
                    :viewBox="`0 0 ${svgWidth} ${svgHeight}`"
                    :width="svgWidth"
                    class="block"
                    role="img"
                >
                    <g :transform="`translate(${PAD} 0)`">
                        <!-- Arrows first, under the boxes; width = documents. -->
                        <g
                            v-for="(box, index) in boxes.slice(0, -1)"
                            :key="`edge-${box.id}`"
                            class="text-on-surface-variant"
                        >
                            <title>{{ $t("explain.documents", { count: format(box.out ?? 0) }) }}</title>
                            <path
                                :d="edgePath(box, boxes[index + 1]!)"
                                :stroke-width="strokeFor(box.out ?? 0, maxDocuments)"
                                class="stroke-current"
                                fill="none"
                                opacity="0.45"
                            />
                            <path
                                :d="arrowHead(boxes[index + 1]!)"
                                class="fill-current"
                            />
                            <text
                                :x="labelPosition(box, boxes[index + 1]!).x"
                                :y="labelPosition(box, boxes[index + 1]!).y"
                                class="fill-current text-[11px]"
                                text-anchor="middle"
                            >{{ box.out === undefined ? "" : format(box.out) }}</text>
                        </g>
                        <!-- Side sources ($lookup, other shards) below their stage, an arrow up into it. -->
                        <template
                            v-for="box in boxes"
                            :key="`side-${box.id}`"
                        >
                            <g
                                v-for="(side, number) in box.node?.side ?? []"
                                :key="side.id"
                                @click="selected = side.id"
                                class="cursor-pointer"
                                data-testid="plan-side"
                            >
                                <path
                                    :d="`M${placed.get(box.id)!.x + NODE_WIDTH / 2 + number * 10} ${placed.get(box.id)!.y + NODE_HEIGHT + 20 + 104} V${placed.get(box.id)!.y + NODE_HEIGHT + 20 + 8}`"
                                    :stroke-width="strokeFor(side.docsExamined ?? 0, maxDocuments)"
                                    class="stroke-current text-on-surface-variant"
                                    fill="none"
                                    opacity="0.45"
                                />
                                <text
                                    :x="placed.get(box.id)!.x + NODE_WIDTH / 2 + 16"
                                    :y="placed.get(box.id)!.y + NODE_HEIGHT + 20 + 60"
                                    class="fill-current text-on-surface-variant text-[11px]"
                                >{{ side.docsExamined === undefined ? "" : $t("explain.read", { count: format(side.docsExamined) }) }}</text>
                                <rect
                                    :class="selected === side.id ? 'text-primary' : 'text-divider'"
                                    :width="NODE_WIDTH"
                                    :x="placed.get(box.id)!.x"
                                    :y="placed.get(box.id)!.y + NODE_HEIGHT + 20 + 104"
                                    class="stroke-current fill-transparent"
                                    height="52"
                                    rx="4"
                                    stroke-dasharray="4 3"
                                />
                                <text
                                    :x="placed.get(box.id)!.x + 10"
                                    :y="placed.get(box.id)!.y + NODE_HEIGHT + 20 + 126"
                                    class="fill-current text-on-surface-strong font-mono font-semibold text-[12px]"
                                >{{ side.stage }}</text>
                                <text
                                    :x="placed.get(box.id)!.x + 10"
                                    :y="placed.get(box.id)!.y + NODE_HEIGHT + 20 + 144"
                                    class="fill-current text-on-surface-variant text-[11px]"
                                >{{ side.detail ?? "" }}</text>
                            </g>
                        </template>
                        <g
                            v-for="box in boxes"
                            :key="box.id"
                            @click="box.node && (selected = box.id)"
                            :class="box.node ? 'cursor-pointer' : ''"
                            :data-node="box.id"
                            data-testid="plan-node"
                        >
                            <title v-if="nodeTip(box)">{{ nodeTip(box) }}</title>
                            <rect
                                :class="[selected === box.id ? 'text-primary' : 'text-divider', box.kind === 'result' ? 'fill-success/8' : 'fill-dock']"
                                :height="NODE_HEIGHT"
                                :stroke-dasharray="box.kind === 'source' ? '4 3' : undefined"
                                :width="NODE_WIDTH"
                                :x="placed.get(box.id)!.x"
                                :y="placed.get(box.id)!.y + 20"
                                class="stroke-current"
                                rx="4"
                            />
                            <text
                                :x="placed.get(box.id)!.x + 10"
                                :y="placed.get(box.id)!.y + 20 + 23"
                                class="fill-current text-on-surface-strong font-mono font-semibold text-[12.5px]"
                            >{{ box.title.length > 19 ? `${box.title.slice(0, 18)}…` : box.title }}</text>
                            <text
                                :x="placed.get(box.id)!.x + 10"
                                :y="placed.get(box.id)!.y + 20 + (box.ms === undefined ? 48 : 42)"
                                class="fill-current text-on-surface-variant text-[11px]"
                            >{{ box.sub.length > 24 ? `${box.sub.slice(0, 23)}…` : box.sub }}</text>
                            <template v-if="box.ms !== undefined">
                                <text
                                    :x="placed.get(box.id)!.x + 10"
                                    :y="placed.get(box.id)!.y + 20 + 62"
                                    class="fill-current text-on-surface text-[11px]"
                                >{{ format(box.ms) }} ms · {{ Math.round((box.ms / totalMs) * 100) }} %</text>
                                <rect
                                    :width="NODE_WIDTH - 20"
                                    :x="placed.get(box.id)!.x + 10"
                                    :y="placed.get(box.id)!.y + 20 + 69"
                                    class="fill-current text-on-surface/12"
                                    height="6"
                                    rx="3"
                                />
                                <rect
                                    :width="Math.max(4, (NODE_WIDTH - 20) * (box.ms / totalMs))"
                                    :x="placed.get(box.id)!.x + 10"
                                    :y="placed.get(box.id)!.y + 20 + 69"
                                    class="fill-current text-primary/70"
                                    height="6"
                                    rx="3"
                                />
                            </template>
                            <!-- The numbers of the hints about this stage, in the warning color; the sentence is below. -->
                            <g
                                v-for="(mark, number) in marks.get(box.id) ?? []"
                                :key="mark"
                                class="text-warning"
                                data-testid="plan-mark"
                            >
                                <circle
                                    :cx="placed.get(box.id)!.x + NODE_WIDTH - 14 - number * 20"
                                    :cy="placed.get(box.id)!.y + 20 + 16"
                                    class="fill-current"
                                    r="8"
                                />
                                <text
                                    :x="placed.get(box.id)!.x + NODE_WIDTH - 14 - number * 20"
                                    :y="placed.get(box.id)!.y + 20 + 20"
                                    class="fill-[var(--background,#000)] text-[11px] font-bold"
                                    text-anchor="middle"
                                >{{ mark }}</text>
                            </g>
                        </g>
                    </g>
                </svg>
            </div>

            <!-- Where the time goes: one bar for the run, a part per stage. -->
            <div
                class="mt-2 max-w-[60rem]"
                data-testid="plan-time"
            >
                <div class="flex justify-between text-[11.5px] text-on-surface-variant">
                    <span>{{ $t("explain.timeline") }}</span>
                    <span>{{ format(plan.ms) }} ms</span>
                </div>
                <div class="mt-1 h-2 flex gap-0.5">
                    <span
                        v-for="node in plan.stages.filter(item => item.ms !== undefined)"
                        :key="node.id"
                        :class="selected === node.id ? 'bg-primary' : 'bg-primary/45'"
                        :style="{ flex: Math.max((node.ms ?? 0) / totalMs, 0.012) }"
                        :title="`${node.stage} · ${format(node.ms ?? 0)} ms`"
                        class="rounded-[3px]"
                    />
                </div>
            </div>

            <!-- One line per hint, numbered like its mark; the action once, here. -->
            <ul
                v-if="plan.hints.length > 0"
                class="m-0 mt-3 p-0 list-none flex flex-col gap-1.5"
                data-testid="plan-hints"
            >
                <li
                    v-for="(hint, index) in plan.hints"
                    :key="index"
                    class="flex items-center gap-2"
                    data-testid="plan-hint"
                >
                    <span class="size-4 shrink-0 rounded-full bg-warning text-background text-[11px] font-bold inline-flex items-center justify-center">{{ index + 1 }}</span>
                    <span class="text-on-surface-strong">{{ $t(hint.key, paramsOf(hint)) }}</span>
                    <ButtonRoot
                        v-if="hint.index"
                        @click="createIndex(hint)"
                        class="text-primary hover:underline"
                        data-testid="plan-create-index"
                    >
                        <ButtonContent>{{ $t("explain.createIndex") }}</ButtonContent>
                    </ButtonRoot>
                </li>
            </ul>

            <div
                v-if="details"
                class="mt-3"
            >
                <div class="mb-1 text-[11.5px] text-on-surface-variant">
                    {{ $t("explain.details") }}
                </div>
                <div class="h-56 border border-divider rounded-sm">
                    <CodeEditor
                        :key="selected"
                        :label="$t('explain.details')"
                        :modelValue="details"
                        readonly
                    />
                </div>
            </div>
            <p
                v-else
                class="m-0 mt-3 text-[11.5px] text-on-surface-variant"
            >
                {{ $t("explain.clickHint") }}
            </p>
        </template>
    </div>
</template>
