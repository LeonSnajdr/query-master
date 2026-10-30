<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { useConfirmed } from "@/composables/clipboard";
import type { NoticeAction } from "@/composables/notices";
import CopiedLabel from "./CopiedLabel.vue";

const emit = defineEmits<{
    /** It ran and does not keep its card. */
    done: [];
}>();
/** A button of a notice, in its card and in the list behind the bell; "Copy" says "Copied" after. */
const props = defineProps<{
    action: NoticeAction;
}>();
const { confirmed, run } = useConfirmed();

async function act() {
    // A failed copy says nothing: no "Copied" that is not true.
    await run(props.action.run).catch(() => undefined);
    if (!props.action.keep) emit("done");
}
</script>

<template>
    <ButtonRoot
        @click="act"
        data-testid="notice-action"
    >
        <ButtonContent>
            <CopiedLabel
                v-if="action.copies"
                :copied="confirmed"
                :label="action.label"
            />
            <template v-else>
                {{ action.label }}
            </template>
        </ButtonContent>
    </ButtonRoot>
</template>
