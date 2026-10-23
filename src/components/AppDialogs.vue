<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogClose, DialogContent, DialogDescription, DialogRoot, DialogTitle } from "@vuetify/v0";
import { computed, shallowRef, watch } from "vue";
import { namesAsChoices } from "@/choice";
import FormError from "@/components/FormError.vue";
import ChoiceField from "@/components/ChoiceField.vue";
import CodeEditor from "@/components/CodeEditor.vue";
import CollectionDialog from "@/components/CollectionDialog.vue";
import ConnectionDialog from "@/components/ConnectionDialog.vue";
import HelpDialog from "@/components/HelpDialog.vue";
import ExportWizard from "@/components/transfer/ExportWizard.vue";
import ImportWizard from "@/components/transfer/ImportWizard.vue";
import IndexDialog from "@/components/IndexDialog.vue";
import SaveQueryDialog from "@/components/SaveQueryDialog.vue";
import SettingsDialog from "@/components/SettingsDialog.vue";
import CopiedLabel from "@/components/CopiedLabel.vue";
import { useCopy } from "@/composables/clipboard";
import { useDialogState } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";

/** The dialogs opened through `useDialogs()`: a question, a confirmation, a text, a connection. */
const { state, resolvePrompt, resolveConfirm } = useDialogState();
const { report } = useMessages();

const promptOpen = computed({ get: () => state.prompt !== undefined, set: open => !open && resolvePrompt(undefined) });
const confirmOpen = computed({ get: () => state.confirm !== undefined, set: open => !open && resolveConfirm(false) });
/** What is typed to free the button of a confirmation that asks for a name. */
const typedName = shallowRef("");
watch(() => state.confirm, () => (typedName.value = ""));
/**
 * Where the focus starts once the confirmation is drawn: in the name to type, else on Cancel. Not
 * on the dialog itself (it takes it when nothing in it does), and never on the button that writes.
 */
watch(() => state.confirm, (request) => {
    if (!request) return;
    const start = document.querySelector<HTMLElement>(request.requireName === undefined ? "[data-testid=confirm-cancel]" : "[data-testid=confirm-name]");
    start?.focus();
}, { flush: "post" });
const confirmFree = computed(() => state.confirm?.requireName === undefined || typedName.value === state.confirm.requireName);

const { copied: scriptCopied, copy: copyScriptText } = useCopy();
function copyScript() {
    void copyScriptText(state.confirm?.script ?? "");
}
/** The id of a previewed document, copied from its head; the head shows the check for that one. */
const { copied: idCopied, copy: copyIdText } = useCopy();
const copiedId = shallowRef<string>();
function copyId(id: string) {
    copiedId.value = id;
    void copyIdText(id);
}
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

/** `again`: the dialog stays open with the text it started with, for the next one (*Save and continue*). */
async function submitText(again = false) {
    const request = state.text;
    if (!request?.submit) return;
    busy.value = true;
    try {
        textError.value = await request.submit(text.value);
        if (textError.value !== undefined) return;
        if (again) text.value = request.variants?.[0]?.text ?? request.text;
        else state.text = undefined;
    } catch (error) {
        report(error);
    } finally {
        busy.value = false;
    }
}

