<script setup lang="ts">
import { computed } from "vue";
import { useNotesStore } from "@/stores/notes";
import type { NotePlace } from "@/stores/notes";

/** What a row of the tree carries behind its name: its comment, and a lock when it is read-only. */
const props = defineProps<{
    place: NotePlace;
}>();

const notes = useNotesStore();
const note = computed(() => notes.noteOf(props.place));
</script>

<template>
    <span
        v-if="note?.readonly"
        :title="$t('note.readonly')"
        class="i-lucide-lock size-3 shrink-0 text-warning"
        data-testid="note-readonly"
    />
    <span
        v-if="note?.comment"
        :title="note.comment"
        class="truncate italic text-on-surface-variant"
        data-testid="note-comment"
    >{{ note.comment }}</span>
</template>
