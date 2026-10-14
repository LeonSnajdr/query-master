<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import { useId } from "vue";
import IconButton from "@/components/IconButton.vue";
import type { RoleRef } from "@/shell/users";

/** Rows of roles, each a name and the database it is defined in; for users and inherited roles. */
defineProps<{
    /** Role names to suggest. */
    roleNames: string[];
    /** Database names to suggest. */
    databases: string[];
}>();
const roles = defineModel<RoleRef[]>({ required: true });

const roleList = useId();
const databaseList = useId();
</script>

<template>
    <div class="flex flex-col gap-1.5">
        <datalist :id="roleList">
            <option
                v-for="name in roleNames"
                :key="name"
                :value="name"
            />
        </datalist>
        <datalist :id="databaseList">
            <option
                v-for="name in databases"
                :key="name"
                :value="name"
            />
        </datalist>
        <div
            v-for="(row, position) in roles"
            :key="position"
            class="flex items-center gap-1.5"
            data-testid="role-row"
        >
            <input
                v-model="row.role"
                :aria-label="$t('users.role')"
                :list="roleList"
                :placeholder="$t('users.role')"
                class="field grow"
                data-testid="role-name"
                spellcheck="false"
            />
            <span class="text-on-surface-variant">@</span>
            <input
                v-model="row.db"
                :aria-label="$t('users.roleDatabase')"
                :list="databaseList"
                :placeholder="$t('users.roleDatabase.placeholder')"
                class="field w-40"
                spellcheck="false"
            />
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
