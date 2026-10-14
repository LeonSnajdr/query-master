import { useNotifications } from "@vuetify/v0";
import { reactive, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { backend } from "@/api";
import type { Place } from "@/api";
import { useDialogs } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";
import { ShellError } from "@/shell/message";
import { useConnectionsStore } from "@/stores/connections";
import { useNotesStore } from "@/stores/notes";

/** The collection "Copy collection" picked; pasted on a database, possibly of another connection. */
const copied = shallowRef<Place>();

/** The copy that is running, for the progress dialog. */
const running = reactive({
    runId: undefined as string | undefined,
    source: "",
    target: "",
    copied: 0,
    total: 0
});

/** Copying collections and pasting them into a database, with progress and a way to stop. */
export function useCopy() {
    const { t } = useI18n();
    const { report } = useMessages();
    const notifications = useNotifications();
    const dialogs = useDialogs();
    const connections = useConnectionsStore();
    const notes = useNotesStore();

    function copy(place: Place) {
        copied.value = { ...place };
        notifications.send({ subject: t("copy.picked", { name: place.collection }), timeout: 3000 });
    }

    /** The name the copy gets in `database`, and whether it replaces a collection of that name. */
    async function chooseName(connectionId: string, database: string, name: string): Promise<{ name: string; replace: boolean } | undefined> {
        await connections.loadCollections(connectionId, database);
        const taken = connections.collectionsOf(connectionId, database);
        if (!taken.includes(name)) return { name, replace: false };
        const chosen = await dialogs.ask({
            title: t("copy.exists.title"),
            label: t("copy.exists.label", { name, database }),
            value: `${name}_copy`,
            action: t("action.paste")
        });
        if (!chosen) return undefined;
        if (!taken.includes(chosen)) return { name: chosen, replace: false };
        const replace = await dialogs.confirm({ title: t("copy.replace.title"), text: t("copy.replace.text", { name: chosen, database }), action: t("action.replace") });
        return replace ? { name: chosen, replace: true } : undefined;
    }

    async function paste(connectionId: string, database: string) {
        const source = copied.value;
        if (!source || running.runId) return;
        if (notes.isReadonly({ connectionId, database })) {
            report(new ShellError("error.plan.readonlyTree", { name: database }));
            return;
        }
        const choice = await chooseName(connectionId, database, source.collection);
        if (!choice) return;
        const target: Place = { connectionId, database, collection: choice.name };
        Object.assign(running, {
            runId: `copy-${Date.now()}`,
            source: `${source.database}.${source.collection}`,
            target: `${database}.${choice.name}`,
            copied: 0,
            total: 0
        });
        try {
            const result = await backend.copyCollection(running.runId!, source, target, choice.replace, (progress) => {
                running.copied = progress.copied;
                running.total = progress.total;
            });
            notifications.send({
                subject: result.view
                    ? t("copy.doneView", { name: choice.name })
                    : t("copy.done", { name: choice.name, documents: result.documents.toLocaleString(), indexes: result.indexes }),
                timeout: 4000
            });
        } catch (error) {
            report(error);
        } finally {
            running.runId = undefined;
            await connections.loadDatabases(connectionId).catch(report);
        }
    }

    function stop() {
        if (running.runId) void backend.stopRun(running.runId);
    }

    return { copied, running, copy, paste, stop };
}
