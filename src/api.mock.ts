import type { Backend, Profile, Setting, TreeNote } from "./api";
import { toNumber } from "./shell/ejson";
import type { Doc, Json } from "./shell/ejson";

/**
 * Made-up data for work on the interface in a browser (`bun run dev` without Tauri). Filters are
 * not evaluated: every query returns the same documents, cut by skip, limit and `$skip`.
 */
const profiles: Profile[] = [{ id: "demo", name: "Demo (made-up data)", address: "mongodb://localhost:27017" }];

const COLLECTIONS: Record<string, string[]> = {
    shop: ["orders", "customers", "order-items"],
    logs: ["events"]
};

const history = new Map<string, string[]>();
const notes = new Map<string, Map<string, TreeNote>>();
let setting: Setting = { language: null, theme: null, pageSize: null, resultView: null, editorFontSize: null };

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

export const mockBackend: Backend = {
    listConnections: async () => [...profiles],
    connectionUri: async () => "mongodb://localhost:27017",
    saveConnection: async (input) => {
        const profile = { id: input.id ?? `mock-${profiles.length}`, name: input.name, address: input.uri.replace(/\/\/[^@/]*@/, "//") };
        const index = profiles.findIndex(item => item.id === profile.id);
        if (index === -1) profiles.push(profile);
        else profiles[index] = profile;
        return profile;
    },
    deleteConnection: async (id) => {
        profiles.splice(profiles.findIndex(item => item.id === id), 1);
    },
    testConnection: async () => ({ version: "8.0.4" }),
    connect: async () => ({ version: "8.0.4" }),
    connectUri: async (_id, uri) => ({ version: "8.0.4", address: uri.replace(/\/\/[^@/]*@/, "//").split("?")[0]! }),
    disconnect: async () => undefined,
    runCommand: async (_id, _database, command): Promise<Doc> => {
        if ("listDatabases" in command) return { databases: Object.keys(COLLECTIONS).map(name => ({ name })), ok: 1 };
        if ("count" in command) return { n: { $numberInt: String(ORDERS.length) }, ok: 1 };
        if ("distinct" in command) return { values: STATUS, ok: 1 };
        if ("ping" in command) return { ok: { $numberDouble: "1.0" } };
        return { ok: 1, n: { $numberInt: "1" }, nModified: { $numberInt: "1" } };
    },
    readTextFile: async () => "",
    writeTextFile: async () => undefined,
    // The engine is part of the app: a browser has none.
    runScript: () => Promise.reject({ key: "error.script.browser", detail: null }),
    stopRun: async () => undefined,
    copyCollection: () => Promise.reject({ key: "error.copy.browser", detail: null }),
    // Files are written by the Rust side; the browser preview exports what the page holds instead.
    exportDocuments: () => Promise.reject({ key: "error.transfer.browser", detail: null }),
    importDocuments: () => Promise.reject({ key: "error.transfer.browser", detail: null }),
    gridfsUpload: () => Promise.reject({ key: "error.transfer.browser", detail: null }),
    gridfsDownload: () => Promise.reject({ key: "error.transfer.browser", detail: null }),
    getSetting: async () => setting,
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
        if (node.color || node.comment || node.readonly) own.set(node.path, node);
        else own.delete(node.path);
    },
    renameTreeNotes: async () => undefined,
    removeTreeNotes: async () => undefined,
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
            const counts = pipeline.some(stage => typeof stage === "object" && stage !== null && "$group" in stage);
            documents = counts ? [{ _id: 1, n: { $numberInt: String(ORDERS.length) } }] : ORDERS.slice(pipelineSkip(pipeline));
        }
        await new Promise(resolve => setTimeout(resolve, 120));
        return { documents: documents.slice(0, limit), hasMore: documents.length > limit };
    }
};
