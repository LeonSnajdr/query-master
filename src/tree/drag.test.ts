import { describe, expect, it } from "vitest";
import { canDrop } from "./drag";

describe("canDrop", () => {
    const rows = { connectionId: "c", scope: "shop", names: ["orders"] };

    it("puts rows into a folder of their database or out of all", () => {
        expect(canDrop(rows, { connectionId: "c", scope: "shop", folder: "archive" })).toBe(true);
        expect(canDrop(rows, { connectionId: "c", scope: "shop" })).toBe(true);
        expect(canDrop(rows, { connectionId: "c", scope: "crm", folder: "archive" })).toBe(false);
        expect(canDrop(rows, { connectionId: "d", scope: "shop" })).toBe(false);
        // Databases into a folder of the connection, not of a database.
        expect(canDrop({ connectionId: "c", scope: "", names: ["shop"] }, { connectionId: "c", scope: "", folder: "work" })).toBe(true);
        expect(canDrop({ connectionId: "c", scope: "", names: ["shop"] }, { connectionId: "c", scope: "shop", folder: "work" })).toBe(false);
    });

    it("moves a folder into another one or to the top, not into itself", () => {
        const folder = { connectionId: "c", scope: "shop", folder: "reports/2024" };
        expect(canDrop(folder, { connectionId: "c", scope: "shop", folder: "archive" })).toBe(true);
        expect(canDrop(folder, { connectionId: "c", scope: "shop" })).toBe(true);
        expect(canDrop(folder, { connectionId: "c", scope: "shop", folder: "reports" })).toBe(false);
        expect(canDrop(folder, { connectionId: "c", scope: "shop", folder: "reports/2024" })).toBe(false);
        expect(canDrop(folder, { connectionId: "c", scope: "shop", folder: "reports/2024/q1" })).toBe(false);
        expect(canDrop({ connectionId: "c", scope: "shop", folder: "top" }, { connectionId: "c", scope: "shop" })).toBe(false);
    });
});
