<script setup lang="ts">
import { ButtonContent, ButtonRoot, DialogClose, DialogContent, DialogDescription, DialogRoot, DialogTitle } from "@vuetify/v0";
import { computed } from "vue";
import ShortcutList from "@/components/ShortcutList.vue";
import { inApp } from "@/api";
import { useDialogs } from "@/composables/dialogs";
import type { HelpPage } from "@/composables/dialogs";
import { useUpdates } from "@/composables/updates";

/** Help → Keyboard shortcuts (F12) and Help → About QueryMaster. */
const page = defineModel<HelpPage | undefined>();

const open = computed({ get: () => page.value !== undefined, set: value => !value && (page.value = undefined) });
const version = __APP_VERSION__;
const dialogs = useDialogs();
const updates = useUpdates();
</script>

<template>
    <DialogRoot v-model="open">
        <!-- No display class on the dialog itself: it would show the closed dialog. -->
        <DialogContent
            :class="page === 'shortcuts' ? 'w-[min(94vw,40rem)]!' : ''"
            class="dialog"
        >
            <div
                v-if="page === 'shortcuts'"
                class="flex flex-col gap-2"
                data-testid="help-shortcuts"
            >
                <DialogTitle class="dialog-title">
                    {{ $t("help.shortcuts") }}
                </DialogTitle>
                <div class="text-[13px] text-on-surface">
                    <ShortcutList />
                </div>
                <div class="mt-2 flex justify-end gap-2">
                    <ButtonRoot
                        @click="dialogs.openSettings('keys')"
                        class="btn-secondary"
                        data-testid="help-customize"
                    >
                        <ButtonContent>{{ $t("keys.customize") }}</ButtonContent>
                    </ButtonRoot>
                    <DialogClose class="btn-primary">
                        {{ $t("action.close") }}
                    </DialogClose>
                </div>
            </div>
            <div
                v-else-if="page === 'about'"
                class="flex flex-col gap-4"
                data-testid="help-about"
            >
                <div class="flex items-center gap-3">
                    <span class="size-10 shrink-0 inline-flex items-center justify-center rounded-full bg-on-surface/15 text-on-surface-strong">
                        <span class="i-lucide-search-code size-5" />
                    </span>
                    <div class="flex flex-col">
                        <DialogTitle class="dialog-title">
                            QueryMaster
                        </DialogTitle>
                        <span
                            class="text-[13px] text-on-surface-variant tabular-nums"
                            data-testid="help-version"
                        >{{ $t("help.version", { version }) }}</span>
                    </div>
                </div>
                <DialogDescription class="m-0 text-sm text-on-surface">
                    {{ $t("help.about.text") }}
                </DialogDescription>
                <p class="m-0 text-[13px] text-on-surface-variant">
                    {{ $t("help.about.built") }}
                </p>
                <div class="flex justify-end gap-2">
                    <!-- Only the installed app can update itself, not the preview in a browser. -->
                    <ButtonRoot
                        v-if="inApp"
                        @click="updates.checkForUpdate()"
                        :disabled="updates.checking.value"
                        class="btn-secondary"
                        data-testid="help-update"
                    >
                        <ButtonContent>{{ $t("update.check") }}</ButtonContent>
                    </ButtonRoot>
                    <DialogClose class="btn-primary">
                        {{ $t("action.close") }}
                    </DialogClose>
                </div>
            </div>
        </DialogContent>
    </DialogRoot>
</template>
