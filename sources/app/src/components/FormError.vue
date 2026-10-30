<script setup lang="ts">
import { shallowRef, watch } from "vue";
import IconButton from "@/components/IconButton.vue";
import { useCopy } from "@/composables/clipboard";

/**
 * What a dialog says after its action, in its footer beside the buttons: one line in the row they
 * stand in, so nothing moves when it comes or goes. A long text is cut; a click on it shows it
 * whole, the button copies it. Problems of one field belong under that field, not here.
 */
const props = withDefaults(defineProps<{
    text?: string;
    kind?: "error" | "success";
}>(), { text: undefined, kind: "error" });

// A test id goes to the text itself.
defineOptions({ inheritAttrs: false });

const whole = shallowRef(false);
watch(() => props.text, () => (whole.value = false));
const { copied, copy } = useCopy();
</script>

<template>
    <span class="min-w-0 flex-1 flex items-center gap-1 self-center">
        <template v-if="text">
            <span
                :class="kind === 'error' ? 'i-lucide-circle-alert text-error' : 'i-lucide-circle-check text-success'"
                class="size-4 shrink-0"
            />
            <!-- Read out as it comes; the whole text also as tooltip. -->
            <span
                @click="whole = !whole"
                :class="[kind === 'error' ? 'text-error' : 'text-success', whole ? 'whitespace-pre-wrap break-words max-h-24 overflow-y-auto select-text' : 'truncate']"
                :role="kind === 'error' ? 'alert' : 'status'"
                :title="text"
                class="min-w-0 text-[13px] cursor-default"
                data-testid="form-error"
                v-bind="$attrs"
            >{{ text }}</span>
            <IconButton
                v-if="kind === 'error'"
                @click="copy(text)"
                :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                :label="$t(copied ? 'action.copied' : 'action.copy')"
                :tint="copied ? 'text-success' : undefined"
            />
        </template>
    </span>
</template>
