<script setup lang="ts">
import { ButtonContent, ButtonRoot, SwitchRoot, SwitchThumb, SwitchTrack } from "@vuetify/v0";
import { computed, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import ErrorState from "@/components/ErrorState.vue";
import FormError from "@/components/FormError.vue";
import IconButton from "@/components/IconButton.vue";
import { useDialogs } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";
import { isDoc } from "@/shell/ejson";
import type { Doc } from "@/shell/ejson";
import { NEW_MEMBER, lockedFields, memberProblems, membersOf, withMember, withoutMember } from "@/shell/replicaSet";
import type { MemberForm, MemberRow } from "@/shell/replicaSet";
import type { WorkTab } from "@/stores/tabs";

/**
 * The members of a replica set (C26): their part and state, adding one (priority, votes, arbiter,
 * hidden, tags) and removing one, each as a new configuration with `replSetReconfig`. What the
 * server fixes for an arbiter or a hidden member is grey.
 */
const props = defineProps<{
    tab: WorkTab;
}>();

const { t } = useI18n();
const { say } = useMessages();
const dialogs = useDialogs();

const config = shallowRef<Doc>();
const members = shallowRef<MemberRow[]>([]);
/** The page could not be read: said in place of it (a single server has no replica set). */
const failure = shallowRef<string>();
const loaded = shallowRef(false);
const busy = shallowRef(false);
const form = ref<MemberForm>({ ...NEW_MEMBER });
const tried = shallowRef(false);
const error = shallowRef<string>();

const problems = computed(() => memberProblems(form.value, members.value));
const locked = computed(() => lockedFields(form.value));

function admin(document: Doc) {
    return backend.runCommand(props.tab.connectionId, "admin", document);
}

async function load() {
    try {
        const reply = await admin({ replSetGetConfig: 1 });
        if (!isDoc(reply.config)) throw new Error(t("replicaSet.none"));
        // The state is a bonus: a user without the right to read it still sees the members.
        const status = await admin({ replSetGetStatus: 1 }).catch(() => undefined);
        config.value = reply.config;
        members.value = membersOf(reply.config, status);
        failure.value = undefined;
    } catch (cause) {
        failure.value = say(errorMessage(cause));
    } finally {
        loaded.value = true;
    }
}

/** Sends the changed configuration, after asking: every member takes it over. */
async function reconfigure(next: Doc, question: { title: string; text: string; action: string }): Promise<boolean> {
    if (!await dialogs.confirm(question)) return false;
    busy.value = true;
    error.value = undefined;
    try {
        await admin({ replSetReconfig: next });
        await load();
        return true;
    } catch (cause) {
        error.value = say(errorMessage(cause));
        return false;
    } finally {
        busy.value = false;
    }
}

async function add() {
    tried.value = true;
    if (problems.value.length > 0 || !config.value) return;
    const host = form.value.host.trim();
    const done = await reconfigure(withMember(config.value, form.value), {
        title: t("replicaSet.add.title"),
        text: t("replicaSet.add.text", { host, name: String(config.value._id ?? "") }),
        action: t("replicaSet.add")
    });
    if (done) {
        form.value = { ...NEW_MEMBER };
        tried.value = false;
    }
}

async function remove(member: MemberRow) {
    if (!config.value) return;
    await reconfigure(withoutMember(config.value, member.id), {
        title: t("replicaSet.remove.title"),
        text: t("replicaSet.remove.text", { host: member.host }),
        action: t("action.delete")
    });
}

function tagsText(member: MemberRow): string {
    return Object.entries(member.tags).map(([key, value]) => `${key}: ${value}`).join(", ");
}

onMounted(load);
</script>

<template>
    <ErrorState
        v-if="failure"
        :detail="failure"
        :title="$t('page.loadFailed')"
        data-testid="replica-load-error"
    />
    <div
        v-else
        class="h-full min-h-0 overflow-y-auto px-6 py-4 flex flex-col gap-5 text-[13px]"
    >
        <div class="flex items-center gap-2">
            <h2 class="m-0 text-[17px] font-normal text-on-surface-strong">
                {{ $t("replicaSet.title", { name: String(config?._id ?? "") }) }}
            </h2>
            <span class="grow" />
            <IconButton
                @click="load"
                :label="$t('action.refresh')"
                icon="i-lucide-refresh-cw"
            />
        </div>

        <table class="w-full max-w-240 border-collapse">
            <thead>
                <tr class="text-left text-on-surface-variant">
                    <th class="py-1 pr-3 font-normal">
                        {{ $t("replicaSet.host") }}
                    </th>
                    <th class="py-1 pr-3 font-normal">
                        {{ $t("replicaSet.state") }}
                    </th>
                    <th class="py-1 pr-3 font-normal">
                        {{ $t("replicaSet.priority") }}
                    </th>
                    <th class="py-1 pr-3 font-normal">
                        {{ $t("replicaSet.votes") }}
                    </th>
                    <th class="py-1 pr-3 font-normal">
                        {{ $t("replicaSet.kind") }}
                    </th>
                    <th class="py-1 pr-3 font-normal">
                        {{ $t("replicaSet.tags") }}
                    </th>
                    <th />
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="member in members"
                    :key="member.id"
                    class="border-t border-divider"
                    data-testid="replica-member"
                >
                    <td class="py-1.5 pr-3 font-mono text-on-surface-strong">
                        {{ member.host }}
                        <span
                            v-if="member.self"
                            class="ml-1 font-sans text-on-surface-variant"
                        >({{ $t("replicaSet.self") }})</span>
                    </td>
                    <td class="py-1.5 pr-3">
                        <span
                            v-if="member.state"
                            :class="member.healthy ? 'text-on-surface' : 'text-error'"
                        >{{ member.state }}</span>
                        <span
                            v-else
                            class="text-on-surface-variant"
                        >–</span>
                    </td>
                    <td class="py-1.5 pr-3">
                        {{ member.arbiterOnly ? "–" : member.priority }}
                    </td>
                    <td class="py-1.5 pr-3">
                        {{ member.votes }}
                    </td>
                    <td class="py-1.5 pr-3">
                        {{ member.arbiterOnly ? $t("replicaSet.arbiter") : member.hidden ? $t("replicaSet.hidden") : $t("replicaSet.data") }}
                    </td>
                    <td class="py-1.5 pr-3 text-on-surface-variant">
                        {{ tagsText(member) }}
                    </td>
                    <td class="py-1.5 text-right">
                        <!-- The member the app talks to can not take itself out. -->
                        <IconButton
                            @click="remove(member)"
                            :disabled="busy || member.self || members.length <= 1"
                            :label="$t('replicaSet.remove', { host: member.host })"
                            data-testid="replica-member-remove"
                            icon="i-lucide-x"
                            tint="text-error"
                        />
                    </td>
                </tr>
                <tr v-if="members.length === 0">
                    <td
                        class="py-2 text-on-surface-variant"
                        colspan="7"
                    >
                        {{ $t(loaded ? "replicaSet.empty" : "choice.loading") }}
                    </td>
                </tr>
            </tbody>
        </table>

        <form
            @submit.prevent="add"
            class="flex flex-col gap-3 max-w-160"
        >
            <h3 class="m-0 text-[15px] font-normal text-on-surface-strong">
                {{ $t("replicaSet.add") }}
            </h3>
            <div class="form-grid grid-cols-[10rem_1fr]!">
                <span>{{ $t("replicaSet.host") }}:</span>
                <input
                    v-model="form.host"
                    :aria-invalid="tried && problems.some(key => key.startsWith('replicaSet.error.host') || key === 'replicaSet.error.exists') || undefined"
                    class="field"
                    data-testid="replica-host"
                    placeholder="db3.example.com:27017"
                    spellcheck="false"
                />
                <span>{{ $t("replicaSet.arbiter") }}:</span>
                <SwitchRoot
                    v-model="form.arbiterOnly"
                    :label="$t('replicaSet.arbiter')"
                    data-testid="replica-arbiter"
                >
                    <SwitchTrack class="switch-track">
                        <SwitchThumb class="switch-thumb" />
                    </SwitchTrack>
                </SwitchRoot>
                <span>{{ $t("replicaSet.hidden") }}:</span>
                <SwitchRoot
                    v-model="form.hidden"
                    :class="locked.hidden ? 'opacity-40' : ''"
                    :disabled="locked.hidden"
                    :label="$t('replicaSet.hidden')"
                >
                    <SwitchTrack class="switch-track">
                        <SwitchThumb class="switch-thumb" />
                    </SwitchTrack>
                </SwitchRoot>
                <span>{{ $t("replicaSet.priority") }}:</span>
                <input
                    v-model.number="form.priority"
                    :disabled="locked.priority"
                    :title="locked.priority ? $t('replicaSet.priority.fixed') : undefined"
                    class="field w-28 disabled:opacity-50"
                    data-testid="replica-priority"
                    max="1000"
                    min="0"
                    step="0.5"
                    type="number"
                />
                <span>{{ $t("replicaSet.votes") }}:</span>
                <input
                    v-model.number="form.votes"
                    :disabled="locked.votes"
                    class="field w-28 disabled:opacity-50"
                    max="1"
                    min="0"
                    type="number"
                />
                <span>{{ $t("replicaSet.tags") }}:</span>
                <input
                    v-model="form.tags"
                    :disabled="locked.tags"
                    class="field disabled:opacity-50"
                    placeholder="dc: east, rack: 1"
                    spellcheck="false"
                />
            </div>
            <div class="flex items-center gap-2">
                <ButtonRoot
                    @click="add"
                    :disabled="busy || !config"
                    class="btn-primary"
                    data-testid="replica-add"
                >
                    <ButtonContent>{{ $t("replicaSet.add") }}</ButtonContent>
                </ButtonRoot>
            </div>
            <FormError
                :text="error ?? (tried ? problems.map(key => $t(key)).join(' ') || undefined : undefined)"
                data-testid="replica-error"
            />
        </form>
    </div>
</template>
