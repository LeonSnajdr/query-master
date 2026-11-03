<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogClose, DialogContent, DialogRoot, DialogTitle } from "@vuetify/v0";
import { computed, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import ChoiceField from "@/components/ChoiceField.vue";
import FormError from "@/components/FormError.vue";
import { DRAFT_TYPES, EMPTY_TYPES, fromDraft, toDraft } from "@/shell/edit";
import type { Json, ValueType } from "@/shell/ejson";
import { FIELD_CONDITIONS, hasCondition, joinPath, nameProblem, scopesFor } from "@/shell/fields";
import type { FieldChange, FieldCondition, FieldScope, FieldTarget } from "@/shell/fields";
import { parseValue } from "@/shell/parse";

/** What the dialog is opened for: add, change, rename or remove a field, or append to an array. */
export interface FieldRequest {
    mode: "add" | "edit" | "rename" | "remove" | "push";
    /** Dotted path of the document or array the field lies in; empty for the document itself. */
    parent: string;
    /** The field's name; empty when adding. */
    name: string;
    /** The value shown first (edit), or the one an added value starts from. */
    value?: Json;
    target: FieldTarget;
}

/**
 * The field dialogs in one: *Add field*, *Edit value*, *Rename field*, *Delete field*
 * and *Add element to array*, each with *Where* (one document, the selected ones, all of the query,
 * all of the collection) and for setting a value in many documents a condition on the field.
 * `submit` sends the change; what it returns is shown and the dialog stays open.
 */
const props = defineProps<{
    request?: FieldRequest;
    submit: (change: FieldChange, scope: FieldScope, condition: FieldCondition) => Promise<string | undefined>;
}>();
const open = defineModel<boolean>({ default: false });

const { t } = useI18n();

const name = shallowRef("");
const type = shallowRef<ValueType>("string");
const text = shallowRef("");
const scope = shallowRef<FieldScope>("single");
const condition = shallowRef<FieldCondition>("always");
const busy = shallowRef(false);
const error = shallowRef<string>();

watch(open, (isOpen) => {
    const request = props.request;
    if (!isOpen || !request) return;
    name.value = request.name;
    const draft = toDraft(request.value ?? "");
    type.value = request.value === undefined ? "string" : draft.type;
    text.value = request.value === undefined ? "" : draft.text;
    scope.value = "single";
    condition.value = "always";
    error.value = undefined;
});

const kind = computed<FieldChange["kind"]>(() => {
    switch (props.request?.mode) {
        case "rename": return "rename";
        case "remove": return "unset";
        case "push": return "push";
        default: return "set";
    }
});
const withValue = computed(() => kind.value === "set" || kind.value === "push");
/** The name is typed when adding and renaming; for the rest it is the field's own. */
const nameEditable = computed(() => props.request?.mode === "add" || props.request?.mode === "rename");
const path = computed(() => joinPath(props.request?.parent ?? "", props.request?.name ?? ""));

const typeOptions = computed(() => [...DRAFT_TYPES.main, ...DRAFT_TYPES.more]
    .filter((item): item is ValueType => item !== "separator")
    .map(value => ({ value, label: t(`edit.types.${value}`) })));
const scopeOptions = computed(() => (props.request ? scopesFor(props.request.target, kind.value) : ["single" as const])
    .map(value => ({ value, label: t(`field.scope.${value}`, { count: props.request?.target.selected.length ?? 0 }) })));
const conditionOptions = computed(() => FIELD_CONDITIONS.map(value => ({ value, label: t(`field.condition.${value}`) })));
const showCondition = computed(() => hasCondition(kind.value, scope.value));
const noText = computed(() => EMPTY_TYPES.includes(type.value));

/** The change the dialog stands for; throws with a message the dialog shows. */
function change(): FieldChange {
    const request = props.request!;
    if (nameEditable.value) {
        const problem = nameProblem(name.value);
        if (problem) throw new Error(t(problem));
    }
    const value = withValue.value ? parseValue(fromDraft({ type: type.value, text: text.value })) : undefined;
    switch (kind.value) {
        case "rename": return { kind: "rename", path: path.value, to: joinPath(request.parent, name.value.trim()) };
        case "unset": return { kind: "unset", path: path.value };
        case "push": return { kind: "push", path: path.value, value: value! };
        default: return { kind: "set", path: request.mode === "add" ? joinPath(request.parent, name.value.trim()) : path.value, value: value! };
    }
}

async function save() {
    let made: FieldChange;
    try {
        made = change();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        return;
    }
    busy.value = true;
    try {
        error.value = await props.submit(made, scope.value, condition.value);
        if (error.value === undefined) open.value = false;
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <DialogRoot v-model="open">
        <DialogContent class="dialog w-[min(94vw,42rem)]!">
            <form
                v-if="request"
                @submit.prevent="save"
                class="flex flex-col gap-4"
                data-testid="field-dialog"
            >
                <DialogTitle class="dialog-title">
                    {{ $t(`field.title.${request.mode}`) }}
                </DialogTitle>
                <p
                    v-if="request.mode === 'remove'"
                    class="m-0 text-[13px]"
                >
                    {{ $t("field.removeText", { name: path }) }}
                </p>
                <div class="form-grid grid-cols-[7rem_1fr]! text-[13px]">
                    <template v-if="request.mode !== 'remove'">
                        <span>{{ $t("field.parent") }}:</span>
                        <input
                            :value="request.parent || $t('field.parent.none')"
                            class="field font-mono opacity-60"
                            disabled
                        />
                        <span>{{ $t(request.mode === "push" ? "field.array" : "field.name") }}:</span>
                        <input
                            v-model="name"
                            :class="nameEditable ? '' : 'opacity-60'"
                            :disabled="!nameEditable"
                            class="field font-mono"
                            data-testid="field-name"
                            spellcheck="false"
                        />
                    </template>
                    <template v-if="withValue">
                        <span>{{ $t("field.type") }}:</span>
                        <ChoiceField
                            v-model="type"
                            :label="$t('field.type')"
                            :options="typeOptions"
                            data-testid="field-type"
                        />
                        <span class="self-start pt-1.5">{{ $t("field.value") }}:</span>
                        <textarea
                            v-model="text"
                            :class="noText ? 'opacity-60' : ''"
                            :disabled="noText"
                            class="field h-24! py-1.5 font-mono resize-none"
                            data-testid="field-value"
                            spellcheck="false"
                        />
                    </template>
                    <span>{{ $t("field.where") }}:</span>
                    <span class="min-w-0 flex gap-2">
                        <span class="grow min-w-0">
                            <ChoiceField
                                v-model="scope"
                                :disabled="scopeOptions.length === 1"
                                :label="$t('field.where')"
                                :options="scopeOptions"
                                data-testid="field-scope"
                            />
                        </span>
                        <span
                            v-if="showCondition"
                            class="w-48 shrink-0"
                        >
                            <ChoiceField
                                v-model="condition"
                                :label="$t('field.condition')"
                                :options="conditionOptions"
                                data-testid="field-condition"
                            />
                        </span>
                    </span>
                </div>
                <div class="flex gap-2">
                    <FormError
                        :text="error"
                        data-testid="field-error"
                    />
                    <DialogClose class="btn-ghost">
                        {{ $t("action.cancel") }}
                    </DialogClose>
                    <ButtonRoot
                        @click="save"
                        :class="request.mode === 'remove' ? 'btn-danger' : 'btn-primary'"
                        :disabled="busy"
                        data-testid="field-submit"
                    >
                        <ButtonContent>{{ $t(request.mode === "remove" ? "action.delete" : "action.save") }}</ButtonContent>
                    </ButtonRoot>
                </div>
            </form>
        </DialogContent>
    </DialogRoot>
</template>
