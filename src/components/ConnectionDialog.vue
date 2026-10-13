<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogClose, DialogContent, DialogRoot, DialogTitle } from "@vuetify/v0";
import { shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { backend, errorMessage } from "@/api";
import type { Profile } from "@/api";
import { useMessages } from "@/composables/messages";
import { useConnectionsStore } from "@/stores/connections";

/** Creates a connection, or changes the one given. */
const props = defineProps<{
    profile?: Profile;
}>();
const open = defineModel<boolean>({ default: false });

const { t } = useI18n();
const { say } = useMessages();
const connections = useConnectionsStore();
const name = shallowRef("");
const uri = shallowRef("");
const busy = shallowRef(false);
/** Outcome of the last test or failed save. */
const notice = shallowRef<{ ok: boolean; text: string }>();

function fail(error: unknown) {
    notice.value = { ok: false, text: say(errorMessage(error)) };
}

watch(open, async (isOpen) => {
    if (!isOpen) return;
    notice.value = undefined;
    name.value = props.profile?.name ?? "";
    uri.value = props.profile ? "" : "mongodb://localhost:27017";
    if (!props.profile) return;
    try {
        uri.value = await backend.connectionUri(props.profile.id);
    } catch (error) {
        fail(error);
    }
});

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

async function save() {
    busy.value = true;
    try {
        await connections.save({ id: props.profile?.id, name: name.value.trim() || t("connection.unnamed"), uri: uri.value });
        open.value = false;
    } catch (error) {
        fail(error);
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <DialogRoot v-model="open">
        <DialogContent class="dialog">
            <form
                @submit.prevent="save"
                class="flex flex-col gap-4"
            >
                <DialogTitle class="dialog-title">
                    {{ $t(profile ? "connection.edit.title" : "connection.new.title") }}
                </DialogTitle>

                <label class="flex flex-col gap-1.5">
                    <span class="text-sm text-on-surface-variant">{{ $t("connection.field.name") }}</span>
                    <input
                        v-model="name"
                        :placeholder="$t('connection.field.name.placeholder')"
                        class="field"
                        data-testid="connection-name"
                        type="text"
                    />
                </label>

                <label class="flex flex-col gap-1.5">
                    <span class="text-sm text-on-surface-variant">{{ $t("connection.field.uri") }}</span>
                    <textarea
                        v-model="uri"
                        autocapitalize="off"
                        class="field h-auto py-2 font-mono resize-y"
                        data-testid="connection-uri"
                        placeholder="mongodb+srv://user:password@cluster.example.net/"
                        rows="3"
                        spellcheck="false"
                    />
                    <span class="text-xs text-on-surface-variant">{{ $t("connection.field.uri.hint") }}</span>
                </label>

                <p
                    v-if="notice"
                    :class="notice.ok ? 'text-success' : 'text-error'"
                    class="m-0 text-sm break-words"
                    data-testid="connection-notice"
                >
                    {{ notice.text }}
                </p>

                <div class="flex justify-end gap-2">
                    <ButtonRoot
                        @click="test"
                        :disabled="busy || !uri.trim()"
                        class="btn-secondary mr-auto"
                        data-testid="connection-test"
                    >
                        <ButtonContent>{{ $t(busy ? "connection.busy" : "connection.test") }}</ButtonContent>
                    </ButtonRoot>
                    <DialogClose class="btn-ghost">
                        {{ $t("action.cancel") }}
                    </DialogClose>
                    <!-- v0 buttons are never of type "submit": Enter in a field submits the form, the click saves. -->
                    <ButtonRoot
                        @click="save"
                        :disabled="busy || !uri.trim()"
                        class="btn-primary"
                        data-testid="connection-save"
                    >
                        <ButtonContent>{{ $t("action.save") }}</ButtonContent>
                    </ButtonRoot>
                </div>
            </form>
        </DialogContent>
    </DialogRoot>
</template>
