import { describe, expect, it } from "vitest";
import { parseStatements } from "./parse";
import { aggregateStatement, keepsDocuments, newStage, pipelineText, stagesOf, stageTemplate } from "./pipeline";

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

describe("stageTemplate", () => {
    it("takes the snippet of the catalog without its places", () => {
        expect(stageTemplate("$limit")).toBe("10");
        expect(stageTemplate("$unwind")).toBe("\"$field\"");
        expect(stageTemplate("$group")).toBe("{\n    _id: \"$field\",\n    count: { $sum: 1 }\n}");
        expect(stageTemplate("$unknownStage")).toBe("{ }");
    });
});

describe("keepsDocuments", () => {
    it("is true only for stages that keep the documents as they are", () => {
        expect(keepsDocuments([newStage("$match"), newStage("$sort"), newStage("$project", "{ a: 1 }", false)])).toBe(true);
        expect(keepsDocuments([newStage("$match"), newStage("$project")])).toBe(false);
    });
});
