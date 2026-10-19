<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { computed, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import CodeEditor from "@/components/CodeEditor.vue";
import ErrorState from "@/components/ErrorState.vue";
import FormError from "@/components/FormError.vue";
import IconButton from "@/components/IconButton.vue";
import RoleRows from "@/components/server/RoleRows.vue";
import { useDialogs } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";
import { isDoc, toShell } from "@/shell/ejson";
import type { Doc } from "@/shell/ejson";
import { parseValue } from "@/shell/parse";
import { BUILTIN_ROLES, generatePassword, roleLabel, userCommand, userFormErrors, userFormOf } from "@/shell/users";
import type { UserForm } from "@/shell/users";
import { useConnectionsStore } from "@/stores/connections";
import type { WorkTab } from "@/stores/tabs";

/**
 * The users of a database: a list, and a form to create, change or drop one. A password goes to
 * the server only; it is neither kept nor written to the history.
 */
const props = defineProps<{
    tab: WorkTab;
}>();

const { t } = useI18n();
const { say } = useMessages();
const dialogs = useDialogs();
const connections = useConnectionsStore();

const users = shallowRef<Doc[]>([]);
const roleNames = shallowRef<string[]>([]);
/** The user the form shows; `undefined` for a new one. */
const selected = shallowRef<string>();
const form = ref<UserForm>({ user: "", password: "", roles: [] });
const customData = shallowRef("{}");
/** The password shows as text: to read it back, or after it was generated. */
const showPassword = shallowRef(false);

function newPassword() {
    form.value.password = generatePassword();
    showPassword.value = true;
}
/** The list could not be read: said in place of the page. */
const loadError = shallowRef<string>();
/** What the server said to the last save, beside the buttons. */
const error = shallowRef<string>();
/** Save was pressed: from then on what is missing is said, and its fields are framed. */
const tried = shallowRef(false);
const busy = shallowRef(false);

const existing = computed(() => selected.value !== undefined);
const databases = computed(() => connections.sessions[props.tab.connectionId]?.databases.map(database => database.name) ?? []);
const problems = computed(() => userFormErrors(form.value, existing.value));

/** Until the first answer the list says it loads, not that there is nothing. */
const loaded = shallowRef(false);

async function load() {
    try {
        const reply = await backend.runCommand(props.tab.connectionId, props.tab.database, { usersInfo: 1 });
        users.value = (Array.isArray(reply.users) ? reply.users.filter(isDoc) : []).sort((a, b) => String(a.user).localeCompare(String(b.user)));
        const roles = await backend.runCommand(props.tab.connectionId, props.tab.database, { rolesInfo: 1, showBuiltinRoles: true });
        const own = Array.isArray(roles.roles) ? roles.roles.filter(isDoc).map(role => String(role.role)) : [];
        roleNames.value = [...new Set([...own, ...BUILTIN_ROLES.map(role => role.role)])].sort((a, b) => a.localeCompare(b));
        loadError.value = undefined;
    } catch (cause) {
        loadError.value = say(errorMessage(cause));
    } finally {
        loaded.value = true;
    }
}

/** The roles of a user in one line: `readWrite, read@reports`. */
function rolesOf(user: Doc): string {
    return userFormOf(user).roles.map(roleLabel).join(", ");
}

function choose(user?: Doc) {
    selected.value = user ? String(user.user) : undefined;
    showPassword.value = false;
    form.value = user ? userFormOf(user) : { user: "", password: "", roles: [{ role: "read", db: "" }] };
    customData.value = form.value.customData ? toShell(form.value.customData) : "{}";
    error.value = undefined;
    tried.value = false;
}

/** A problem of the form, once save was pressed. */
function missing(key: string): boolean {
    return tried.value && problems.value.includes(key);
}

async function save() {
    tried.value = true;
    if (problems.value.length > 0) return;
    error.value = undefined;
    busy.value = true;
    try {
        const data = customData.value.trim() ? parseValue(customData.value) : {};
        if (!isDoc(data)) throw new Error(`${t("users.customData")}: ${t("document.error.notDocument")}`);
        await backend.runCommand(props.tab.connectionId, props.tab.database, userCommand({ ...form.value, customData: data }, props.tab.database, existing.value));
        const name = form.value.user.trim();
        await load();
        choose(users.value.find(user => user.user === name));
    } catch (cause) {
        error.value = say(errorMessage(cause));
    } finally {
        // The password is gone from the form as soon as the server has it.
        form.value.password = "";
        busy.value = false;
    }
}

async function drop() {
    const name = selected.value;
    if (name === undefined) return;
    const confirmed = await dialogs.confirm({ title: t("users.drop.title"), text: t("users.drop.text", { name, database: props.tab.database }), action: t("action.drop") });
    if (!confirmed) return;
    try {
        await backend.runCommand(props.tab.connectionId, props.tab.database, { dropUser: name });
        await load();
        choose();
    } catch (cause) {
        error.value = say(errorMessage(cause));
    }
}

onMounted(async () => {
    await load();
    choose(users.value[0]);
});
</script>

<template>
    <ErrorState
        v-if="loadError"
        :detail="loadError"
        :title="$t('page.loadFailed')"
        data-testid="user-load-error"
    >
        <ButtonRoot
            @click="load"
            class="btn-primary h-7! text-[12px]"
        >
            <ButtonContent>{{ $t("action.reload") }}</ButtonContent>
        </ButtonRoot>
    </ErrorState>
    <div
        v-else
        class="h-full flex min-h-0"
    >
        <aside class="w-60 shrink-0 flex flex-col border-r border-divider">
            <div class="h-9 shrink-0 flex items-center gap-0.5 px-3">
                <IconButton
                    @click="choose()"
                    :label="$t('users.new')"
                    data-testid="user-new"
                    icon="i-lucide-user-plus"
                    tint="text-success"
                >
                    {{ $t("users.new") }}
                </IconButton>
                <span class="grow" />
                <IconButton
                    @click="load"
                    :label="$t('action.refresh')"
                    icon="i-lucide-refresh-cw"
                />
            </div>
            <ul
                :aria-label="$t('users.list')"
                class="grow min-h-0 overflow-y-auto m-0 p-0 list-none"
            >
                <li
                    v-for="user in users"
                    :key="String(user.user)"
                >
                    <button
                        @click="choose(user)"
                        :class="selected === user.user ? 'bg-primary/20 text-on-surface-strong' : 'hover:bg-on-surface/5'"
                        :title="rolesOf(user)"
                        class="w-full px-3 py-1 flex items-center gap-2 text-left"
                        data-testid="user-item"
                        type="button"
                    >
                        <span class="i-lucide-user size-4 shrink-0" />
                        <span class="min-w-0 flex flex-col">
                            <span class="truncate">{{ user.user }}</span>
                            <!-- The roles below the name. -->
                            <span
                                v-if="rolesOf(user)"
                                class="truncate text-[11.5px] text-on-surface-variant"
                                data-testid="user-item-roles"
                            >{{ rolesOf(user) }}</span>
                        </span>
                    </button>
                </li>
                <li
                    v-if="users.length === 0"
                    class="px-3 py-2 text-on-surface-variant"
                >
                    {{ $t(loaded ? "users.none" : "choice.loading") }}
                </li>
            </ul>
        </aside>

        <form
            @submit.prevent="save"
            class="grow min-w-0 overflow-y-auto px-6 py-4 flex flex-col gap-4 max-w-200"
        >
            <h2 class="m-0 text-[17px] font-normal text-on-surface-strong">
                {{ existing ? $t("users.edit", { name: selected }) : $t("users.create", { database: tab.database }) }}
            </h2>
            <div class="form-grid">
                <span>{{ $t("users.name") }}:</span>
                <input
                    v-model="form.user"
                    :aria-invalid="missing('users.error.name') || undefined"
                    :class="missing('users.error.name') ? 'field-invalid' : ''"
                    :disabled="existing"
                    autocomplete="off"
                    class="field disabled:opacity-60"
                    data-testid="user-name"
                    spellcheck="false"
                />
                <span>{{ $t(existing ? "users.newPassword" : "users.password") }}:</span>
                <div class="flex items-center gap-1">
                    <input
                        v-model="form.password"
                        :aria-invalid="missing('users.error.password') || undefined"
                        :class="missing('users.error.password') ? 'field-invalid' : ''"
                        :placeholder="existing ? $t('users.password.unchanged') : ''"
                        :type="showPassword ? 'text' : 'password'"
                        autocomplete="new-password"
                        class="field grow min-w-0"
                        data-testid="user-password"
                        spellcheck="false"
                    />
                    <IconButton
                        @click="showPassword = !showPassword"
                        :active="showPassword"
                        :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                        :label="showPassword ? $t('users.password.hide') : $t('users.password.show')"
                        data-testid="user-password-show"
                    />
                    <IconButton
                        @click="newPassword"
                        :label="$t('users.password.generate')"
                        data-testid="user-password-generate"
                        icon="i-lucide-dices"
                    />
                </div>
            </div>

            <div class="flex flex-col gap-1.5">
                <span>{{ $t("users.roles") }}</span>
                <RoleRows
                    v-model="form.roles"
                    :databases
                    :roleNames
                />
            </div>

            <div class="flex flex-col gap-1.5">
                <span>{{ $t("users.customData") }}</span>
                <div class="h-24 rounded-sm bg-background border border-divider">
                    <CodeEditor
                        v-model="customData"
                        :label="$t('users.customData')"
                    />
                </div>
            </div>

            <p
                v-if="existing && users.find(user => user.user === selected)"
                class="m-0 text-on-surface-variant"
            >
                {{ $t("users.mechanisms", { mechanisms: (users.find(user => user.user === selected)?.mechanisms as string[] | undefined)?.join(", ") ?? "–" }) }}
                · {{ form.roles.map(roleLabel).join(", ") }}
            </p>

            <div class="flex gap-2">
                <ButtonRoot
                    @click="save"
                    :disabled="busy"
                    class="btn-primary"
                    data-testid="user-save"
                >
                    <ButtonContent>{{ $t(existing ? "action.save" : "action.create") }}</ButtonContent>
                </ButtonRoot>
                <ButtonRoot
                    v-if="existing"
                    @click="drop"
                    :disabled="busy"
                    class="btn-secondary"
                    data-testid="user-drop"
                >
                    <ButtonContent>{{ $t("users.drop") }}</ButtonContent>
                </ButtonRoot>
                <FormError
                    :text="error ?? (tried ? problems.map(key => $t(key)).join(' ') || undefined : undefined)"
                    data-testid="user-error"
                />
            </div>
        </form>
    </div>
</template>
