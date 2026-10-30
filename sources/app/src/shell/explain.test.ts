import { describe, expect, it } from "vitest";
import { hintsOf, indexFor, isExplain, layoutPlan, querySide, readExplain, strokeFor } from "./explain";
import type { Doc } from "./ejson";

/** A find without index: COLLSCAN under an in-memory SORT, as MongoDB 7.0 answers. */
const collscan: Doc = {
    queryPlanner: { namespace: "shop.orders", winningPlan: { stage: "SORT" } },
    executionStats: {
        executionSuccess: true, nReturned: 312, executionTimeMillis: 842, totalKeysExamined: 0, totalDocsExamined: 48210,
        executionStages: {
            stage: "SORT", nReturned: 312, executionTimeMillisEstimate: 840, sortPattern: { createdAt: -1 }, memLimit: 104857600, totalDataSizeSorted: 4299776, usedDisk: false,
            inputStage: { stage: "COLLSCAN", filter: { status: { $eq: "paid" } }, nReturned: 312, executionTimeMillisEstimate: 610, docsExamined: 48210, direction: "forward" }
        }
    }
};

/** With an index: IXSCAN under FETCH. */
const ixscan: Doc = {
    queryPlanner: { namespace: "shop.orders" },
    executionStats: {
        nReturned: 312, executionTimeMillis: 3, totalKeysExamined: 312, totalDocsExamined: 312,
        executionStages: {
            stage: "FETCH", nReturned: 312, executionTimeMillisEstimate: 3, docsExamined: 312,
            inputStage: { stage: "IXSCAN", nReturned: 312, executionTimeMillisEstimate: 2, keysExamined: 312, indexName: "status_1_createdAt_-1", keyPattern: { status: 1, createdAt: -1 } }
        }
    }
};

/** An aggregate whose $lookup scans the other collection for every document. */
const lookup: Doc = {
    stages: [
        { $cursor: { queryPlanner: { namespace: "shop.orders" }, executionStats: { nReturned: 1204, executionTimeMillis: 9, totalDocsExamined: 1204, executionStages: { stage: "FETCH", nReturned: 1204, executionTimeMillisEstimate: 9, docsExamined: 1204, inputStage: { stage: "IXSCAN", nReturned: 1204, executionTimeMillisEstimate: 2, indexName: "status_1" } } } }, nReturned: 1204, executionTimeMillisEstimate: 9 },
        { $lookup: { from: "customers", as: "customer", localField: "customer.email", foreignField: "email" }, totalDocsExamined: 20468, collectionScans: 1204, indexesUsed: [], nReturned: 1204, executionTimeMillisEstimate: 521 },
        { $group: { _id: "$customer.email" }, nReturned: 40, executionTimeMillisEstimate: 559 },
        { $sort: { sortKey: { revenue: -1 } }, nReturned: 40, executionTimeMillisEstimate: 563 }
    ]
};

