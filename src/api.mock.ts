import type { Backend, Profile, SavedQuery, SessionTab, Setting, TreeFolder, TreeNote } from "./api";
import { folderWithin, parentFolder } from "./tree/folders";
import { isDoc, toNumber } from "./shell/ejson";
import type { Doc, Json } from "./shell/ejson";

/**
 * Made-up data for work on the interface in a browser (`bun run dev` without Tauri). Filters are
 * not evaluated: every query returns the same documents, cut by skip, limit and `$skip`.
 */
const profiles: Profile[] = [
    { id: "demo", name: "Demo (made-up data)", address: "mongodb://localhost:27017" },
    // A server that is not there: shows how a connection that fails stays in the tree.
    { id: "offline", name: "Offline (unreachable)", address: "mongodb://10.0.0.1:27017" }
];

const COLLECTIONS: Record<string, string[]> = {
    shop: ["orders", "customers", "order-items"],
    logs: ["events"]
};

const history = new Map<string, string[]>();
const notes = new Map<string, Map<string, TreeNote>>();
const folders = new Map<string, TreeFolder[]>();

/** A row lies in the folders of `database`; the folders of the connection (`""`) hold databases. */
function inFolderOf(path: string, database: string): boolean {
    return database === "" ? path !== "" && !path.includes("/") : path.startsWith(`${database}/`);
}
const keybindings: Record<string, string[]> = {};
let setting: Setting = { language: null, theme: null, pageSize: null, resultView: null, editorFontSize: null, startup: null };
const savedQueries: SavedQuery[] = [];
/** `?session` starts with a last session: a tab on the made-up data and one on the unreachable server. Tests have no `location`. */
let session: SessionTab[] = typeof location !== "undefined" && location.search.includes("session")
    ? [
            { active: true, connectionId: "demo", content: { kind: "shell", database: "shop", text: "db.orders.find({})", view: "tree", pageSize: 20 } },
            { active: false, connectionId: "offline", content: { kind: "shell", database: "test", text: "db.stats()", view: "tree", pageSize: 20 } }
        ]
    : [];

const STATUS = ["open", "paid", "shipped", "cancelled"];

function order(index: number): Doc {
    return {
        _id: { $oid: (0x64b7f0c2a1b2 + index).toString(16).padStart(12, "0") + "c3d4e5f60718" },
        number: { $numberInt: String(1000 + index) },
        status: STATUS[index % STATUS.length]!,
        total: { $numberDouble: String(19.99 + index * 3.5) },
        createdAt: { $date: { $numberLong: String(1_714_521_600_000 + index * 3_600_000) } },
        customer: { name: `Customer ${index % 17}`, email: `customer${index % 17}@example.com`, vip: index % 5 === 0 },
        items: [
            { sku: `SKU-${index % 9}`, quantity: { $numberInt: String(1 + (index % 3)) }, price: { $numberDecimal: "9.99" } },
            { sku: `SKU-${(index + 4) % 9}`, quantity: { $numberInt: "1" }, price: { $numberDecimal: "24.50" } }
        ],
        visits: { $numberLong: String(index * 1000) },
        note: index % 4 === 0 ? null : `Note ${index}`
    };
}

const ORDERS = Array.from({ length: 137 }, (_, index) => order(index));

function pipelineSkip(pipeline: Json[]): number {
    const stage = pipeline.findLast(item => typeof item === "object" && item !== null && "$skip" in item) as Doc | undefined;
    return toNumber(stage?.$skip) ?? 0;
}

