<script setup lang="ts">
import { computed } from "vue";
import type { HTMLAttributes } from "vue";
import { useNotesStore } from "@/stores/notes";
import type { NotePlace } from "@/stores/notes";

/**
 * The icon of a row (connection, database, collection) with its read-only mark: a filled lock over
 * the lower left of the icon. Faint when the lock comes from a row above.
 */
const props = defineProps<{
    /** The icon class and its color. */
    icon: HTMLAttributes["class"];
    place: NotePlace;
    title?: string;
}>();

const notes = useNotesStore();
const own = computed(() => notes.noteOf(props.place)?.readonly === true);
const inherited = computed(() => !own.value && notes.isReadonly(props.place));
</script>

<template>
    <span class="relative size-4 shrink-0">
        <span
            :class="icon"
            :title
            class="size-4 block"
        />
        <span
            v-if="own || inherited"
            :class="own ? 'text-warning' : 'text-warning/50'"
            :data-testid="own ? 'note-readonly' : 'note-readonly-inherited'"
            :title="$t(own ? 'note.readonly' : 'note.readonlyInherited')"
            class="i-app-lock absolute -left-0.5 -bottom-0.5 size-2.5"
        />
    </span>
</template>