describe("readExplain", () => {
    it("reads a find as a flow with own times", () => {
        const plan = readExplain(collscan, "orders")!;
        expect(plan.source).toEqual({ kind: "collection", name: "orders" });
        expect(plan.stages.map(node => [node.stage, node.ms, node.returned])).toEqual([["COLLSCAN", 610, 312], ["SORT", 230, 312]]);
        expect(plan).toMatchObject({ examined: 48210, returned: 312, ms: 842 });
        expect(plan.stages[0]!.raw.inputStage).toBeUndefined();
    });

    it("starts at the index an IXSCAN reads", () => {
        const plan = readExplain(ixscan, "orders")!;
        expect(plan.source).toEqual({ kind: "index", name: "status_1_createdAt_-1", detail: "orders" });
        expect(plan.stages.map(node => node.stage)).toEqual(["IXSCAN", "FETCH"]);
    });

    it("reads the stages of a pipeline after its cursor, $lookup with its collection on the side", () => {
        const plan = readExplain(lookup, "orders")!;
        expect(plan.stages.map(node => [node.stage, node.ms])).toEqual([["IXSCAN", 2], ["FETCH", 7], ["$lookup", 512], ["$group", 38], ["$sort", 4]]);
        expect(plan.stages[2]!.side?.[0]).toMatchObject({ stage: "customers", docsExamined: 20468 });
        expect(plan).toMatchObject({ returned: 40, ms: 563 });
    });

    it("takes unknown stages with their name and no numbers, and refuses what is no plan", () => {
        const plan = readExplain({ queryPlanner: { winningPlan: { stage: "EOF_NEW" } } }, "x")!;
        expect(plan.stages.map(node => node.stage)).toEqual(["EOF_NEW"]);
        expect(plan.stages[0]!.ms).toBeUndefined();
        expect(isExplain({ ok: 1 })).toBe(false);
        expect(readExplain([1, 2], "x")).toBeUndefined();
    });

    it("puts the other shards beside the first", () => {
        const plan = readExplain({ executionStats: { executionStages: { stage: "SHARD_MERGE", shards: [{ executionStages: { stage: "COLLSCAN" } }, { executionStages: { stage: "IXSCAN", indexName: "a_1" } }] } } }, "c")!;
        expect(plan.stages.map(node => node.stage)).toEqual(["COLLSCAN", "SHARD_MERGE"]);
        expect(plan.stages[1]!.side?.map(node => node.stage)).toEqual(["IXSCAN"]);
    });
});

describe("hintsOf", () => {
    const find = { explain: { find: "orders", filter: { status: "paid", total: { $gt: 5 } }, sort: { createdAt: -1 } }, verbosity: "executionStats" };

    it("asks for an index on a large scan and names the sort in memory", () => {
        const hints = hintsOf(readExplain(collscan, "orders")!, find);
        expect(hints.map(hint => hint.key)).toEqual(["explain.hint.noIndex", "explain.hint.memorySort"]);
        expect(hints[0]!.index).toEqual({ collection: "orders", keys: { status: 1, createdAt: -1, total: 1 } });
        expect(hints[1]!.params.size).toBe("4.1 MB");
    });

    it("is quiet when the index fits", () => {
        expect(hintsOf(readExplain(ixscan, "orders")!, find)).toEqual([]);
    });

    it("offers an index on the other collection of a $lookup", () => {
        const command = { explain: { aggregate: "orders", pipeline: [{ $match: { status: "paid" } }], cursor: {} } };
        const [hint] = hintsOf(readExplain(lookup, "orders")!, command);
        expect(hint).toMatchObject({ key: "explain.hint.lookup", params: { collection: "customers", field: "email", scans: 1204 }, index: { collection: "customers", keys: { email: 1 } } });
    });

    it("leaves small scans and scans without filter alone", () => {
        const small = { executionStats: { nReturned: 1, executionStages: { stage: "COLLSCAN", filter: { a: 1 }, docsExamined: 900, nReturned: 1 } } };
        expect(hintsOf(readExplain(small, "c")!, find)).toEqual([]);
        const all = { executionStats: { nReturned: 5000, executionStages: { stage: "COLLSCAN", docsExamined: 50000, nReturned: 5000 } } };
        expect(hintsOf(readExplain(all, "c")!, find)).toEqual([]);
    });
});

describe("index suggestion and layout", () => {
    it("orders the keys equality, sort, range", () => {
        expect(indexFor({ $and: [{ a: 1 }, { b: { $gte: 2 } }], c: { $in: [1, 2] } }, { d: -1 })).toEqual({ a: 1, c: 1, d: -1, b: 1 });
        expect(querySide({ explain: { aggregate: "o", pipeline: [{ $sort: { x: 1 } }, { $match: { y: 2 } }] } })).toEqual({ collection: "o", filter: { y: 2 }, sort: { x: 1 } });
    });

    it("wraps a long flow into rows and widens arrows with the documents", () => {
        const placed = layoutPlan(["a", "b", "c", "d", "e"], 620);
        expect(placed.map(node => [node.row, node.x])).toEqual([[0, 0], [0, 202], [0, 404], [1, 0], [1, 202]]);
        expect(strokeFor(0, 100)).toBe(2);
        expect(strokeFor(100, 100)).toBe(20);
    });
});
