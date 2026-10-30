<script setup lang="ts">
import { computed } from "vue";
import type { HTMLAttributes } from "vue";
import { useI18n } from "vue-i18n";
import { notePathLabel, useNotesStore } from "@/stores/notes";
import type { NotePlace } from "@/stores/notes";

/**
 * The icon of a row (connection, database, collection) with its read-only mark over the lower left,
 * Draws it: a filled lock when the row is marked read-only, faint when it takes
 * read-only from a row above, an open lock when it is marked writable below a read-only row.
 */
const props = defineProps<{
    /** The icon class and its color. */
    icon: HTMLAttributes["class"];
    place: NotePlace;
    title?: string;
}>();

const { t } = useI18n();
const notes = useNotesStore();
const mark = computed(() => {
    const own = notes.noteOf(props.place)?.readonly;
    if (own === true) return { state: "own", icon: "i-app-lock text-warning", title: t("note.readonly") };
    if (own === false) return { state: "writable", icon: "i-lucide-lock-open text-success", title: t("note.readonly.writable") };
    const source = notes.readonlySource(props.place);
    if (!source.readonly || source.from === undefined) return undefined;
    const name = notePathLabel(source.from);
    return {
        state: "inherited",
        icon: "i-app-lock text-warning/50",
        title: name === undefined ? t("note.readonly.inherited.connection") : t("note.readonly.inherited", { name })
    };
});
</script>

<template>
    <span class="relative size-4 shrink-0">
        <span
            :class="icon"
            :title
            class="size-4 block"
        />
        <span
            v-if="mark"
            :class="mark.icon"
            :data-state="mark.state"
            :title="mark.title"
            class="absolute -left-0.5 -bottom-0.5 size-2.5"
            data-testid="note-readonly"
        />
    </span>
</template>
