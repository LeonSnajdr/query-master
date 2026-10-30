import { describe, expect, it } from "vitest";
import { convertQueryText, parseValue } from "./parse";

describe("convertQueryText", () => {
    const shell = `{ _id: ObjectId("64b7f0c2a1b2c3d4e5f60718"), at: { $gte: ISODate("2024-05-01T00:00:00Z") }, n: 5 }`;

    it("turns shell notation into strict extended JSON and back, the same value", () => {
        const json = convertQueryText(shell, true);
        expect(JSON.parse(json)._id).toEqual({ $oid: "64b7f0c2a1b2c3d4e5f60718" });
        expect(parseValue(json)).toEqual(parseValue(shell));
        const back = convertQueryText(json, false);
        expect(back).toContain(`ObjectId("64b7f0c2a1b2c3d4e5f60718")`);
        expect(back).not.toContain("\n");
        expect(parseValue(back)).toEqual(parseValue(shell));
    });

    it("leaves empty text alone", () => {
        expect(convertQueryText("  ", true)).toBe("  ");
    });
});
