<script setup lang="ts">
import { computed, onMounted, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import IconButton from "@/components/IconButton.vue";
import ChoiceField from "@/components/ChoiceField.vue";
import { useMessages } from "@/composables/messages";
import { keepLine, parseLogLine } from "@/shell/server";
import type { LogLine, SeverityFilter } from "@/shell/server";
import type { WorkTab } from "@/stores/tabs";

/** The recent lines of the server's log (`getLog: "global"`, the last 1024), newest first. */
const props = defineProps<{
    tab: WorkTab;
}>();

const SEVERITIES: SeverityFilter[] = ["all", "warning", "error"];

const { t } = useI18n();
const { say } = useMessages();

const lines = shallowRef<LogLine[]>([]);
const total = shallowRef(0);
const severity = shallowRef<SeverityFilter>("all");
const search = shallowRef("");
const loading = shallowRef(false);
const error = shallowRef<string>();

const shown = computed(() => lines.value.filter(line => keepLine(line, severity.value, search.value)));
const severityOptions = computed(() => SEVERITIES.map(value => ({ value, label: t(`log.severity.${value}`) })));
const structured = computed(() => lines.value.some(line => line.severity !== ""));

async function load() {
    loading.value = true;
    try {
        const reply = await backend.runCommand(props.tab.connectionId, "admin", { getLog: "global" });
        const raw = Array.isArray(reply.log) ? reply.log.filter((line): line is string => typeof line === "string") : [];
        lines.value = raw.map(parseLogLine).reverse();
        total.value = Number(reply.totalLinesWritten ?? raw.length) || raw.length;
        error.value = undefined;
    } catch (cause) {
        error.value = say(errorMessage(cause));
    } finally {
        loading.value = false;
    }
}

/** Local time with milliseconds; the server writes UTC with an offset. */
function time(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

const SEVERITY_CLASSES: Record<string, string> = { F: "text-error font-semibold", E: "text-error", W: "text-warning" };

onMounted(load);
</script>

<template>
    <div class="h-full flex flex-col min-h-0">
        <div class="h-9 shrink-0 flex items-center gap-2 px-5">
            <IconButton
                @click="load"
                :disabled="loading"
                :icon="loading ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-refresh-cw'"
                :label="$t('action.refresh')"
                data-testid="log-refresh"
            >
                {{ $t("action.refresh") }}
            </IconButton>
            <span class="toolbar-rule" />
            <div class="w-40">
                <ChoiceField
                    v-model="severity"
                    :label="$t('log.severity')"
                    :options="severityOptions"
                />
            </div>
            <input
                v-model="search"
                :aria-label="$t('log.search')"
                :placeholder="$t('log.search')"
                class="field h-6.5! w-60"
                data-testid="log-search"
                spellcheck="false"
            />
            <span class="grow" />
            <span class="text-on-surface-variant tabular-nums">{{ $t("log.count", { shown: shown.length, total }) }}</span>
        </div>

        <p
            v-if="error"
            class="mx-5 my-2 text-sm text-error break-words"
            role="alert"
        >
            {{ error }}
        </p>

        <div class="grow min-h-0 overflow-auto px-5 pb-4">
            <table
                class="plain-table"
                data-testid="server-log"
            >
                <thead v-if="structured">
                    <tr>
                        <th class="plain-head">
                            {{ $t("log.time") }}
                        </th>
                        <th class="plain-head">
                            {{ $t("log.severity.short") }}
                        </th>
                        <th class="plain-head">
                            {{ $t("log.component") }}
                        </th>
                        <th class="plain-head">
                            {{ $t("log.context") }}
                        </th>
                        <th class="plain-head">
                            {{ $t("log.message") }}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="(line, position) in shown"
                        :key="position"
                        data-testid="log-line"
                    >
                        <template v-if="line.severity">
                            <td class="plain-cell whitespace-nowrap tabular-nums">
                                {{ time(line.time) }}
                            </td>
                            <td
                                :class="SEVERITY_CLASSES[line.severity] ?? ''"
                                class="plain-cell"
                            >
                                {{ line.severity }}
                            </td>
                            <td class="plain-cell">
                                {{ line.component }}
                            </td>
                            <td class="plain-cell whitespace-nowrap">
                                {{ line.context }}
                            </td>
                            <td class="plain-cell break-words">
                                <span class="text-on-surface-strong">{{ line.message }}</span>
                                <span
                                    v-if="line.attributes"
                                    class="block font-mono text-[11.5px] text-on-surface-variant break-all"
                                >{{ line.attributes }}</span>
                            </td>
                        </template>
                        <td
                            v-else
                            class="plain-cell font-mono break-all"
                            colspan="5"
                        >
                            {{ line.message }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
