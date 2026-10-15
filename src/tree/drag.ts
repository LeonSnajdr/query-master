import { folderWithin, parentFolder } from "./folders";

/**
 * What is dragged in the tree: collections or databases (`names`), or one folder. `scope` is the
 * database whose collections are meant, `""` for the databases of the connection.
 */
export interface DragSource {
    connectionId: string;
    scope: string;
    names?: string[];
    folder?: string;
}

/** Where it is dropped: a folder of the same scope, or (`folder` absent) out of all folders. */
export interface DropTarget {
    connectionId: string;
    scope: string;
    folder?: string;
}

/**
 * Whether the drop does something: rows go into the folder (or out), a folder goes into the other
 * folder (or to the top). Folders stay in their database or connection; a folder does not go into
 * itself, into a folder inside it, or where it already is.
 */
export function canDrop(source: DragSource, target: DropTarget): boolean {
    if (source.connectionId !== target.connectionId || source.scope !== target.scope) return false;
    if (source.folder === undefined) return (source.names?.length ?? 0) > 0;
    if (target.folder !== undefined && folderWithin(target.folder, source.folder)) return false;
    return parentFolder(source.folder) !== target.folder;
}

/** Reads a drop target from the `data-drop-*` attributes of a row. */
export function dropTargetOf(element: HTMLElement): DropTarget | undefined {
    const { dropConnection, dropScope, dropFolder } = element.dataset;
    if (dropConnection === undefined || dropScope === undefined) return undefined;
    return dropFolder === undefined ? { connectionId: dropConnection, scope: dropScope } : { connectionId: dropConnection, scope: dropScope, folder: dropFolder };
}
