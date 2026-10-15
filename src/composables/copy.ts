import { shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { backend } from "@/api";
import type { Place } from "@/api";
import { useDialogs } from "@/composables/dialogs";
import { useMessages } from "@/composables/messages";
import { useNotices } from "@/composables/notices";
import { useTask } from "@/composables/task";
import { ShellError } from "@/shell/message";
import { useConnectionsStore } from "@/stores/connections";
import { useNotesStore } from "@/stores/notes";

/**
 * The collections "Copy collection" or "Copy collections" picked; pasted on a database, possibly of
 * another connection. Views come last, so that their sources are there before them.
 */
const copied = shallowRef<Place[]>();

/** Copying collections and pasting them into a database, with progress and a way to stop. */
export function useCopy() {
    const { t } = useI18n();
    const { report } = useMessages();
    const notices = useNotices();
    const dialogs = useDialogs();
    const connections = useConnectionsStore();
    const notes = useNotesStore();
    const task = useTask();

    function copy(place: Place) {
        copied.value = [{ ...place }];
        notices.answer(t("copy.picked", { name: place.collection }));
    }

    /** Collections selected together; views last, as with `copyAll`. */
    function copyMany(places: Place[]) {
        if (places.length === 1) return copy(places[0]!);
        const isView = (place: Place) => connections.sessions[place.connectionId]?.databases.find(item => item.name === place.database)?.types[place.collection] === "view";
        copied.value = [...places.filter(place => !isView(place)), ...places.filter(isView)].map(place => ({ ...place }));
        notices.answer(t("copy.pickedSelected", { count: places.length }, places.length));
    }

    /** Every collection and view of a database; the server's own (`system.*`) can not be created anew. */
    async function copyAll(connectionId: string, database: string) {
        try {
            await connections.loadCollections(connectionId, database);
        } catch (error) {
            report(error);
            return;
        }
        const types = connections.sessions[connectionId]?.databases.find(item => item.name === database)?.types ?? {};
        const names = connections.collectionsOf(connectionId, database).filter(name => !name.startsWith("system."));
        if (names.length === 0) {
            notices.answer(t("copy.nothing", { database }), "info");
            return;
        }
        const ordered = [...names.filter(name => types[name] !== "view"), ...names.filter(name => types[name] === "view")];
        copied.value = ordered.map(collection => ({ connectionId, database, collection }));
        notices.answer(t("copy.pickedMany", { count: ordered.length, database }, ordered.length));
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
            suggestions: taken,
            action: t("action.paste")
        });
        if (!chosen) return undefined;
        if (!taken.includes(chosen)) return { name: chosen, replace: false };
        const replace = await dialogs.confirm({ title: t("copy.replace.title"), text: t("copy.replace.text", { name: chosen, database }), action: t("action.replace") });
        return replace ? { name: chosen, replace: true } : undefined;
    }

    /** Copies what was picked into `database`, one collection after another; a name taken is asked for. */
    async function paste(connectionId: string, database: string) {
        const sources = copied.value;
        if (!sources || sources.length === 0 || task.running.runId) return;
        if (notes.isReadonly({ connectionId, database })) {
            report(new ShellError("error.plan.readonlyTree", { name: database }));
            return;
        }
        let done = 0;
        try {
            for (const source of sources) {
                const choice = await chooseName(connectionId, database, source.collection);
                if (!choice) continue;
                const target: Place = { connectionId, database, collection: choice.name };
                const result = await task.track(
                    t("copy.running.title"),
                    t("copy.running.text", { source: `${source.database}.${source.collection}`, target: `${database}.${choice.name}` }),
                    (runId, progress) => backend.copyCollection(runId, source, target, choice.replace, update => progress(update.copied, update.total))
                );
                done += 1;
                if (sources.length > 1) continue;
                notices.notify({
                    kind: "success",
                    title: result.view
                        ? t("copy.doneView", { name: choice.name })
                        : t("copy.done", { name: choice.name, documents: result.documents.toLocaleString(), indexes: result.indexes }),
                    detail: `${source.database}.${source.collection} → ${database}.${choice.name}`
                });
            }
            if (sources.length > 1) notices.notify({ kind: "success", title: t("copy.doneMany", { count: done, database }, done) });
        } catch (error) {
            // A failed or stopped copy ends the run; what was copied before stays.
            report(error);
        } finally {
            await connections.loadDatabases(connectionId).catch(report);
        }
    }

    return { copied, running: task.running, copy, copyMany, copyAll, paste };
}