const { copied, copy } = useCopy();
function copyText() {
    void copy(text.value);
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
        <DialogContent
            :class="state.confirm?.environment ? (state.confirm.environment.kind === 'production' ? 'border-t-3 border-t-error w-[min(92vw,38rem)]!' : 'border-t-3 border-t-warning w-[min(92vw,38rem)]!') : ''"
            class="dialog"
        >
            <div
                v-if="state.confirm"
                class="flex flex-col gap-4"
            >
                <div class="flex items-center gap-2.5">
                    <span
                        v-if="state.confirm.environment"
                        :class="[state.confirm.deleting ? 'i-lucide-trash-2' : 'i-lucide-triangle-alert', state.confirm.environment.kind === 'production' ? 'text-error' : 'text-warning']"
                        aria-hidden="true"
                        class="size-5 shrink-0"
                    />
                    <DialogTitle class="dialog-title">
                        {{ state.confirm.title }}
                    </DialogTitle>
                    <span
                        v-if="state.confirm.environment"
                        :class="state.confirm.environment.kind === 'production' ? 'bg-error/15 text-error' : 'bg-warning/15 text-warning'"
                        class="ml-auto shrink-0 max-w-[45%] truncate px-2 rounded-sm text-[11.5px] leading-5"
                        data-testid="confirm-environment"
                    >
                        {{ state.confirm.environment.name ? `${state.confirm.environment.name} · ` : "" }}{{ $t(`environment.${state.confirm.environment.kind}`) }}
                    </span>
                </div>
                <DialogDescription
                    v-if="state.confirm.summary"
                    class="m-0 -mt-2 text-[13px] text-on-surface break-words"
                    data-testid="confirm-summary"
                >
                    <I18nT
                        :keypath="state.confirm.summary.keypath"
                        :plural="state.confirm.summary.plural"
                        scope="global"
                        tag="span"
                    >
                        <template
                            v-for="(value, key) in state.confirm.summary.values"
                            :key="key"
                            #[key]
                        >
                            <span :class="key === 'command' ? 'text-on-surface-variant' : 'text-on-surface-strong'">{{ value }}</span>
                        </template>
                    </I18nT>
                </DialogDescription>
                <DialogDescription
                    v-else
                    class="m-0 text-sm text-on-surface"
                    data-testid="confirm-text"
                >
                    {{ state.confirm.text }}
                </DialogDescription>
                <div
                    v-if="state.confirm.changes?.length"
                    class="flex flex-col gap-2"
                    data-testid="confirm-changes"
                >
                    <span
                        v-if="state.confirm.more"
                        class="text-[12px] text-on-surface-variant"
                    >{{ $t("guard.previewFirst", { count: state.confirm.changes.length }) }}</span>
                    <div class="max-h-64 overflow-auto flex flex-col gap-2">
                        <div
                            v-for="(change, index) in state.confirm.changes"
                            :key="index"
                            class="rounded-sm border border-divider"
                        >
                            <div class="h-7 pl-3 pr-1 flex items-center gap-2 border-b border-divider font-mono text-[12px] text-on-surface-variant">
                                <span class="truncate">_id: {{ change.id }}</span>
                                <ButtonRoot
                                    @click="copyId(change.id)"
                                    :aria-label="$t('action.copy')"
                                    :title="$t('action.copy')"
                                    class="ml-auto size-6 shrink-0 inline-flex items-center justify-center rounded-sm hover:bg-surface-variant"
                                >
                                    <ButtonContent>
                                        <span
                                            :class="idCopied && copiedId === change.id ? 'i-lucide-check text-success' : 'i-lucide-copy'"
                                            class="block size-3.5"
                                        />
                                    </ButtonContent>
                                </ButtonRoot>
                            </div>
                            <div
                                v-if="change.removed !== undefined"
                                class="p-2"
                            >
                                <div class="px-2 py-0.5 rounded-sm bg-error/12 text-error font-mono text-[12px] break-all">
                                    − {{ change.removed }}
                                </div>
                            </div>
                            <div
                                v-else
                                class="p-2 pl-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 items-start font-mono text-[12px]"
                            >
                                <template
                                    v-for="field in change.fields"
                                    :key="field.field"
                                >
                                    <span class="pt-0.5 text-on-surface-variant">{{ field.field }}</span>
                                    <div class="flex flex-col gap-0.5">
                                        <span class="px-2 py-0.5 rounded-sm bg-error/12 text-error break-all">− {{ field.before }}</span>
                                        <span class="px-2 py-0.5 rounded-sm bg-success/12 text-success break-all">+ {{ field.after }}</span>
                                    </div>
                                </template>
                                <span
                                    v-if="change.fields.length === 0"
                                    class="col-span-2 font-sans text-on-surface-variant"
                                >{{ $t("guard.noFields") }}</span>
                            </div>
                        </div>
                    </div>
                    <span
                        v-if="state.confirm.more"
                        class="text-[12px] text-on-surface-variant"
                    >{{ $t("guard.more", { count: state.confirm.more.toLocaleString($i18n.locale) }, state.confirm.more) }}</span>
                </div>
                <label
                    v-if="state.confirm.requireName !== undefined"
                    class="flex flex-col gap-1 text-[13px] text-on-surface"
                >
                    <I18nT
                        keypath="confirm.typeName"
                        scope="global"
                        tag="span"
                    >
                        <template #name>
                            <strong class="font-mono">{{ state.confirm.requireName }}</strong>
                        </template>
                    </I18nT>
                    <input
                        v-model="typedName"
                        @keydown.enter.prevent="confirmFree && resolveConfirm(true)"
                        class="field font-mono"
                        data-testid="confirm-name"
                        spellcheck="false"
                    />
                </label>
                <div class="flex justify-end gap-2">
                    <ButtonRoot
                        v-if="state.confirm.script"
                        @click="copyScript"
                        class="btn-ghost mr-auto"
                        data-testid="confirm-script"
                    >
                        <ButtonContent>
                            <CopiedLabel
                                :copied="scriptCopied"
                                :label="$t('confirm.copyScript')"
                            />
                        </ButtonContent>
                    </ButtonRoot>
                    <DialogClose
                        class="btn-ghost"
                        data-testid="confirm-cancel"
                    >
                        {{ $t("action.cancel") }}
                    </DialogClose>
                    <ButtonRoot
                        @click="confirmFree && resolveConfirm(true)"
                        :class="state.confirm.environment?.kind === 'test' ? 'btn-base bg-warning text-on-warning font-semibold' : 'btn-danger'"
                        :disabled="!confirmFree"
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
                        @run="submitText()"
                        :label="state.text.title"
                        :readonly="!state.text.action"
                        findBar
                    />
                </div>
                <div class="flex justify-end gap-2">
                    <ButtonRoot
                        @click="copyText"
                        class="btn-secondary"
                    >
                        <ButtonContent>
                            <CopiedLabel :copied />
                        </ButtonContent>
                    </ButtonRoot>
                    <FormError
                        :text="textError"
                        data-testid="text-error"
                    />
                    <DialogClose class="btn-ghost">
                        {{ $t(state.text.action ? "action.cancel" : "action.close") }}
                    </DialogClose>
                    <ButtonRoot
                        v-if="state.text.again"
                        @click="submitText(true)"
                        :disabled="busy"
                        class="btn-secondary"
                        data-testid="text-submit-again"
                    >
                        <ButtonContent>{{ state.text.again }}</ButtonContent>
                    </ButtonRoot>
                    <ButtonRoot
                        v-if="state.text.action"
                        @click="submitText()"
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
        :clone="state.connectionClone"
        :group="state.connectionGroup"
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
    <SaveQueryDialog
        v-model="state.saveQueryOpen"
        :tabId="state.saveQueryTab"
    />
    <ExportWizard />
    <ImportWizard />
    <SettingsDialog
        v-model="state.settingsOpen"
        v-model:page="state.settingsPage"
    />
    <HelpDialog v-model="state.help" />
</template>
