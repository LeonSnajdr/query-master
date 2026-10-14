<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { computed, onMounted, ref, shallowRef, useId } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import IconButton from "@/components/IconButton.vue";
import RoleRows from "@/components/server/RoleRows.vue";
import SelectField from "@/components/SelectField.vue";
import { useDialogs } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";
import { isDoc } from "@/shell/ejson";
import type { Doc } from "@/shell/ejson";
import { BUILTIN_ROLES, PRIVILEGE_ACTIONS, roleCommand, roleFormOf } from "@/shell/users";
import type { PrivilegeForm, RoleForm } from "@/shell/users";
import { useConnectionsStore } from "@/stores/connections";
import type { WorkTab } from "@/stores/tabs";

/** The roles a database defines: privileges on resources and roles they inherit. */
const props = defineProps<{
    tab: WorkTab;
}>();

const { t } = useI18n();
const { say, report } = useMessages();
const dialogs = useDialogs();
const connections = useConnectionsStore();
const actionList = useId();

const roles = shallowRef<Doc[]>([]);
const roleNames = shallowRef<string[]>([]);
const selected = shallowRef<string>();
const form = ref<RoleForm>({ role: "", privileges: [], roles: [] });
/** The actions of each privilege row as typed: comma separated. */
const actionTexts = ref<string[]>([]);
const error = shallowRef<string>();
const busy = shallowRef(false);

const existing = computed(() => selected.value !== undefined);
const databases = computed(() => connections.sessions[props.tab.connectionId]?.databases.map(database => database.name) ?? []);
const kindOptions = computed(() => (["namespace", "cluster"] as const).map(value => ({ value, label: t(`roles.resource.${value}`) })));
const unknownActions = computed(() => actionTexts.value.flatMap(splitActions).filter(action => !PRIVILEGE_ACTIONS.includes(action)));

function splitActions(text: string): string[] {
    return text.split(/[\s,]+/).map(item => item.trim()).filter(Boolean);
}

async function load() {
    try {
        const reply = await backend.runCommand(props.tab.connectionId, props.tab.database, { rolesInfo: 1, showPrivileges: true, showBuiltinRoles: false });
        roles.value = (Array.isArray(reply.roles) ? reply.roles.filter(isDoc) : []).sort((a, b) => String(a.role).localeCompare(String(b.role)));
        roleNames.value = [...new Set([...roles.value.map(role => String(role.role)), ...BUILTIN_ROLES.map(role => role.role)])].sort((a, b) => a.localeCompare(b));
        error.value = undefined;
    } catch (cause) {
        error.value = say(errorMessage(cause));
    }
}

function choose(role?: Doc) {
    selected.value = role ? String(role.role) : undefined;
    form.value = role ? roleFormOf(role) : { role: "", privileges: [newPrivilege()], roles: [] };
    actionTexts.value = form.value.privileges.map(privilege => privilege.actions.join(", "));
    error.value = undefined;
}

function newPrivilege(): PrivilegeForm {
    return { kind: "namespace", db: props.tab.database, collection: "", actions: [] };
}

function addPrivilege() {
    form.value.privileges.push(newPrivilege());
    actionTexts.value.push("");
}

function removePrivilege(position: number) {
    form.value.privileges.splice(position, 1);
    actionTexts.value.splice(position, 1);
}

async function save() {
    if (!form.value.role.trim()) return;
    busy.value = true;
    try {
        const privileges = form.value.privileges.map((privilege, position) => ({ ...privilege, actions: splitActions(actionTexts.value[position] ?? "") }));
        await backend.runCommand(props.tab.connectionId, props.tab.database, roleCommand({ ...form.value, privileges }, props.tab.database, existing.value));
        const name = form.value.role.trim();
        await load();
        choose(roles.value.find(role => role.role === name));
    } catch (cause) {
        error.value = say(errorMessage(cause));
    } finally {
        busy.value = false;
    }
}

async function drop() {
    const name = selected.value;
    if (name === undefined) return;
    const confirmed = await dialogs.confirm({ title: t("roles.drop.title"), text: t("roles.drop.text", { name, database: props.tab.database }), action: t("action.drop") });
    if (!confirmed) return;
    try {
        await backend.runCommand(props.tab.connectionId, props.tab.database, { dropRole: name });
        await load();
        choose();
    } catch (cause) {
        report(cause);
    }
}

onMounted(async () => {
    await load();
    choose(roles.value[0]);
});
</script>

