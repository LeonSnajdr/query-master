/** Folders of the tree lie in folders: a path such as `reports/2024`, parts joined with `/`. */

/** The folder a folder lies in; `undefined` at the top. */
export function parentFolder(folder: string): string | undefined {
    const at = folder.lastIndexOf("/");
    return at === -1 ? undefined : folder.slice(0, at);
}

/** The last part of a folder's path, as the tree shows it. */
export function folderLabel(folder: string): string {
    return folder.slice(folder.lastIndexOf("/") + 1);
}

/** `folder` is `inside` or lies in it, at any depth. */
export function folderWithin(folder: string, inside: string): boolean {
    return folder === inside || folder.startsWith(`${inside}/`);
}
