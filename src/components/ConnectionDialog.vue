<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogClose, DialogContent, DialogRoot, DialogTitle, SwitchRoot, SwitchThumb, SwitchTrack, TabsItem, TabsList, TabsPanel, TabsRoot } from "@vuetify/v0";
import { computed, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import type { Profile } from "@/api";
import FormError from "@/components/FormError.vue";
import ChoiceField from "@/components/ChoiceField.vue";
import { useActions } from "@/composables/actions";
import { useDialogs } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";
import { DEFAULT_PORT, buildUri, emptyFields, parseUri } from "@/connection/uri";
import type { AuthMode, ConnectMode, ConnectionFields } from "@/connection/uri";
import { pickFilePath } from "@/files";
import { ENVIRONMENTS } from "@/shell/guard";
import type { Environment } from "@/shell/guard";
import { useConnectionsStore } from "@/stores/connections";

/**
 * Creates a connection, or changes the one given: the fields of a connection string, by topic.
 * With `clone` the one given is only the start of a new connection.
 */
const props = defineProps<{
    profile?: Profile;
    clone?: boolean;
}>();
const open = defineModel<boolean>({ default: false });

const TABS = ["basic", "auth", "tls", "ssh", "options"] as const;

const { t } = useI18n();
const { say } = useMessages();
const dialogs = useDialogs();
const actions = useActions();
const connections = useConnectionsStore();
const name = shallowRef("");
/** "none" or an environment (stage 21): how the app asks before writing on the connection. */
const environment = shallowRef<"none" | Environment>("none");
const environmentOptions = computed(() => (["none", ...ENVIRONMENTS] as const).map(value => ({
    value,
    label: t(`environment.${value}`),
    hint: t(`environment.${value}.hint`)
})));
const fields = ref<ConnectionFields>(emptyFields());
const tab = shallowRef<typeof TABS[number]>("basic");
const busy = shallowRef(false);
/** Outcome of the last test or failed save. */
const notice = shallowRef<{ ok: boolean; text: string }>();

const uri = computed(() => buildUri(fields.value));
/** Replica set members, one `host:port` per line. */
const members = computed({
    get: () => fields.value.hosts.map(host => (host.port === DEFAULT_PORT ? host.host : `${host.host}:${host.port}`)).join("\n"),
    set: (text: string) => {
        fields.value.hosts = text.split(/[\n,]/).map(line => line.trim()).filter(Boolean).map((line) => {
            const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(line);
            return { host: match?.[1] ?? line, port: match?.[2] ? Number(match[2]) : DEFAULT_PORT };
        });
    }
});
const host = computed(() => fields.value.hosts[0] ?? { host: "", port: DEFAULT_PORT });

const connectOptions = computed(() => (["single", "replicaSet", "srv"] as ConnectMode[]).map(value => ({ value, label: t(`connection.mode.${value}`) })));
const authOptions = computed(() => (["none", "scram", "x509", "aws", "ldap"] as AuthMode[]).map(value => ({ value, label: t(`connection.auth.${value}`) })));
const tlsOptions = computed(() => [{ value: "off" as const, label: t("connection.tls.off") }, { value: "on" as const, label: t("connection.tls.on") }]);
const tlsChoice = computed({ get: () => (fields.value.tls ? "on" : "off"), set: (value: "on" | "off") => (fields.value.tls = value === "on") });
const sshOptions = computed(() => [{ value: "none" as const, label: t("connection.ssh.none") }]);
const sshChoice = shallowRef<"none">("none");

watch(() => fields.value.mode, (mode) => {
    // SRV needs TLS (the driver turns it on); a single server keeps one host.
    if (mode === "srv") fields.value.tls = true;
    if (mode === "single") fields.value.hosts = fields.value.hosts.slice(0, 1);
});

function fail(error: unknown) {
    notice.value = { ok: false, text: say(errorMessage(error)) };
}

watch(open, async (isOpen) => {
    if (!isOpen) return;
    notice.value = undefined;
    tab.value = "basic";
    name.value = props.profile ? (props.clone ? t("connection.clone.name", { name: props.profile.name }) : props.profile.name) : "";
    environment.value = props.profile?.environment ?? "none";
    fields.value = emptyFields();
    if (!props.profile) return;
    try {
        fields.value = parseUri(await backend.connectionUri(props.profile.id));
    } catch (error) {
        fail(error);
    }
});

function setHost(value: string) {
    fields.value.hosts = [{ host: value, port: host.value.port }];
}

function setPort(value: string) {
    fields.value.hosts = [{ host: host.value.host, port: Number(value) || DEFAULT_PORT }];
}

async function fromUri() {
    const text = await dialogs.ask({ title: t("connection.fromUri"), label: t("connection.field.uri"), value: uri.value, action: t("action.apply"), code: true });
    if (!text) return;
    try {
        fields.value = parseUri(text);
        notice.value = undefined;
    } catch {
        notice.value = { ok: false, text: t("error.backend.uriScheme") };
    }
}

function toUri() {
    dialogs.showText({ title: t("connection.toUri"), text: uri.value });
}

async function pick(field: "tlsCAFile" | "tlsCertificateKeyFile") {
    const path = await pickFilePath();
    if (path) fields.value[field] = path;
}

async function test() {
    busy.value = true;
    notice.value = undefined;
    try {
        const info = await backend.testConnection(uri.value);
        notice.value = { ok: true, text: t("connection.test.ok", { version: info.version }) };
    } catch (error) {
        fail(error);
    } finally {
        busy.value = false;
    }
}

async function save(connect = false) {
    busy.value = true;
    try {
        const profile = await connections.save({
            id: props.clone ? undefined : props.profile?.id,
            name: name.value.trim() || t("connection.unnamed"),
            uri: uri.value,
            environment: environment.value === "none" ? null : environment.value
        });
        open.value = false;
        if (connect) await actions.connect(profile);
    } catch (error) {
        fail(error);
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <DialogRoot v-model="open">
        <DialogContent class="dialog w-[min(94vw,40rem)]!">
            <form
                @submit.prevent="save()"
                class="flex flex-col gap-4"
            >
                <DialogTitle class="dialog-title text-[21px]!">
                    {{ $t(profile && !clone ? "connection.edit.title" : "connection.new.title") }}
                </DialogTitle>

                <label class="flex items-center gap-3">
                    <span class="w-14 text-[13px] text-on-surface">{{ $t("connection.field.name") }}:</span>
                    <input
                        v-model="name"
                        :placeholder="$t('connection.field.name.placeholder')"
                        class="field grow"
                        data-testid="connection-name"
                        type="text"
                    />
                </label>
                <div class="flex items-center gap-3">
                    <span class="w-14 text-[13px] text-on-surface">{{ $t("environment.label") }}:</span>
                    <ChoiceField
                        v-model="environment"
                        :label="$t('environment.label')"
                        :options="environmentOptions"
                        class="w-64"
                        data-testid="connection-environment"
                    />
                </div>

                <TabsRoot
                    v-model="tab"
                    mandatory
                >
                    <div class="flex items-end border-b border-divider">
                        <TabsList
                            :label="$t('connection.tabs')"
                            class="flex"
                        >
                            <TabsItem
                                v-for="item in TABS"
                                :key="item"
                                :data-testid="`connection-tab-${item}`"
                                :value="item"
                                class="h-8 px-3 text-[13px] text-on-surface border-b-2 border-transparent hover:text-on-surface-strong data-[selected]:text-primary data-[selected]:border-primary"
                            >
                                {{ $t(`connection.tab.${item}`) }}
                            </TabsItem>
                        </TabsList>
                        <span class="grow" />
                        <ButtonRoot
                            @click="fromUri"
                            class="h-8 px-1.5 text-[13px] text-primary underline decoration-dotted underline-offset-4"
                            data-testid="connection-from-uri"
                        >
                            <ButtonContent>{{ $t("connection.fromUri") }}</ButtonContent>
                        </ButtonRoot>
                        <span class="h-8 leading-8 text-on-surface-variant">|</span>
                        <ButtonRoot
                            @click="toUri"
                            class="h-8 px-1.5 text-[13px] text-primary underline decoration-dotted underline-offset-4"
                            data-testid="connection-to-uri"
                        >
                            <ButtonContent>{{ $t("connection.toUri") }}</ButtonContent>
                        </ButtonRoot>
                    </div>

                    <div class="min-h-56 pt-4 text-[13px]">
                        <TabsPanel
                            class="form-grid"
                            value="basic"
                        >
                            <span>{{ $t("connection.mode") }}:</span>
                            <ChoiceField
                                v-model="fields.mode"
                                :label="$t('connection.mode')"
                                :options="connectOptions"
                            />
                            <template v-if="fields.mode === 'replicaSet'">
                                <span class="self-start pt-2">{{ $t("connection.members") }}:</span>
                                <textarea
                                    v-model="members"
                                    class="field h-auto py-1.5 font-mono resize-y"
                                    data-testid="connection-members"
                                    rows="3"
                                    spellcheck="false"
                                />
                                <span>{{ $t("connection.replicaSet") }}:</span>
                                <input
                                    v-model="fields.replicaSet"
                                    class="field"
                                    data-testid="connection-replica-set"
                                    spellcheck="false"
                                />
                            </template>
                            <template v-else>
                                <span>{{ $t("connection.host") }}:</span>
                                <span class="flex items-center gap-2">
                                    <input
                                        @input="setHost(($event.target as HTMLInputElement).value)"
                                        :value="host.host"
                                        class="field grow"
                                        data-testid="connection-host"
                                        spellcheck="false"
                                    />
                                    <template v-if="fields.mode === 'single'">
                                        <span>{{ $t("connection.port") }}:</span>
                                        <input
                                            @input="setPort(($event.target as HTMLInputElement).value)"
                                            :value="host.port"
                                            class="field w-20 font-mono"
                                            data-testid="connection-port"
                                            inputmode="numeric"
                                        />
                                    </template>
                                </span>
                            </template>
                            <span>{{ $t("connection.database") }}:</span>
                            <input
                                v-model="fields.database"
                                :placeholder="$t('connection.database.placeholder')"
                                class="field"
                                spellcheck="false"
                            />
                        </TabsPanel>

                        <TabsPanel
                            class="form-grid"
                            value="auth"
                        >
                            <span>{{ $t("connection.auth") }}:</span>
                            <ChoiceField
                                v-model="fields.auth"
                                :label="$t('connection.auth')"
                                :options="authOptions"
                            />
                            <template v-if="fields.auth !== 'none'">
                                <span>{{ $t("connection.username") }}:</span>
                                <input
                                    v-model="fields.username"
                                    autocomplete="off"
                                    class="field"
                                    data-testid="connection-username"
                                    spellcheck="false"
                                />
                                <template v-if="fields.auth !== 'x509'">
                                    <span>{{ $t("connection.password") }}:</span>
                                    <input
                                        v-model="fields.password"
                                        autocomplete="off"
                                        class="field"
                                        data-testid="connection-password"
                                        type="password"
                                    />
                                </template>
                                <span>{{ $t("connection.authSource") }}:</span>
                                <input
                                    v-model="fields.authSource"
                                    :placeholder="fields.auth === 'scram' ? 'admin' : '$external'"
                                    class="field"
                                    spellcheck="false"
                                />
                            </template>
                        </TabsPanel>

                        <TabsPanel
                            class="form-grid"
                            value="tls"
                        >
                            <span>{{ $t("connection.tls") }}:</span>
                            <ChoiceField
                                v-model="tlsChoice"
                                :label="$t('connection.tls')"
                                :options="tlsOptions"
                            />
                            <template v-if="fields.tls">
                                <span>{{ $t("connection.tls.ca") }}:</span>
                                <span class="flex gap-2">
                                    <input
                                        v-model="fields.tlsCAFile"
                                        class="field grow font-mono"
                                        spellcheck="false"
                                    />
                                    <ButtonRoot
                                        @click="pick('tlsCAFile')"
                                        class="btn-secondary"
                                    >
                                        <ButtonContent>…</ButtonContent>
                                    </ButtonRoot>
                                </span>
                                <span>{{ $t("connection.tls.certificate") }}:</span>
                                <span class="flex gap-2">
                                    <input
                                        v-model="fields.tlsCertificateKeyFile"
                                        class="field grow font-mono"
                                        spellcheck="false"
                                    />
                                    <ButtonRoot
                                        @click="pick('tlsCertificateKeyFile')"
                                        class="btn-secondary"
                                    >
                                        <ButtonContent>…</ButtonContent>
                                    </ButtonRoot>
                                </span>
                                <span>{{ $t("connection.tls.invalid") }}:</span>
                                <SwitchRoot
                                    v-model="fields.tlsAllowInvalidCertificates"
                                    :label="$t('connection.tls.invalid')"
                                >
                                    <SwitchTrack class="switch-track">
                                        <SwitchThumb class="switch-thumb" />
                                    </SwitchTrack>
                                </SwitchRoot>
                            </template>
                        </TabsPanel>

                        <TabsPanel
                            class="form-grid"
                            value="ssh"
                        >
                            <span>{{ $t("connection.ssh") }}:</span>
                            <ChoiceField
                                v-model="sshChoice"
                                :label="$t('connection.ssh')"
                                :options="sshOptions"
                            />
                            <span />
                            <span class="text-on-surface-variant">{{ $t("connection.ssh.later") }}</span>
                        </TabsPanel>

                        <TabsPanel
                            class="form-grid"
                            value="options"
                        >
                            <template
                                v-for="option in (['connectTimeout', 'serverSelectionTimeout', 'maxIdleTime'] as const)"
                                :key="option"
                            >
                                <span>{{ $t(`connection.option.${option}`) }}:</span>
                                <span class="flex items-center gap-2">
                                    <input
                                        v-model="fields[option]"
                                        :data-testid="`connection-${option}`"
                                        :placeholder="$t('connection.option.default')"
                                        class="field w-24 font-mono"
                                        inputmode="decimal"
                                    />
                                    <span>{{ $t("connection.option.seconds") }}</span>
                                </span>
                            </template>
                            <span class="pt-3 border-t border-divider">{{ $t("connection.option.retryWrites") }}:</span>
                            <span class="pt-3 border-t border-divider">
                                <SwitchRoot
                                    v-model="fields.retryWrites"
                                    :label="$t('connection.option.retryWrites')"
                                >
                                    <SwitchTrack class="switch-track">
                                        <SwitchThumb class="switch-thumb" />
                                    </SwitchTrack>
                                </SwitchRoot>
                            </span>
                        </TabsPanel>
                    </div>
                </TabsRoot>

                <div class="flex justify-end gap-2">
                    <ButtonRoot
                        @click="test"
                        :disabled="busy"
                        class="btn-secondary"
                        data-testid="connection-test"
                    >
                        <ButtonContent>{{ $t(busy ? "connection.busy" : "connection.test") }}</ButtonContent>
                    </ButtonRoot>
                    <FormError
                        :kind="notice?.ok ? 'success' : 'error'"
                        :text="notice?.text"
                        data-testid="connection-notice"
                    />
                    <!-- v0 buttons are never of type "submit": Enter in a field submits the form, the click saves. -->
                    <ButtonRoot
                        @click="save(true)"
                        :disabled="busy"
                        class="btn-primary"
                        data-testid="connection-save-connect"
                    >
                        <ButtonContent>{{ $t("connection.saveConnect") }}</ButtonContent>
                    </ButtonRoot>
                    <ButtonRoot
                        @click="save()"
                        :disabled="busy"
                        class="btn-secondary"
                        data-testid="connection-save"
                    >
                        <ButtonContent>{{ $t("action.save") }}</ButtonContent>
                    </ButtonRoot>
                    <DialogClose class="btn-secondary">
                        {{ $t("action.cancel") }}
                    </DialogClose>
                </div>
            </form>
        </DialogContent>
    </DialogRoot>
</template>
