import { defineStore } from "pinia";
import { reactive } from "vue";
import { backend } from "@/api";
import type { SavedQuery } from "@/api";
import { isDoc } from "@/shell/ejson";
import type { Json } from "@/shell/ejson";
import { newStage } from "@/shell/pipeline";
import { useTabsStore } from "./tabs";
import type { Stage, WorkTab } from "./tabs";

/** The kinds of tab whose query can be saved. */
export type QueryKind = SavedQuery["kind"];

export function isQueryKind(kind: string): kind is QueryKind {
    return kind === "browse" || kind === "aggregate" || kind === "shell" || kind === "sql";
}

/** What a tab needs to run its query again: query rows, stages and options, or the text. */
export function queryContent(tab: WorkTab): Json {
    if (tab.kind === "browse") return { stages: tab.stages.map(stage => ({ name: stage.name, text: stage.text, enabled: stage.enabled, ...(stage.json ? { json: true } : {}) })) };
    if (tab.kind === "aggregate") {
        return {
            pipeline: (tab.pipeline ?? []).map(stage => ({ operator: stage.operator, text: stage.text, enabled: stage.enabled })),
            options: tab.aggregateOptions ?? ""
        };
    }
    return { text: tab.text };
}

/** White space does not tell two queries apart: `{status:"a"}` is `{ status: "a" }`. */
function normalized(value: Json): Json {
    if (typeof value === "string") return value.replace(/\s+/g, "");
    if (Array.isArray(value)) return value.map(normalized);
    if (isDoc(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalized(item)]));
    return value;
}

export function sameContent(a: Json, b: Json): boolean {
    return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
}

/** The query a tab shows, ready to be saved; a collection only for the document browser and the aggregation. */
export function draftOf(tab: WorkTab): SavedQuery | undefined {
    if (!isQueryKind(tab.kind)) return undefined;
    const collection = tab.kind === "browse" || tab.kind === "aggregate" ? tab.collection ?? null : null;
    return { connectionId: tab.connectionId, database: tab.database, collection, kind: tab.kind, name: suggestedName(tab), folder: null, content: queryContent(tab) };
}

/** A name to start with: the filter (`status: open`), else the first line of the text. */
export function suggestedName(tab: WorkTab): string {
    if (tab.kind === "browse") {
        const filter = tab.stages.find(stage => stage.name === "filter" && stage.enabled)?.text.replace(/^\s*\{\s*|\s*\}\s*$/g, "").replace(/\s+/g, " ").trim();
        return (filter || tab.collection || "").slice(0, 60);
    }
    if (tab.kind === "aggregate") return `${tab.collection ?? ""} ${(tab.pipeline ?? []).map(stage => stage.operator).join(" ")}`.trim().slice(0, 60);
    return (tab.text.split("\n").find(line => line.trim() !== "") ?? "").trim().slice(0, 60);
}

/** Whether the query is one of the tab: same connection, database, kind and (where it has one) collection. */
export function belongsTo(query: SavedQuery, tab: WorkTab): boolean {
    return query.connectionId === tab.connectionId && query.database === tab.database && query.kind === tab.kind
        && (query.collection ?? null) === (query.kind === "browse" || query.kind === "aggregate" ? tab.collection ?? null : null);
}

/** Whether the query is meant for where the tab is: its collection, or its database for one of the whole database. */
export function scopeOf(query: SavedQuery, tab: WorkTab): boolean {
    if (query.connectionId !== tab.connectionId || query.database !== tab.database) return false;
    return (query.collection ?? null) === null || query.collection === tab.collection;
}

/** Search in name, folder and text, without case. */
export function matchesQuery(query: SavedQuery, text: string): boolean {
    const needle = text.trim().toLowerCase();
    if (!needle) return true;
    return `${query.name} ${query.folder ?? ""} ${JSON.stringify(query.content)}`.toLowerCase().includes(needle);
}

/** Saved queries per connection (stage 20), read from SQLite on first use. */
export const useQueriesStore = defineStore("queries", () => {
    const byConnection = reactive<Record<string, SavedQuery[]>>({});
    const loading = new Map<string, Promise<void>>();

    async function reload(connectionId: string): Promise<void> {
        byConnection[connectionId] = await backend.listSavedQueries(connectionId);
    }

    /** The saved queries of a connection; read on the first call. */
    function of(connectionId: string): SavedQuery[] {
        if (!loading.has(connectionId)) loading.set(connectionId, reload(connectionId).catch(() => undefined));
        return byConnection[connectionId] ?? [];
    }

    /** The saved query the tab shows right now, if it is one. */
    function savedFor(tab: WorkTab): SavedQuery | undefined {
        if (!isQueryKind(tab.kind)) return undefined;
        const content = queryContent(tab);
        return of(tab.connectionId).find(query => belongsTo(query, tab) && sameContent(query.content, content));
    }

    /** The folders in use on a connection, for the choice in the dialog. */
    function foldersOf(connectionId: string): string[] {
        return [...new Set(of(connectionId).map(query => query.folder).filter((folder): folder is string => !!folder))].sort((a, b) => a.localeCompare(b));
    }

    async function save(query: SavedQuery): Promise<SavedQuery> {
        const saved = await backend.saveSavedQuery(query);
        await reload(query.connectionId);
        return saved;
    }

    async function remove(query: SavedQuery): Promise<void> {
        if (query.id === undefined || query.id === null) return;
        await backend.removeSavedQuery(query.id);
        await reload(query.connectionId);
    }

    /** Puts the query into the tab and runs it. */
    function apply(tab: WorkTab, query: SavedQuery): void {
        const tabs = useTabsStore();
        const content = isDoc(query.content) ? query.content : {};
        if (query.kind === "browse" && Array.isArray(content.stages)) {
            tab.stages = (content.stages as unknown as Stage[]).map(stage => ({ ...stage }));
        } else if (query.kind === "aggregate") {
            const stages = Array.isArray(content.pipeline) ? content.pipeline as unknown as { operator: string; text: string; enabled: boolean }[] : [];
            tab.pipeline = stages.map(stage => newStage(stage.operator, stage.text, stage.enabled));
            tab.aggregateOptions = typeof content.options === "string" && content.options ? content.options : undefined;
        } else if (typeof content.text === "string") {
            tab.text = content.text;
        }
        void tabs.runTab(tab);
        if (query.id !== undefined && query.id !== null) void backend.usedSavedQuery(query.id).then(() => reload(query.connectionId)).catch(() => undefined);
    }

    /** Opens the query in a tab of its kind (a new one with `newTab`, else one already on its place) and runs it. */
    function open(query: SavedQuery, newTab = false): WorkTab {
        const tabs = useTabsStore();
        const target = { connectionId: query.connectionId, database: query.database, collection: query.collection ?? undefined };
        let tab: WorkTab;
        if (query.kind === "browse" && target.collection !== undefined) tab = tabs.openBrowse({ ...target, collection: target.collection }, newTab);
        else if (query.kind === "aggregate" && target.collection !== undefined) tab = tabs.openAggregate({ ...target, collection: target.collection });
        else if (query.kind === "sql") tab = tabs.openSql(target);
        else tab = tabs.openShell({ ...target, collection: undefined });
        tabs.activeId = tab.id;
        apply(tab, query);
        return tab;
    }

    return { byConnection, of, reload, savedFor, foldersOf, save, remove, apply, open };
});
