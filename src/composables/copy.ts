import { shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { useExportWizard } from "@/composables/exportWizard";
import { useMessages } from "@/composables/messages";
import { useNotices } from "@/composables/notices";
import { useConnectionsStore } from "@/stores/connections";

/** A collection on a connection. */
export interface Place {
    connectionId: string;
    database: string;
    collection: string;
}

/**
 * The collections "Copy collection" or "Copy collections" picked; pasted on a database, possibly of
 * another connection. Views come last, so that their sources are there before them.
 */
const copied = shallowRef<Place[]>();

/** Picking collections to copy, and pasting them into a database through the export wizard. */
export function useCopy() {
    const { t } = useI18n();
    const { report } = useMessages();
    const notices = useNotices();
    const connections = useConnectionsStore();
    const exportWizard = useExportWizard();

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

    /**
     * Pastes what was picked into `database`: the export wizard opens on its tile Database with the
     * collections as rows and this database as the target. There the names of the copies, the
     * insert mode and "Options and indexes too" are chosen; it is the one way collections are
     * copied, also to another connection.
     */
    async function paste(connectionId: string, database: string) {
        const sources = copied.value;
        if (!sources || sources.length === 0) return;
        await exportWizard.openExport(sources, undefined, "database", { connectionId, database });
    }

    return { copied, copy, copyMany, copyAll, paste };
}
