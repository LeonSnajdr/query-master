import { reactive } from "vue";

/**
 * The card that follows the pointer while rows are dragged: what moves (icon, name, how many) and
 * where it would land, or that it can not land there. One for the whole app (`DragGhost.vue`).
 */
const ghost = reactive({
    visible: false,
    x: 0,
    y: 0,
    icon: "",
    label: "",
    /** More than one row moves: how many. */
    count: 1,
    /** Where a drop would put it; `undefined`: not here. */
    target: undefined as string | undefined
});

export function useDragGhost() {
    /** Starts showing what is dragged, at the pointer. */
    function show(what: { icon: string; label: string; count?: number }, x: number, y: number): void {
        Object.assign(ghost, { visible: true, x, y, icon: what.icon, label: what.label, count: what.count ?? 1, target: undefined });
    }

    /** Follows the pointer and says where a drop would land (`undefined`: not here). */
    function move(x: number, y: number, target: string | undefined): void {
        Object.assign(ghost, { x, y, target });
    }

    function hide(): void {
        ghost.visible = false;
    }

    return { ghost, show, move, hide };
}
