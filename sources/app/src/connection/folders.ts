/**
 * Folders of saved connections, nested with "/" (`Kunden/Produktion`): the same in the connection
 * list (F2) and in the tree of the dock. A connection names its folder in `groupName`; a folder
 * without connections is kept by the backend. A connection in no folder stands at the top.
 */

/** Something that lies in a folder: a saved connection. */
export interface InFolder {
    groupName?: string | null;
}

/** A folder with what lies directly in it. */
export interface FolderNode<T> {
    /** The whole path, as stored: `Kunden/Produktion`. */
    path: string;
    /** The last part, as shown: `Produktion`. */
    name: string;
    depth: number;
    folders: FolderNode<T>[];
    items: T[];
}

/** A path as stored: its parts trimmed, empty parts dropped. */
export function folderPath(name: string): string {
    return name.split("/").map(part => part.trim()).filter(part => part !== "").join("/");
}

/** The folder a folder lies in; empty at the top. */
export function parentFolder(path: string): string {
    const at = path.lastIndexOf("/");
    return at === -1 ? "" : path.slice(0, at);
}

/** Whether `path` is `folder` or lies somewhere inside it. */
export function within(path: string, folder: string): boolean {
    return path === folder || path.startsWith(`${folder}/`);
}

/** Every folder: those kept, those items name, and the folders above them, sorted. */
export function allFolders(kept: string[], items: InFolder[]): string[] {
    const found = new Set<string>();
    for (const name of [...kept, ...items.map(item => item.groupName ?? "")]) {
        const path = folderPath(name);
        const parts = path ? path.split("/") : [];
        parts.forEach((_, index) => found.add(parts.slice(0, index + 1).join("/")));
    }
    return [...found].sort((a, b) => a.localeCompare(b));
}

/**
 * The folders as a tree with their items; the items in no folder come back as `top`. Folders are
 * sorted by name; items keep the order they come in.
 */
export function folderTree<T extends InFolder>(folders: string[], items: T[]): { folders: FolderNode<T>[]; top: T[] } {
    const nodes = new Map<string, FolderNode<T>>();
    const roots: FolderNode<T>[] = [];
    for (const path of allFolders(folders, items)) {
        const parts = path.split("/");
        const node: FolderNode<T> = { path, name: parts.at(-1)!, depth: parts.length - 1, folders: [], items: [] };
        nodes.set(path, node);
        const parent = nodes.get(parentFolder(path));
        if (parent) parent.folders.push(node);
        else roots.push(node);
    }
    const top: T[] = [];
    for (const item of items) {
        const node = nodes.get(folderPath(item.groupName ?? ""));
        if (node) node.items.push(item);
        else top.push(item);
    }
    return { folders: roots, top };
}

/** How many items lie in a folder and the folders inside it. */
export function countIn<T>(node: FolderNode<T>): number {
    return node.items.length + node.folders.reduce((total, folder) => total + countIn(folder), 0);
}

/** A folder and the folders inside it, flat, in the order the tree shows them. */
export function flatten<T>(nodes: FolderNode<T>[]): FolderNode<T>[] {
    return nodes.flatMap(node => [node, ...flatten(node.folders)]);
}

/** A row of the list or the tree: a folder of connections, or what lies in one, with its depth. */
export type GroupRow<T> = { kind: "folder"; node: FolderNode<T>; depth: number } | { kind: "item"; item: T; depth: number };

/** The rows as the list and the tree show them: folders first, then the items; closed folders without what they hold. */
export function groupRows<T>(nodes: FolderNode<T>[], top: T[], closed: ReadonlySet<string>, depth = 0): GroupRow<T>[] {
    const rows: GroupRow<T>[] = [];
    for (const node of nodes) {
        rows.push({ kind: "folder", node, depth });
        if (!closed.has(node.path)) rows.push(...groupRows(node.folders, node.items, closed, depth + 1));
    }
    rows.push(...top.map(item => ({ kind: "item" as const, item, depth })));
    return rows;
}

/** The folders `keep` wants, with those above them; the others are left out with what they hold. */
export function pruneFolders<T>(nodes: FolderNode<T>[], keep: (node: FolderNode<T>) => boolean): FolderNode<T>[] {
    return nodes.flatMap((node) => {
        const folders = pruneFolders(node.folders, keep);
        return folders.length > 0 || keep(node) ? [{ ...node, folders }] : [];
    });
}