<template>
    <div class="h-full flex min-h-0">
        <aside class="w-60 shrink-0 flex flex-col border-r border-divider">
            <div class="h-9 shrink-0 flex items-center gap-0.5 px-3">
                <IconButton
                    @click="choose()"
                    :label="$t('roles.new')"
                    data-testid="role-new"
                    icon="i-lucide-shield-plus"
                    tint="text-success"
                >
                    {{ $t("roles.new") }}
                </IconButton>
                <span class="grow" />
                <IconButton
                    @click="load"
                    :label="$t('action.refresh')"
                    icon="i-lucide-refresh-cw"
                />
            </div>
            <ul
                :aria-label="$t('roles.list')"
                class="grow min-h-0 overflow-y-auto m-0 p-0 list-none"
            >
                <li
                    v-for="role in roles"
                    :key="String(role.role)"
                >
                    <button
                        @click="choose(role)"
                        :class="selected === role.role ? 'bg-primary/20 text-on-surface-strong' : 'hover:bg-on-surface/5'"
                        class="w-full px-3 py-1 flex items-center gap-2 text-left"
                        data-testid="role-item"
                        type="button"
                    >
                        <span class="i-lucide-shield size-4 shrink-0" />
                        <span class="truncate">{{ role.role }}</span>
                    </button>
                </li>
                <li
                    v-if="roles.length === 0"
                    class="px-3 py-2 text-on-surface-variant"
                >
                    {{ $t("roles.none") }}
                </li>
            </ul>
        </aside>

        <form
            @submit.prevent="save"
            class="grow min-w-0 overflow-y-auto px-6 py-4 flex flex-col gap-4 max-w-220"
        >
            <h2 class="m-0 text-[17px] font-normal text-on-surface-strong">
                {{ existing ? $t("roles.edit", { name: selected }) : $t("roles.create", { database: tab.database }) }}
            </h2>
            <div class="form-grid">
                <span>{{ $t("roles.name") }}:</span>
                <input
                    v-model="form.role"
                    :disabled="existing"
                    class="field disabled:opacity-60"
                    data-testid="role-name-field"
                    spellcheck="false"
                />
            </div>

            <datalist :id="actionList">
                <option
                    v-for="action in PRIVILEGE_ACTIONS"
                    :key="action"
                    :value="action"
                />
            </datalist>
            <div class="flex flex-col gap-1.5">
                <span>{{ $t("roles.privileges") }}</span>
                <div
                    v-for="(privilege, position) in form.privileges"
                    :key="position"
                    class="flex flex-col gap-1.5 p-2.5 rounded-sm border border-divider"
                    data-testid="privilege-row"
                >
                    <div class="flex items-center gap-1.5">
                        <div class="w-36">
                            <SelectField
                                v-model="privilege.kind"
                                :label="$t('roles.resource')"
                                :options="kindOptions"
                            />
                        </div>
                        <template v-if="privilege.kind === 'namespace'">
                            <input
                                v-model="privilege.db"
                                :aria-label="$t('roles.database')"
                                :placeholder="$t('roles.database.any')"
                                class="field w-44"
                                spellcheck="false"
                            />
                            <input
                                v-model="privilege.collection"
                                :aria-label="$t('roles.collection')"
                                :placeholder="$t('roles.collection.any')"
                                class="field grow"
                                spellcheck="false"
                            />
                        </template>
                        <span
                            v-else
                            class="grow"
                        />
                        <IconButton
                            @click="removePrivilege(position)"
                            :label="$t('roles.removePrivilege')"
                            icon="i-lucide-x"
                        />
                    </div>
                    <input
                        v-model="actionTexts[position]"
                        :aria-label="$t('roles.actions')"
                        :list="actionList"
                        :placeholder="$t('roles.actions.placeholder')"
                        class="field font-mono"
                        data-testid="privilege-actions"
                        spellcheck="false"
                    />
                </div>
                <ButtonRoot
                    @click="addPrivilege"
                    class="btn-ghost self-start"
                >
                    <ButtonContent class="inline-flex items-center gap-1.5">
                        <span class="i-lucide-plus" />{{ $t("roles.addPrivilege") }}
                    </ButtonContent>
                </ButtonRoot>
                <p
                    v-if="unknownActions.length > 0"
                    class="m-0 text-warning"
                >
                    {{ $t("roles.unknownActions", { actions: unknownActions.join(", ") }) }}
                </p>
            </div>

            <div class="flex flex-col gap-1.5">
                <span>{{ $t("roles.inherited") }}</span>
                <RoleRows
                    v-model="form.roles"
                    :databases
                    :roleNames
                />
            </div>

            <p
                v-if="error"
                class="m-0 text-sm text-error break-words"
                data-testid="role-error"
                role="alert"
            >
                {{ error }}
            </p>

            <div class="flex gap-2">
                <ButtonRoot
                    @click="save"
                    :disabled="busy || !form.role.trim()"
                    class="btn-primary"
                    data-testid="role-save"
                >
                    <ButtonContent>{{ $t(existing ? "action.save" : "action.create") }}</ButtonContent>
                </ButtonRoot>
                <ButtonRoot
                    v-if="existing"
                    @click="drop"
                    class="btn-secondary"
                    data-testid="role-drop"
                >
                    <ButtonContent>{{ $t("roles.drop") }}</ButtonContent>
                </ButtonRoot>
            </div>
        </form>
    </div>
</template>
