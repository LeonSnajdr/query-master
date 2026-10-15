import { describe, expect, it } from "vitest";
import { scriptErrorPosition } from "./message";

describe("scriptErrorPosition", () => {
    const source = "var a = 1;\n  nope();\n";

    it("turns the place of the engine into an offset", () => {
        expect(scriptErrorPosition("ReferenceError: nope is not defined\n    at <eval> (script:2:3)", source)).toBe(13);
        expect(scriptErrorPosition("SyntaxError: variable name expected\n    at script:1:5", source)).toBe(4);
    });

    it("skips places in the runtime and clamps to the text", () => {
        expect(scriptErrorPosition("Error: x\n    at fail (eval_script:12:9)\n    at <eval> (script:2:99)", source)).toBe(20);
        expect(scriptErrorPosition("Error: x\n    at fail (eval_script:12:9)", source)).toBeUndefined();
        expect(scriptErrorPosition("at script:9:1", source)).toBe(source.length);
    });
});
