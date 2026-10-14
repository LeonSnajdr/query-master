import { describe, expect, it } from "vitest";
import { fileName } from "./transfer";

describe("fileName", () => {
    it("keeps collection names Windows takes, and replaces the characters it does not", () => {
        expect(fileName("orders.2024")).toBe("orders.2024");
        expect(fileName("a/b:c*d?\"e\"<f>|g\\h")).toBe("a_b_c_d__e__f__g_h");
    });
});
