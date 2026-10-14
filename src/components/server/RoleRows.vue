<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { computed } from "vue";
import { namesAsChoices } from "@/choice";
import ChoiceField from "@/components/ChoiceField.vue";
import IconButton from "@/components/IconButton.vue";
import type { RoleRef } from "@/shell/users";

/** Rows of roles, each a name and the database it is defined in; for users and inherited roles. */
const props = defineProps<{
    /** Role names to suggest. */
    roleNames: string[];
    /** Database names to suggest. */
    databases: string[];
}>();
const roles = defineModel<RoleRef[]>({ required: true });

const roleChoices = computed(() => namesAsChoices(props.roleNames));
const databaseChoices = computed(() => namesAsChoices(props.databases));
</script>

<template>
    <div class="flex flex-col gap-1.5">
        <div
            v-for="(row, position) in roles"
            :key="position"
            class="flex items-center gap-1.5"
            data-testid="role-row"
        >
            <div class="grow min-w-0">
                <ChoiceField
                    v-model="row.role"
                    :label="$t('users.role')"
                    :options="roleChoices"
                    :placeholder="$t('users.role')"
                    data-testid="role-name"
                    free
                />
            </div>
            <span class="text-on-surface-variant">@</span>
            <div class="w-40 shrink-0">
                <ChoiceField
                    v-model="row.db"
                    :label="$t('users.roleDatabase')"
                    :options="databaseChoices"
                    :placeholder="$t('users.roleDatabase.placeholder')"
                    free
                />
            </div>
            <IconButton
                @click="roles.splice(position, 1)"
                :label="$t('users.removeRole')"
                icon="i-lucide-x"
            />
        </div>
        <ButtonRoot
            @click="roles.push({ role: '', db: '' })"
            class="btn-ghost self-start"
            data-testid="role-add"
        >
            <ButtonContent class="inline-flex items-center gap-1.5">
                <span class="i-lucide-plus" />{{ $t("users.addRole") }}
            </ButtonContent>
        </ButtonRoot>
    </div>
</template>
