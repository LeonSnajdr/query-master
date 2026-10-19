import { describe, expect, it } from "vitest";
import { STAGES } from "./catalog";
import { formatCode } from "./format";
import { browseStages, stageTemplate } from "./pipeline";

/** Formatting a value the app starts with changes nothing: it is written as the formatter writes it. */
describe("default values are formatted already", () => {
    it.each([
        ...browseStages().map(stage => [stage.operator, stage.text] as const),
        ...STAGES.map(stage => [stage.name, stageTemplate(stage.name)] as const)
    ])("%s", async (_, text) => {
        expect((await formatCode(text, "value")).text).toBe(text);
    });
});
