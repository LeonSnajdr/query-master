import { collectValues, mergeValues } from "@/shell/values";
import type { ValueIndex, ValueSource } from "@/shell/values";
import { useConnectionsStore } from "@/stores/connections";
import { useTabsStore } from "@/stores/tabs";
import type { QueryResult, WorkTab } from "@/stores/tabs";

/** Values of a result, counted once per result (a new run gives a new object). */
const counted = new WeakMap<QueryResult, ValueIndex>();

/**
 * Where the editor of a tab finds values of fields: the sample the field names come from and the
 * documents the tab shows. Further sources go into the list here.
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

    return mergeValues([shown, sample]);
}
