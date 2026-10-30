import { describe, expect, it } from "vitest";
import { bucketOf, bucketsOf, bucketIndexes, treeCollections } from "./gridfs";

const COLLECTIONS = ["fs.chunks", "fs.files", "images.files", "orders", "photos.chunks", "photos.files"];

describe("GridFS buckets", () => {
    it("finds a bucket only where both collections are there", () => {
        expect(bucketsOf(COLLECTIONS)).toEqual(["fs", "photos"]);
        expect(bucketOf("photos.files", COLLECTIONS)).toBe("photos");
        expect(bucketOf("images.files", COLLECTIONS)).toBeUndefined();
    });

    it("shows a bucket once in the tree", () => {
        expect(treeCollections(COLLECTIONS)).toEqual(["fs.files", "images.files", "orders", "photos.files"]);
    });

    it("creates the indexes the drivers expect", () => {
        expect(bucketIndexes("photos")[1]!.command).toEqual({
            createIndexes: "photos.chunks",
            indexes: [{ key: { files_id: 1, n: 1 }, name: "files_id_1_n_1", unique: true }]
        });
    });
});
