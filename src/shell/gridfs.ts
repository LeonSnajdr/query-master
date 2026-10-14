import type { Doc } from "@/shell/ejson";

/** The GridFS buckets among the collections: a `<name>.files` with its `<name>.chunks`. */
export function bucketsOf(collections: string[]): string[] {
    return collections
        .filter(name => name.endsWith(".files") && collections.includes(`${name.slice(0, -".files".length)}.chunks`))
        .map(name => name.slice(0, -".files".length));
}

/** The bucket a collection of the tree stands for, when it is the `.files` of one. */
export function bucketOf(collection: string, collections: string[]): string | undefined {
    return bucketsOf(collections).find(bucket => collection === `${bucket}.files`);
}

/** The rows of the tree: a bucket shows once, as its `.files`; its `.chunks` is left out. */
export function treeCollections(collections: string[]): string[] {
    const buckets = bucketsOf(collections);
    return collections.filter(name => !buckets.some(bucket => name === `${bucket}.chunks`));
}

/** What makes a pair of collections a bucket, as the drivers create it on the first upload. */
export function bucketIndexes(bucket: string): { collection: string; command: Doc }[] {
    return [
        { collection: `${bucket}.files`, command: { createIndexes: `${bucket}.files`, indexes: [{ key: { filename: 1, uploadDate: 1 }, name: "filename_1_uploadDate_1" }] } },
        { collection: `${bucket}.chunks`, command: { createIndexes: `${bucket}.chunks`, indexes: [{ key: { files_id: 1, n: 1 }, name: "files_id_1_n_1", unique: true }] } }
    ];
}
