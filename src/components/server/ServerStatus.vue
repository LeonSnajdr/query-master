<script setup lang="ts">
import { ButtonContent, ButtonRoot, useTimer } from "@vuetify/v0";
import { computed, onMounted, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import ErrorState from "@/components/ErrorState.vue";
import IconButton from "@/components/IconButton.vue";
import { useDialogs } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";
import { preview } from "@/shell/ejson";
import { ShellError } from "@/shell/message";
import type { Doc } from "@/shell/ejson";
import { formatUptime, OPERATIONS, runningOperation, summarize } from "@/shell/server";
import type { RunningOperation, StatusSample } from "@/shell/server";
import { useTabsStore } from "@/stores/tabs";
import type { WorkTab } from "@/stores/tabs";

/** Figures of `serverStatus`, refreshed every few seconds, and the operations running now. */
const props = defineProps<{
    tab: WorkTab;
}>();

const REFRESH_MS = 3000;

const { t, n } = useI18n();
const { say, report } = useMessages();
const dialogs = useDialogs();
const tabs = useTabsStore();

const sample = shallowRef<StatusSample>();
const previous = shallowRef<StatusSample>();
const operations = shallowRef<RunningOperation[]>([]);
const error = shallowRef<string>();
const loading = shallowRef(false);

const summary = computed(() => (sample.value ? summarize(sample.value, previous.value) : undefined));
const timer = useTimer(() => void load(), { duration: REFRESH_MS, repeat: true });

async function load() {
    if (loading.value) return;
    loading.value = true;
    try {
        const at = Date.now();
        const reply = await backend.runCommand(props.tab.connectionId, "admin", { serverStatus: 1 });
        previous.value = sample.value;
        sample.value = { reply, at };
        // Idle connections are left out: they are not work the server does.
        const page = await backend.runCursorCommand(props.tab.connectionId, "admin", {
            aggregate: 1,
            pipeline: [{ $currentOp: { allUsers: true, idleConnections: false } }, { $match: { active: true } }],
            cursor: {}
        }, 500);
        operations.value = page.documents.map(runningOperation);
        error.value = undefined;
    } catch (cause) {
        error.value = say(errorMessage(cause));
    } finally {
        loading.value = false;
    }
}

function toggle() {
    if (timer.isPaused.value) {
        timer.resume();
        void load();
    } else {
        timer.pause();
    }
}

async function kill(operation: RunningOperation) {
    if (tabs.locked(props.tab)) {
        report(new ShellError("error.plan.readonly"));
        return;
    }
    const confirmed = await dialogs.confirm({
        title: t("server.kill.title"),
        text: t("server.kill.text", { op: operation.op, namespace: operation.namespace || "-", opid: preview(operation.opid) }),
        action: t("server.kill")
    });
    if (!confirmed) return;
    try {
        await backend.runCommand(props.tab.connectionId, "admin", { killOp: 1, op: operation.opid } as Doc);
        await load();
    } catch (cause) {
        report(cause);
    }
}

const bytes = (value: number) => n(value / 1024, { maximumFractionDigits: 1 });
const rate = (value: number | undefined) => (value === undefined ? "–" : n(value, { maximumFractionDigits: 1 }));

onMounted(() => {
    void load();
    timer.start();
});
</script>

<template>
    <div class="h-full flex flex-col min-h-0">
        <div class="h-8 shrink-0 flex items-center gap-0.5 px-5">
            <IconButton
                @click="toggle"
                :icon="timer.isPaused.value ? 'i-lucide-play' : 'i-lucide-pause'"
                :label="$t(timer.isPaused.value ? 'server.resume' : 'server.pause')"
                data-testid="status-toggle"
            >
                {{ $t(timer.isPaused.value ? "server.resume" : "server.pause") }}
            </IconButton>
            <IconButton
                @click="load"
                :disabled="loading"
                :label="$t('action.refresh')"
                icon="i-lucide-refresh-cw"
            />
            <span class="grow" />
            <span
                v-if="summary"
                class="text-on-surface-variant"
            >{{ summary.process }} {{ summary.version }} · {{ summary.host }}</span>
        </div>

        <!-- Not read: said in place of the content, never above it. -->
        <ErrorState
            v-if="error"
            :detail="error"
            :title="$t('page.loadFailed')"
            class="grow"
            data-testid="status-error"
        >
            <ButtonRoot
                @click="load"
                class="btn-primary h-7! text-[12px]"
            >
                <ButtonContent>{{ $t("action.reload") }}</ButtonContent>
            </ButtonRoot>
        </ErrorState>

        <div
            v-else-if="summary"
            class="grow min-h-0 overflow-auto px-5 pb-4 flex flex-col gap-5"
            data-testid="server-status"
        >
            <section class="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
                <div class="stat-card">
                    <span class="stat-label">{{ $t("server.uptime") }}</span>
                    <span class="stat-value">{{ formatUptime(summary.uptimeSeconds) }}</span>
                </div>
                <div class="stat-card">
                    <span class="stat-label">{{ $t("server.connections") }}</span>
                    <span
                        class="stat-value"
                        data-testid="status-connections"
                    >{{ n(summary.connections.current) }}</span>
                    <span class="stat-note">{{ $t("server.connections.available", { available: n(summary.connections.available) }) }}</span>
                </div>
                <div class="stat-card">
                    <span class="stat-label">{{ $t("server.memory") }}</span>
                    <span class="stat-value">{{ $t("server.megabytes", { value: n(summary.memory.resident) }) }}</span>
                    <span class="stat-note">{{ $t("server.memory.virtual", { value: n(summary.memory.virtual) }) }}</span>
                </div>
                <div class="stat-card">
                    <span class="stat-label">{{ $t("server.network") }}</span>
                    <span class="stat-value">{{ summary.rates ? $t("server.kilobytesPerSecond", { value: bytes(summary.rates.bytesIn) }) : "–" }}</span>
                    <span class="stat-note">{{ summary.rates ? $t("server.network.out", { value: bytes(summary.rates.bytesOut) }) : "" }}</span>
                </div>
                <div
                    v-if="summary.replication"
                    class="stat-card"
                >
                    <span class="stat-label">{{ $t("server.replication") }}</span>
                    <span class="stat-value">{{ summary.replication.setName }}</span>
                    <span class="stat-note">{{ $t(summary.replication.primary ? "server.primary" : "server.secondary") }}</span>
                </div>
            </section>

            <section>
                <h2 class="m-0 mb-1.5 text-[13px] font-semibold text-on-surface-strong">
                    {{ $t("server.operations") }}
                </h2>
                <table class="w-full max-w-160 border-collapse text-[12.5px] tabular-nums">
                    <thead>
                        <tr class="text-on-surface-variant">
                            <th class="text-left font-normal py-0.5" />
                            <th class="text-right font-normal py-0.5 px-2">
                                {{ $t("server.perSecond") }}
                            </th>
                            <th class="text-right font-normal py-0.5 px-2">
                                {{ $t("server.total") }}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="name in OPERATIONS"
                            :key="name"
                            class="border-t border-divider"
                        >
                            <td class="py-0.5">
                                {{ name }}
                            </td>
                            <td class="text-right px-2">
                                {{ rate(summary.rates?.[name]) }}
                            </td>
                            <td class="text-right px-2">
                                {{ n(summary.totals[name]) }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </section>

            <section>
                <h2 class="m-0 mb-1.5 text-[13px] font-semibold text-on-surface-strong">
                    {{ $t("server.running", { count: operations.length }) }}
                </h2>
                <table
                    class="w-full border-collapse text-[12.5px]"
                    data-testid="running-operations"
                >
                    <thead>
                        <tr class="text-on-surface-variant text-left">
                            <th class="font-normal py-0.5 pr-2">
                                opid
                            </th>
                            <th class="font-normal pr-2">
                                {{ $t("server.op") }}
                            </th>
                            <th class="font-normal pr-2">
                                {{ $t("server.namespace") }}
                            </th>
                            <th class="font-normal pr-2 text-right">
                                {{ $t("server.seconds") }}
                            </th>
                            <th class="font-normal pr-2">
                                {{ $t("server.client") }}
                            </th>
                            <th class="font-normal pr-2">
                                {{ $t("server.command") }}
                            </th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="operation in operations"
                            :key="JSON.stringify(operation.opid)"
                            class="border-t border-divider align-top"
                        >
                            <td class="py-0.5 pr-2 font-mono tabular-nums">
                                {{ preview(operation.opid) }}
                            </td>
                            <td class="pr-2">
                                {{ operation.op }}
                            </td>
                            <td class="pr-2">
                                {{ operation.namespace }}
                            </td>
                            <td class="pr-2 text-right tabular-nums">
                                {{ n(operation.seconds) }}
                            </td>
                            <td class="pr-2">
                                {{ operation.client || operation.description }}
                            </td>
                            <td
                                :title="operation.command"
                                class="pr-2 font-mono max-w-96 truncate"
                            >
                                {{ operation.command }}
                            </td>
                            <td>
                                <IconButton
                                    @click="kill(operation)"
                                    :disabled="tabs.locked(tab)"
                                    :label="$t('server.kill')"
                                    icon="i-lucide-octagon-x"
                                    tint="text-error"
                                />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </section>
        </div>
    </div>
</template>
