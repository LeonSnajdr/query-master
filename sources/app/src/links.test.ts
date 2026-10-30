import { describe, expect, it } from "vitest";
import { isLink } from "./links";

describe("isLink", () => {
    it("takes web addresses only, as the whole value", () => {
        expect(isLink("https://bucket.s3.amazonaws.com/a/b.png?x=1")).toBe(true);
        expect(isLink("HTTP://example.org")).toBe(true);
        expect(isLink("see https://example.org")).toBe(false);
        expect(isLink("javascript:alert(1)")).toBe(false);
        expect(isLink("file:///C:/x")).toBe(false);
        expect(isLink("https://exa mple.org")).toBe(false);
        expect(isLink(5)).toBe(false);
    });
});
