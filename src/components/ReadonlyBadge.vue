<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { notePathLabel, useNotesStore } from "@/stores/notes";
import type { NotePlace } from "@/stores/notes";

/**
 * The lock over the lower left of the icon of a row: strong when the row is
 * marked read-only, faint when it takes read-only from a row above, open when it is marked writable.
 * Sits in a `relative` box around the icon.
 */
const props = defineProps<{
    place: NotePlace;
}>();

const { t } = useI18n();
const notes = useNotesStore();
const state = computed(() => {
    const own = notes.noteOf(props.place)?.readonly;
    if (own === true) return { kind: "own", icon: "i-lucide-lock text-warning", title: t("note.readonly") };
    if (own === false) return { kind: "writable", icon: "i-lucide-lock-open text-success", title: t("note.readonly.writable") };
    const source = notes.readonlySource(props.place);
    if (!source.readonly || source.from === undefined) return undefined;
    const name = notePathLabel(source.from);
    return {
        kind: "inherited",
        icon: "i-lucide-lock text-on-surface-variant opacity-70",
        title: name === undefined ? t("note.readonly.inherited.connection") : t("note.readonly.inherited", { name })
    };
});
</script>

<template>
    <span
        v-if="state"
        :class="state.icon"
        :data-state="state.kind"
        :title="state.title"
        class="absolute -left-0.5 -bottom-0.5 size-2.5"
        data-testid="note-readonly"
    />
</template>
