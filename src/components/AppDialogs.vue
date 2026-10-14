<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogClose, DialogContent, DialogDescription, DialogRoot, DialogTitle, useTimer } from "@vuetify/v0";
import { computed, shallowRef, watch } from "vue";
import { namesAsChoices } from "@/choice";
import ChoiceField from "@/components/ChoiceField.vue";
import CodeEditor from "@/components/CodeEditor.vue";
import CollectionDialog from "@/components/CollectionDialog.vue";
import ConnectionDialog from "@/components/ConnectionDialog.vue";
import HelpDialog from "@/components/HelpDialog.vue";
import TaskProgress from "@/components/TaskProgress.vue";
import ExportWizard from "@/components/transfer/ExportWizard.vue";
import ImportWizard from "@/components/transfer/ImportWizard.vue";
import IndexDialog from "@/components/IndexDialog.vue";
import SettingsDialog from "@/components/SettingsDialog.vue";
import { useDialogState } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";

/** The dialogs opened through `useDialogs()`: a question, a confirmation, a text, a connection. */
const { state, resolvePrompt, resolveConfirm } = useDialogState();
const { report } = useMessages();

const promptOpen = computed({ get: () => state.prompt !== undefined, set: open => !open && resolvePrompt(undefined) });
const confirmOpen = computed({ get: () => state.confirm !== undefined, set: open => !open && resolveConfirm(false) });
const textOpen = computed({ get: () => state.text !== undefined, set: open => !open && (state.text = undefined) });

const answer = shallowRef("");
const suggestions = computed(() => namesAsChoices(state.prompt?.suggestions ?? []));
watch(() => state.prompt, request => (answer.value = request?.value ?? ""));

const text = shallowRef("");
const textError = shallowRef<string>();
const busy = shallowRef(false);
const variant = shallowRef(0);
watch(() => state.text, (request) => {
    text.value = request?.variants?.[0]?.text ?? request?.text ?? "";
    textError.value = undefined;
    variant.value = 0;
});

function showVariant(index: number) {
    variant.value = index;
    text.value = state.text?.variants?.[index]?.text ?? text.value;
}

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
                <div
                    v-if="state.prompt.suggestions"
                    class="flex flex-col gap-1.5"
                >
                    <span class="text-sm text-on-surface-variant">{{ state.prompt.label }}</span>
                    <ChoiceField
                        v-model="answer"
                        :class="state.prompt.code ? 'font-mono' : ''"
                        :label="state.prompt.label"
                        :options="suggestions"
                        data-testid="prompt-input"
                        free
                    />
                </div>
                <label
                    v-else
                    class="flex flex-col gap-1.5"
                >
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
                <div
                    v-if="state.text.variants"
                    :aria-label="state.text.title"
                    class="flex border-b border-divider"
                    role="group"
                >
                    <ButtonRoot
                        v-for="(item, index) in state.text.variants"
                        :key="item.label"
                        @click="showVariant(index)"
                        :class="variant === index ? 'text-primary border-primary' : 'text-on-surface border-transparent hover:text-on-surface-strong'"
                        :data-testid="`text-variant-${index}`"
                        class="h-8 px-3 text-[13px] border-b-2"
                    >
                        <ButtonContent>{{ item.label }}</ButtonContent>
                    </ButtonRoot>
                </div>
                <div class="h-[min(60vh,34rem)] rounded border border-divider bg-background">
                    <CodeEditor
                        :key="state.text.title + state.text.text.length + variant"
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
    <IndexDialog
        v-model="state.indexOpen"
        :request="state.index"
    />
    <TaskProgress />
    <ExportWizard />
    <ImportWizard />
    <SettingsDialog
        v-model="state.settingsOpen"
        v-model:page="state.settingsPage"
    />
    <HelpDialog v-model="state.help" />
</template>
