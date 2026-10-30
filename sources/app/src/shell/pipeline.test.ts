import { describe, expect, it } from "vitest";
import { parseStatements } from "./parse";
import { aggregateStatement, browseStages, findStatement, keepsDocuments, moveItem, newStage, optionsOf, pipelineText, previewStages, readStages, stagesOf, stagesOfQuery, stageTemplate, storedStages } from "./pipeline";

describe("aggregateStatement", () => {
    it("leaves stages that are switched off out", () => {
        const stages = [newStage("$match", "{ n: { $gt: 1 } }"), newStage("$sort", "{ n: -1 }", false), newStage("$limit", "5")];
        expect(aggregateStatement("orders", stages)).toBe("db.getCollection(\"orders\").aggregate([\n    { $match: { n: { $gt: 1 } } },\n    { $limit: 5 }\n])");
    });

    it("reports an empty stage instead of sending it", () => {
        expect(() => pipelineText([newStage("$group", "  ")])).toThrow("error.pipeline.emptyStage");
        expect(pipelineText([newStage("$group", "", false)])).toBe("[]");
    });

    it("reads a pipeline back into the same stages", () => {
        const text = aggregateStatement("orders", [newStage("$match", "{ status: \"open\" }"), newStage("$group", "{ _id: \"$customer\", total: { $sum: \"$amount\" } }")]);
        const stages = stagesOf(parseStatements(text)[0]!);
        expect(stages.map(stage => stage.operator)).toEqual(["$match", "$group"]);
        const again = aggregateStatement("orders", stages);
        expect(parseStatements(again)[0]!.args).toEqual(parseStatements(text)[0]!.args);
    });

    it("refuses what is no pipeline", () => {
        expect(() => stagesOf(parseStatements("db.orders.find({})")[0]!)).toThrow("error.pipeline.notAggregate");
        expect(() => stagesOf(parseStatements("db.orders.aggregate([{ $match: {}, $sort: {} }])")[0]!)).toThrow("error.pipeline.stageShape");
    });
});

describe("options and preview", () => {
    it("adds options only when there are some, and reads them back", () => {
        expect(aggregateStatement("orders", [], "{ }")).toBe("db.getCollection(\"orders\").aggregate([])");
        const text = aggregateStatement("orders", [], "{ allowDiskUse: true }");
        expect(text).toBe("db.getCollection(\"orders\").aggregate([], { allowDiskUse: true })");
        expect(optionsOf(parseStatements(text)[0]!)).toBe("{\n    allowDiskUse: true\n}");
    });

    it("looks up to a stage, never with a stage that writes", () => {
        const stages = [newStage("$match"), newStage("$out", "\"copy\""), newStage("$sort"), newStage("$limit")];
        expect(previewStages(stages, 2).map(stage => stage.operator)).toEqual(["$match", "$sort"]);
    });
});

describe("stageTemplate", () => {
    it("takes the snippet of the catalog without its places", () => {
        expect(stageTemplate("$limit")).toBe("10");
        expect(stageTemplate("$unwind")).toBe("\"$field\"");
        expect(stageTemplate("$group")).toBe("{\n    _id: \"$field\",\n    count: { $sum: 1 }\n}");
        expect(stageTemplate("$unknownStage")).toBe("{}");
    });
});

describe("keepsDocuments", () => {
    it("is true only for stages that keep the documents as they are", () => {
        expect(keepsDocuments([newStage("$match"), newStage("$sort"), newStage("$project", "{ a: 1 }", false)])).toBe(true);
        expect(keepsDocuments([newStage("$match"), newStage("$project", "{ a: 1 }")])).toBe(false);
        // An empty $project does nothing.
        expect(keepsDocuments([newStage("$project", "{ }")])).toBe(true);
    });
});

describe("moveItem", () => {
    it("takes an item out and puts it in at the place among the others", () => {
        expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
        expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
        expect(moveItem(["a", "b"], 1, 9)).toEqual(["a", "b"]);
        expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    });
});

