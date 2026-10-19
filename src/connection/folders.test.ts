import { describe, expect, it } from "vitest";
import { allFolders, countIn, flatten, folderPath, folderTree, groupRows, parentFolder, pruneFolders, within } from "./folders";

const prod = { name: "Prod", groupName: "Kunden/Produktion" };
const test = { name: "Test", groupName: "Kunden" };
const demo = { name: "Demo", groupName: "" };

describe("folders of connections", () => {
    it("writes paths as stored and knows their parent", () => {
        expect(folderPath(" Kunden / /Produktion ")).toBe("Kunden/Produktion");
        expect(parentFolder("Kunden/Produktion")).toBe("Kunden");
        expect(parentFolder("Kunden")).toBe("");
        expect(within("Kunden/Produktion", "Kunden")).toBe(true);
        expect(within("Kundenservice", "Kunden")).toBe(false);
    });

    it("takes the kept folders, those of the connections and the folders above them", () => {
        expect(allFolders(["Intern"], [prod, demo])).toEqual(["Intern", "Kunden", "Kunden/Produktion"]);
    });

    it("builds the tree; connections in no folder stand at the top", () => {
        const { folders, top } = folderTree(["Intern"], [prod, test, demo]);
        expect(top).toEqual([demo]);
        expect(folders.map(folder => folder.path)).toEqual(["Intern", "Kunden"]);
        const kunden = folders[1]!;
        expect(kunden.items).toEqual([test]);
        expect(kunden.folders[0]).toMatchObject({ path: "Kunden/Produktion", name: "Produktion", depth: 1, items: [prod] });
        expect(countIn(kunden)).toBe(2);
        expect(countIn(folders[0]!)).toBe(0);
        expect(flatten(folders).map(folder => folder.path)).toEqual(["Intern", "Kunden", "Kunden/Produktion"]);
    });
});

describe("rows of the folders", () => {
    it("shows folders first, then the connections; a closed folder hides what it holds", () => {
        const { folders, top } = folderTree(["Intern"], [prod, test, demo]);
        const shown = (closed: string[]) => groupRows(folders, top, new Set(closed)).map(row => (row.kind === "folder" ? `${"  ".repeat(row.depth)}[${row.node.name}]` : `${"  ".repeat(row.depth)}${row.item.name}`));
        expect(shown([])).toEqual(["[Intern]", "[Kunden]", "  [Produktion]", "    Prod", "  Test", "Demo"]);
        expect(shown(["Kunden"])).toEqual(["[Intern]", "[Kunden]", "Demo"]);
    });

    it("keeps the folders asked for and those above them", () => {
        const { folders } = folderTree(["Intern"], [prod, test]);
        const kept = pruneFolders(folders, node => node.items.some(item => item.name === "Prod"));
        expect(flatten(kept).map(folder => folder.path)).toEqual(["Kunden", "Kunden/Produktion"]);
    });
});
