import { describe, expect, it, vi } from "vitest";
import { isFreeSpace, useFreeSpace } from "./freeSpace";

/** A click whose target is a row when `onRow`, else the free space. */
function click(onRow: boolean) {
    return {
        target: { closest: (selector: string) => (onRow && selector.includes("treeitem") ? {} : null) },
        preventDefault: vi.fn()
    } as unknown as MouseEvent;
}

describe("free space of a list", () => {
    it("tells a row from the space around it", () => {
        expect(isFreeSpace(click(true))).toBe(false);
        expect(isFreeSpace(click(false))).toBe(true);
        expect(isFreeSpace({ target: null })).toBe(true);
    });

    it("leaves a click on a control to the control", () => {
        const onButton = { target: { closest: (selector: string) => (selector.includes("button") ? {} : null) } };
        expect(isFreeSpace(onButton)).toBe(false);
    });

    it("clears the selection on a left click into the space, not on a row", () => {
        const clear = vi.fn();
        const space = useFreeSpace(clear);
        space.onClick(click(true));
        expect(clear).not.toHaveBeenCalled();
        space.onClick(click(false));
        expect(clear).toHaveBeenCalledOnce();
    });

    it("clears the selection before the menu of the space opens on a right click", () => {
        const order: string[] = [];
        const space = useFreeSpace(() => order.push("clear"), { menu: () => order.push("menu") });
        const event = click(false);
        space.onContextMenu(event);
        expect(order).toEqual(["clear", "menu"]);
        expect(event.preventDefault).toHaveBeenCalled();
        space.onContextMenu(click(true));
        expect(order).toEqual(["clear", "menu"]);
    });
});
