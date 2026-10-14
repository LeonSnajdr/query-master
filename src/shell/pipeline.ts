import { STAGES } from "@/shell/catalog";
import { isDoc, toShell } from "@/shell/ejson";
import { ShellError } from "@/shell/message";
import type { Statement } from "@/shell/parse";

/** One row of the aggregation builder: a stage operator and the text of its value. */
export interface PipelineStage {
    id: number;
    /** With its `$`, as `$match`. */
    operator: string;
    text: string;
    enabled: boolean;
}

/** Stages after which the documents are still those of the collection, and can be edited. */
const SHAPE_KEEPING = ["$match", "$sort", "$skip", "$limit", "$sample"];
/** Stages that write; never run for a preview. */
export const WRITING_STAGES = ["$out", "$merge"];

let nextId = 0;

export function newStage(operator: string, text = stageTemplate(operator), enabled = true): PipelineStage {
    return { id: ++nextId, operator, text, enabled };
}

/**
 * The value a new stage starts with: its snippet from the catalog without the operator, the places
 * to fill in replaced by their default (`$limit: ${10}` gives `10`).
 */
export function stageTemplate(operator: string): string {
    const snippet = STAGES.find(entry => entry.name === operator)?.snippet;
    if (!snippet) return "{ }";
    return snippet
        .slice(snippet.indexOf(":") + 1)
        .trim()
        .replace(/\$\{([^}]*)\}/g, "$1")
        .replaceAll("\t", "    ");
}

/** The stages that are switched on, as the text of the pipeline array. */
export function pipelineText(stages: PipelineStage[]): string {
    const parts = stages.filter(stage => stage.enabled).map((stage) => {
        if (stage.text.trim() === "") throw new ShellError("error.pipeline.emptyStage", { operator: stage.operator });
        return `{ ${stage.operator}: ${stage.text.trim()} }`;
    });
    return parts.length === 0 ? "[]" : `[\n    ${parts.join(",\n    ")}\n]`;
}

/** The shell statement the builder stands for. */
export function aggregateStatement(collection: string, stages: PipelineStage[]): string {
    return `db.getCollection(${JSON.stringify(collection)}).aggregate(${pipelineText(stages)})`;
}

/** The rows of an `aggregate` statement, for one pasted or chosen from the history. */
export function stagesOf(statement: Statement): PipelineStage[] {
    if (statement.method !== "aggregate" || !Array.isArray(statement.args[0])) throw new ShellError("error.pipeline.notAggregate");
    return statement.args[0].map((item) => {
        const entries = isDoc(item) ? Object.entries(item) : [];
        if (entries.length !== 1) throw new ShellError("error.pipeline.stageShape");
        const [operator, value] = entries[0]!;
        return newStage(operator, toShell(value));
    });
}

/** Whether the result still consists of documents of the collection, unchanged. */
export function keepsDocuments(stages: PipelineStage[]): boolean {
    return stages.filter(stage => stage.enabled).every(stage => SHAPE_KEEPING.includes(stage.operator));
}