describe("one builder for find and aggregate", () => {
    const find = (stages: ReturnType<typeof newStage>[], options = "") => findStatement("orders", stages, options);

    it("leaves empty $match, $project and $sort out", () => {
        expect(pipelineText(browseStages())).toBe("[]");
        expect(aggregateStatement("orders", [newStage("$match", "{ }"), newStage("$limit", "5")])).toBe("db.getCollection(\"orders\").aggregate([\n    { $limit: 5 }\n])");
    });

    it("runs as find while the stages are those of one, in its order", () => {
        expect(find(browseStages())).toBe("db.getCollection(\"orders\").find({})");
        const stages = [newStage("$match", "{ a: 1 }"), newStage("$sort", "{ b: -1 }"), newStage("$skip", "10"), newStage("$limit", "5"), newStage("$project", "{ a: 1 }")];
        expect(find(stages)).toBe("db.getCollection(\"orders\").find({ a: 1 }, { a: 1 }).sort({ b: -1 }).skip(10).limit(5)");
        // Switched off or empty, a stage does not count.
        expect(find([newStage("$project", "{ a: 1 }"), newStage("$sort", "{ }"), newStage("$match", "{ a: 1 }", false)])).toBe("db.getCollection(\"orders\").find({}, { a: 1 })");
    });

    it("runs as a pipeline otherwise", () => {
        expect(find([newStage("$project", "{ a: 1 }"), newStage("$sort", "{ a: 1 }")])).toBeUndefined();
        expect(find([newStage("$limit", "5"), newStage("$skip", "1")])).toBeUndefined();
        expect(find([newStage("$match", "{ a: 1 }"), newStage("$group", "{ _id: 1 }")])).toBeUndefined();
        expect(find([newStage("$match", "{ a: 1 }")], "{ allowDiskUse: true }")).toBeUndefined();
        expect(find([newStage("$limit", "")])).toBeUndefined();
    });

    it("takes a find or an aggregate apart into stages", () => {
        const [statement] = parseStatements("db.orders.find({ a: 1 }, { b: 1 }).sort({ c: 1 }).limit(3)");
        const stages = stagesOfQuery(statement!);
        expect(stages.map(stage => [stage.operator, stage.text])).toEqual([["$match", "{ a: 1 }"], ["$sort", "{ c: 1 }"], ["$limit", "3"], ["$project", "{ b: 1 }"]]);
        expect(find(stages)).toBe("db.getCollection(\"orders\").find({ a: 1 }, { b: 1 }).sort({ c: 1 }).limit(3)");
        expect(stagesOfQuery(parseStatements("db.orders.aggregate([{ $group: { _id: 1 } }])")[0]!).map(stage => stage.operator)).toEqual(["$group"]);
        expect(() => stagesOfQuery(parseStatements("db.orders.countDocuments({})")[0]!)).toThrow("error.pipeline.notQuery");
    });

    it("reads stages kept now and rows kept before", () => {
        const kept = storedStages([newStage("$match", "{ a: 1 }", true, true), newStage("$group", "{ _id: 1 }", false)]);
        expect(kept).toEqual([{ operator: "$match", text: "{ a: 1 }", enabled: true, json: true }, { operator: "$group", text: "{ _id: 1 }", enabled: false }]);
        expect(storedStages(readStages({ pipeline: kept })!)).toEqual(kept);
        const old = readStages({ stages: [{ name: "filter", text: "{ a: 1 }", enabled: true }, { name: "projection", text: "{ }", enabled: true }, { name: "sort", text: "{ b: 1 }", enabled: false }, { name: "limit", text: "5", enabled: true }] })!;
        expect(old.map(stage => [stage.operator, stage.enabled])).toEqual([["$match", true], ["$sort", false], ["$limit", true], ["$project", true]]);
        expect(readStages({ text: "db.a.find()" })).toBeUndefined();
    });
});
