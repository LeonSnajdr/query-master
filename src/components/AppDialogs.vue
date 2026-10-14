<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogClose, DialogContent, DialogDescription, DialogRoot, DialogTitle, useTimer } from "@vuetify/v0";
import { computed, shallowRef, watch } from "vue";
import CodeEditor from "@/components/CodeEditor.vue";
import CollectionDialog from "@/components/CollectionDialog.vue";
import ConnectionDialog from "@/components/ConnectionDialog.vue";
import { useDialogState } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";

/** The dialogs opened through `useDialogs()`: a question, a confirmation, a text, a connection. */
const { state, resolvePrompt, resolveConfirm } = useDialogState();
const { report } = useMessages();

const promptOpen = computed({ get: () => state.prompt !== undefined, set: open => !open && resolvePrompt(undefined) });
const confirmOpen = computed({ get: () => state.confirm !== undefined, set: open => !open && resolveConfirm(false) });
const textOpen = computed({ get: () => state.text !== undefined, set: open => !open && (state.text = undefined) });

const answer = shallowRef("");
watch(() => state.prompt, request => (answer.value = request?.value ?? ""));

const text = shallowRef("");
const textError = shallowRef<string>();
const busy = shallowRef(false);
watch(() => state.text, (request) => {
    text.value = request?.text ?? "";
    textError.value = undefined;
});

async function submitText() {
    const request = state.text;
    if (!request?.submit) return;
    busy.value = true;
    try {
        textError.value = await request.submit(text.value);
        if (textError.value === undefined) state.text = undefined;
    } catch (error) {
        report(error);
    } finally {
        busy.value = false;
    }
}

const copied = shallowRef(false);
const copiedTimer = useTimer(() => (copied.value = false), { duration: 1500 });

async function copyText() {
    await navigator.clipboard.writeText(text.value).catch(report);
    copied.value = true;
    copiedTimer.start();
}
</script>

<template>
    <DialogRoot v-model="promptOpen">
        <DialogContent class="dialog">
            <form
                v-if="state.prompt"
                @submit.prevent="resolvePrompt(answer.trim() || undefined)"
                class="flex flex-col gap-4"
            >
                <DialogTitle class="dialog-title">
                    {{ state.prompt.title }}
                </DialogTitle>
                <label class="flex flex-col gap-1.5">
                    <span class="text-sm text-on-surface-variant">{{ state.prompt.label }}</span>
                    <input
                        v-model="answer"
                        :class="state.prompt.code ? 'font-mono' : ''"
                        autocapitalize="off"
                        class="field"
                        data-testid="prompt-input"
                        spellcheck="false"
                        type="text"
                    />
                </label>
                <div class="flex justify-end gap-2">
                    <DialogClose class="btn-ghost">
                        {{ $t("action.cancel") }}
                    </DialogClose>
                    <!-- v0 buttons are never of type "submit": Enter in the field submits the form, the click answers. -->
                    <ButtonRoot
                        @click="resolvePrompt(answer.trim() || undefined)"
                        :disabled="!answer.trim()"
                        class="btn-primary"
                        data-testid="prompt-submit"
                    >
                        <ButtonContent>{{ state.prompt.action }}</ButtonContent>
                    </ButtonRoot>
                </div>
            </form>
        </DialogContent>
    </DialogRoot>

    <DialogRoot v-model="confirmOpen">
        <!-- No display class on the dialog itself: it would show the closed dialog. -->
        <DialogContent class="dialog">
            <div
                v-if="state.confirm"
                class="flex flex-col gap-4"
            >
                <DialogTitle class="dialog-title">
                    {{ state.confirm.title }}
                </DialogTitle>
                <DialogDescription class="m-0 text-sm text-on-surface">
                    {{ state.confirm.text }}
                </DialogDescription>
                <div class="flex justify-end gap-2">
                    <DialogClose class="btn-ghost">
                        {{ $t("action.cancel") }}
                    </DialogClose>
                    <ButtonRoot
                        @click="resolveConfirm(true)"
                        class="btn-danger"
                        data-testid="confirm-action"
                    >
                        <ButtonContent>{{ state.confirm.action }}</ButtonContent>
                    </ButtonRoot>
                </div>
            </div>
        </DialogContent>
    </DialogRoot>

    <DialogRoot v-model="textOpen">
        <DialogContent class="dialog w-[min(94vw,56rem)]!">
            <div
                v-if="state.text"
                class="flex flex-col gap-3"
            >
                <DialogTitle class="dialog-title">
                    {{ state.text.title }}
                </DialogTitle>
                <div class="h-[min(60vh,34rem)] rounded border border-divider bg-background">
                    <CodeEditor
                        :key="state.text.title + state.text.text.length"
                        v-model="text"
                        @run="submitText"
                        :label="state.text.title"
                        :readonly="!state.text.action"
                    />
                </div>
                <p
                    v-if="textError"
                    class="m-0 text-sm text-error break-words"
                    data-testid="text-error"
                    role="alert"
                >
                    {{ textError }}
                </p>
                <div class="flex justify-end gap-2">
                    <ButtonRoot
                        @click="copyText"
                        class="btn-secondary mr-auto"
                    >
                        <ButtonContent>{{ $t(copied ? "action.copied" : "action.copy") }}</ButtonContent>
                    </ButtonRoot>
                    <DialogClose class="btn-ghost">
                        {{ $t(state.text.action ? "action.cancel" : "action.close") }}
                    </DialogClose>
                    <ButtonRoot
                        v-if="state.text.action"
                        @click="submitText"
                        :disabled="busy"
                        class="btn-primary"
                        data-testid="text-submit"
                    >
                        <ButtonContent>{{ state.text.action }}</ButtonContent>
                    </ButtonRoot>
                </div>
            </div>
        </DialogContent>
    </DialogRoot>

    <ConnectionDialog
        v-model="state.connectionOpen"
        :profile="state.connection"
    />
    <CollectionDialog
        v-model="state.collectionOpen"
        :request="state.collection"
    />
</template>
