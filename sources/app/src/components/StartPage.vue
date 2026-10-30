<script setup lang="ts">
import { ButtonContent, ButtonRoot } from "@vuetify/v0";
import ShortcutList from "@/components/ShortcutList.vue";
import { useActions } from "@/composables/actions";
import { useConnectionsStore } from "@/stores/connections";

/** The page shown at start: the saved connections and the keyboard shortcuts. */
const actions = useActions();
const connections = useConnectionsStore();
</script>

<template>
    <div class="h-full overflow-y-auto px-7 py-5 text-[13px] text-on-surface">
        <div class="max-w-[450px]">
            <h2 class="start-title">
                {{ $t("start.recent") }}
            </h2>
            <p
                v-if="connections.saved.length === 0"
                class="m-0 mb-2 text-on-surface-variant"
            >
                {{ $t("connection.empty") }}
            </p>
            <ButtonRoot
                v-for="profile in connections.recent"
                :key="profile.id"
                @click="actions.connect(profile)"
                class="w-full h-[23px] flex items-center gap-2 text-left hover:bg-on-surface/6"
                data-testid="recent-connection"
            >
                <span
                    :class="connections.connecting.has(profile.id) ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-server'"
                    class="size-4 shrink-0"
                />
                <ButtonContent class="text-on-surface-strong">
                    {{ profile.name }}
                </ButtonContent>
                <span class="truncate text-on-surface-variant">{{ profile.address.replace(/^mongodb(\+srv)?:\/\//, "") }}</span>
            </ButtonRoot>
            <div class="mt-2 flex items-baseline gap-2.5">
                <ButtonRoot
                    @click="actions.newConnection()"
                    class="font-bold text-primary underline decoration-dotted underline-offset-4 hover:brightness-125"
                    data-testid="start-create"
                >
                    <ButtonContent>{{ $t("connection.create") }}</ButtonContent>
                </ButtonRoot>
                <span>{{ $t("start.or") }}</span>
                <ButtonRoot
                    @click="actions.connectFromUri()"
                    class="text-primary underline decoration-dotted underline-offset-4 hover:brightness-125"
                    data-testid="start-from-uri"
                >
                    <ButtonContent>{{ $t("connection.connectFromUri") }}</ButtonContent>
                </ButtonRoot>
            </div>

            <h2 class="start-title mt-14">
                {{ $t("start.shortcuts") }}
            </h2>
            <ShortcutList />
        </div>
    </div>
</template>