/** The values of a field in the documents, arrays taken apart: what `$project` and `$unwind` give. */
function valuesAt(value: Json | undefined, path: string[]): Json[] {
    if (value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap(item => valuesAt(item, path));
    if (path.length === 0) return [value];
    return isDoc(value) ? valuesAt(value[path[0]!], path.slice(1)) : [];
}

/** The search of all data for values (`searchCommand` in `shell/values.ts`), counted in the made-up documents. */
function valueGroups(pipeline: Json[]): Doc[] | undefined {
    const project = pipeline.find(stage => isDoc(stage) && isDoc(stage.$project) && typeof stage.$project.v === "string") as Doc | undefined;
    if (!project) return undefined;
    const path = String((project.$project as Doc).v).slice(1).split(".");
    const match = pipeline.findLast(stage => isDoc(stage) && isDoc(stage.$match) && isDoc(stage.$match.v)) as Doc | undefined;
    const pattern = match ? String(((match.$match as Doc).v as Doc).$regex) : undefined;
    const counts = new Map<string, { value: Json; n: number }>();
    for (const value of ORDERS.flatMap(order => valuesAt(order, path))) {
        if (pattern && (typeof value !== "string" || !new RegExp(pattern).test(value))) continue;
        const key = JSON.stringify(value);
        counts.set(key, { value, n: (counts.get(key)?.n ?? 0) + 1 });
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).map(({ value, n }) => ({ _id: value, n: { $numberInt: String(n) } }));
}

export const mockBackend: Backend = {
    listConnections: async () => [...profiles],
    connectionUri: async () => "mongodb://localhost:27017",
    saveConnection: async (input) => {
        const profile = { id: input.id ?? `mock-${profiles.length}`, name: input.name, address: input.uri.replace(/\/\/[^@/]*@/, "//"), environment: input.environment ?? null };
        const index = profiles.findIndex(item => item.id === profile.id);
        if (index === -1) profiles.push(profile);
        else profiles[index] = profile;
        return profile;
    },
    setConnectionEnvironment: async (id, environment) => {
        const profile = profiles.find(item => item.id === id);
        if (profile) profile.environment = environment;
    },
    deleteConnection: async (id) => {
        profiles.splice(profiles.findIndex(item => item.id === id), 1);
    },
    testConnection: async () => ({ version: "8.0.4" }),
    connect: async (id) => {
        if (id !== "offline") return { version: "8.0.4" };
        await new Promise(resolve => setTimeout(resolve, 1500));
        throw new Error("Server selection timeout: No available servers (10.0.0.1:27017)");
    },
    connectUri: async (_id, uri) => ({ version: "8.0.4", address: uri.replace(/\/\/[^@/]*@/, "//").split("?")[0]! }),
    disconnect: async () => undefined,
    runCommand: async (_id, _database, command): Promise<Doc> => {
        if ("listDatabases" in command) return { databases: Object.keys(COLLECTIONS).map(name => ({ name })), ok: 1 };
        if ("count" in command) return { n: { $numberInt: String(ORDERS.length) }, ok: 1 };
        if ("distinct" in command) return { values: STATUS, ok: 1 };
        if ("ping" in command) return { ok: { $numberDouble: "1.0" } };
        // A plan as MongoDB 7.0 gives it: a scan of the whole collection under a sort in memory.
        if ("explain" in command) {
            return {
                queryPlanner: { namespace: "shop.orders" },
                executionStats: {
                    nReturned: 312, executionTimeMillis: 842, totalDocsExamined: 48210,
                    executionStages: {
                        stage: "SORT", nReturned: 312, executionTimeMillisEstimate: 840, sortPattern: { createdAt: -1 }, memLimit: 104857600, totalDataSizeSorted: 4299776, usedDisk: false,
                        inputStage: { stage: "COLLSCAN", filter: { status: { $eq: "paid" } }, nReturned: 312, executionTimeMillisEstimate: 610, docsExamined: 48210 }
                    }
                },
                ok: 1
            };
        }
        return { ok: 1, n: { $numberInt: "1" }, nModified: { $numberInt: "1" } };
    },
    readTextFile: async () => "",
    writeTextFile: async () => undefined,
    // The engine is part of the app: a browser has none.
    runScript: () => Promise.reject({ key: "error.script.browser", detail: null }),
    stopRun: async () => undefined,
    // Files are written by the Rust side; the browser preview exports what the page holds instead.
    getPreset: async () => null,
    savePreset: async () => undefined,
    exportRun: () => Promise.reject({ key: "error.transfer.browser", detail: null }),
    importRun: () => Promise.reject({ key: "error.transfer.browser", detail: null }),
    importPreview: () => Promise.reject({ key: "error.transfer.browser", detail: null }),
    gridfsUpload: () => Promise.reject({ key: "error.transfer.browser", detail: null }),
    gridfsDownload: () => Promise.reject({ key: "error.transfer.browser", detail: null }),
    getSetting: async () => setting,
    getKeybindings: async () => ({ ...keybindings }),
    // Saved queries and the session in memory: gone with the page, as the rest of the preview.
    listSavedQueries: async connectionId => savedQueries.filter(query => query.connectionId === connectionId).map(query => ({ ...query })),
    saveSavedQuery: async (query) => {
        const saved = { ...query, id: query.id ?? savedQueries.reduce((top, item) => Math.max(top, item.id ?? 0), 0) + 1, dateCreated: query.dateCreated ?? new Date().toISOString() };
        const index = savedQueries.findIndex(item => item.id === saved.id);
        if (index === -1) savedQueries.push(saved);
        else savedQueries[index] = saved;
        return { ...saved };
    },
    removeSavedQuery: async (id) => {
        const index = savedQueries.findIndex(item => item.id === id);
        if (index !== -1) savedQueries.splice(index, 1);
    },
    usedSavedQuery: async (id) => {
        const query = savedQueries.find(item => item.id === id);
        if (query) query.dateUsed = new Date().toISOString();
    },
    loadSession: async () => session.map(tab => ({ ...tab })),
    saveSession: async (tabs) => {
        session = tabs.map(tab => ({ ...tab }));
    },
    saveKeybindings: async (changes) => {
        for (const { commandId, keys } of changes) {
            if (keys === null) delete keybindings[commandId];
            else keybindings[commandId] = keys;
        }
    },
    clearKeybindings: async () => {
        for (const id of Object.keys(keybindings)) delete keybindings[id];
    },
    // A browser picks files without a path: nothing to remember.
    recentFiles: async () => [],
    addRecentFile: async () => undefined,
    removeRecentFile: async () => undefined,
    saveSetting: async (value) => {
        setting = value;
    },
    listHistory: async connectionId => history.get(connectionId) ?? [],
    addHistory: async (connectionId, _database, statement) => {
        history.set(connectionId, [statement, ...(history.get(connectionId) ?? []).filter(item => item !== statement)]);
    },
    clearHistory: async (connectionId) => {
        history.delete(connectionId);
    },
    // Notes on the tree live as long as the page.
    listTreeNotes: async connectionId => [...(notes.get(connectionId)?.values() ?? [])],
    saveTreeNote: async (connectionId, node) => {
        const own = notes.get(connectionId) ?? new Map<string, TreeNote>();
        notes.set(connectionId, own);
        if (node.color || node.comment || node.readonly !== null || node.folder) own.set(node.path, node);
        else own.delete(node.path);
    },
    renameTreeNotes: async () => undefined,
    removeTreeNotes: async () => undefined,
    // Folders too; renaming or deleting one moves what lay in it, as the Rust side does.
    listTreeFolders: async connectionId => folders.get(connectionId) ?? [],
    addTreeFolder: async (connectionId, folder) => {
        const own = folders.get(connectionId) ?? [];
        if (!own.some(item => item.database === folder.database && item.name === folder.name)) folders.set(connectionId, [...own, folder]);
    },
    renameTreeFolder: async (connectionId, folder, name) => {
        // Folders inside it move along: `a/b` becomes `name/b`.
        const moved = (path: string) => (folderWithin(path, folder.name) ? name + path.slice(folder.name.length) : path);
        folders.set(connectionId, (folders.get(connectionId) ?? []).map(item => (item.database === folder.database ? { ...item, name: moved(item.name) } : item)));
        for (const note of notes.get(connectionId)?.values() ?? []) {
            if (note.folder && inFolderOf(note.path, folder.database)) note.folder = moved(note.folder);
        }
    },
    deleteTreeFolder: async (connectionId, folder) => {
        // With the folders inside it; what lay in them goes to the folder around it.
        folders.set(connectionId, (folders.get(connectionId) ?? []).filter(item => item.database !== folder.database || !folderWithin(item.name, folder.name)));
        for (const note of notes.get(connectionId)?.values() ?? []) {
            if (note.folder && folderWithin(note.folder, folder.name) && inFolderOf(note.path, folder.database)) note.folder = parentFolder(folder.name) ?? null;
        }
    },
    runCursorCommand: async (_id, database, command, limit) => {
        let documents: Doc[] = ORDERS;
        if ("listCollections" in command) documents = (COLLECTIONS[database] ?? []).map(name => ({ name, type: "collection" }));
        else if ("listIndexes" in command) documents = [
            { v: { $numberInt: "2" }, key: { _id: { $numberInt: "1" } }, name: "_id_" },
            { v: { $numberInt: "2" }, key: { status: { $numberInt: "1" }, createdAt: { $numberInt: "-1" } }, name: "status_1_createdAt_-1" }
        ];
        else if ("find" in command) {
            const skip = toNumber(command.skip) ?? 0;
            const max = toNumber(command.limit) ?? 0;
            documents = ORDERS.slice(skip, max > 0 ? skip + max : undefined);
        } else if (Array.isArray(command.pipeline)) {
            const pipeline = command.pipeline;
            const counts = pipeline.some(stage => typeof stage === "object" && stage !== null && ("$group" in stage || "$count" in stage));
            documents = valueGroups(pipeline) ?? (counts ? [{ _id: 1, n: { $numberInt: String(ORDERS.length) } }] : ORDERS.slice(pipelineSkip(pipeline)));
        }
        await new Promise(resolve => setTimeout(resolve, 120));
        return { documents: documents.slice(0, limit), hasMore: documents.length > limit };
    }
};
