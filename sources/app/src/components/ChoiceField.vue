<script setup lang="ts" generic="T extends string | number">
import type { Choice } from "@/choice";
import ChoiceInput from "./choice/ChoiceInput.vue";
import ChoiceSelect from "./choice/ChoiceSelect.vue";

/**
 * Every choice of the app, drawn as a select: a field with a chevron, below
 * it a list as wide as the field, the current entry marked. Fixed (`free` off) allows only the
 * entries; free allows any text and suggests the entries containing it. Attributes go to the
 * field itself (the button, or the input when free).
 */
withDefaults(defineProps<{
    options: Choice<T>[];
    label: string;
    /** Any text, the entries are suggestions; the value is then a string. */
    free?: boolean;
    /** `compact` for table cells (28 px), `normal` for dialogs (32 px). */
    size?: "normal" | "compact";
    /** Suggestions are still being read. */
    loading?: boolean;
    placeholder?: string;
    disabled?: boolean;
    /** Free only: shows "new" in the field while its text is none of the entries. */
    markNew?: boolean;
}>(), { size: "normal", placeholder: "" });
const model = defineModel<T>({ required: true });
defineOptions({ inheritAttrs: false });

</script>

<template>
    <ChoiceInput
        v-if="free"
        @update:modelValue="value => (model = value as T)"
        v-bind="$attrs"
        :compact="size === 'compact'"
        :disabled
        :label
        :loading
        :markNew
        :modelValue="String(model)"
        :options="options as Choice<string>[]"
        :placeholder
    />
    <div
        v-else
        class="w-full"
        data-testid="choice-field"
    >
        <ChoiceSelect
            v-bind="$attrs"
            v-model="model"
            :compact="size === 'compact'"
            :disabled
            :label
            :loading
            :options
            :placeholder
        />
    </div>
</template>
