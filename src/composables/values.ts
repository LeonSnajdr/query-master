import { collectValues, mergeValues, preferValues } from "@/shell/values";
import type { ValueIndex, ValueSearcher, ValueSource } from "@/shell/values";
import { useConnectionsStore } from "@/stores/connections";
import { useTabsStore } from "@/stores/tabs";
import type { QueryResult, WorkTab } from "@/stores/tabs";

/** Values of a result, counted once per result (a new run gives a new object). */
const counted = new WeakMap<QueryResult, ValueIndex>();

/**
 * Where the editor of a tab finds values of fields: what searches of all data found, else the
 * sample the field names come from and the documents the tab shows. Further sources go into the
 * list here.
 */
export function useValueSources(tab: () => WorkTab | undefined): ValueSource {
    const connections = useConnectionsStore();
    const tabs = useTabsStore();

    const sample: ValueSource = (collection, field) => {
        const current = tab();
        return current ? connections.sampleValuesOf(current.connectionId, current.database, collection, field) : undefined;
    };

    // Only documents of that collection: a result of another one, or one reshaped by a pipeline, does not count.
    const shown: ValueSource = (collection, field) => {
        const current = tab();
        const result = current?.result;
        if (!current || !result || tabs.sourceCollection(current) !== collection) return undefined;
        let index = counted.get(result);
        if (!index) counted.set(result, (index = collectValues(result.items)));
        return index.get(field);
    };

    const searched = (collection: string, field: string) => {
        const current = tab();
        return current ? connections.searchedValuesOf(current.connectionId, current.database, collection, field) : undefined;
    };

    // The server's counts first; once a search covered every document, the rest adds nothing.
    const known = mergeValues([shown, sample]);
    return preferValues(
        (collection, field) => searched(collection, field)?.hints,
        (collection, field) => (searched(collection, field)?.whole ? [] : known(collection, field))
    );
}

/** The search of all data the editor of a tab offers as the last entry of its suggestions. */
export function useValueSearch(tab: () => WorkTab | undefined): ValueSearcher {
    const connections = useConnectionsStore();
    return {
        state: (collection, field, prefix) => {
            const current = tab();
            return current ? connections.valueSearchOf(current.connectionId, current.database, collection, field, prefix) : undefined;
        },
        run: (collection, field, prefix) => {
            const current = tab();
            if (!current) return Promise.reject(new Error("No tab to search in"));
            return connections.searchValues(current.connectionId, current.database, collection, field, prefix);
        }
    };
}
