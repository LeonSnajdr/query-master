import { describe, expect, it } from "vitest";
import { formatCode } from "./format";

describe("formatCode", () => {
    it("formats a script with four spaces, keeping the absence of semicolons", async () => {
        const text = "db.getCollection(\"orders\").find({status:\"open\",\"total\":{$gt:10}}).sort({n:-1})\nprint( 'x' )";
        const { text: formatted } = await formatCode(text, "script");
        expect(formatted).toBe("db.getCollection(\"orders\")\n    .find({ status: \"open\", total: { $gt: 10 } })\n    .sort({ n: -1 })\nprint(\"x\")");
        expect((await formatCode("var a=1;\nprint(a);", "script")).text).toBe("var a = 1;\nprint(a);");
    });

    it("keeps comments", async () => {
        expect((await formatCode("// open ones\ndb.orders.find({status:'open'}) // all", "script")).text).toBe("// open ones\ndb.orders.find({ status: \"open\" }) // all");
    });

    it("formats one value, also a document written alone in the script editor", async () => {
        const long = "{ _id: ObjectId(\"64b7f0c2a1b2c3d4e5f60718\"), customer: { name: \"Anna Berger\", city: \"Wien\" }, items: [1, 2, 3], total: 19.99 }";
        const value = await formatCode(long, "value");
        expect(value.text).toBe("{\n    _id: ObjectId(\"64b7f0c2a1b2c3d4e5f60718\"),\n    customer: { name: \"Anna Berger\", city: \"Wien\" },\n    items: [1, 2, 3],\n    total: 19.99\n}");
        expect((await formatCode(long, "script")).text).toBe(value.text);
        expect((await formatCode("{status:'open'}", "value")).text).toBe("{ status: \"open\" }");
        expect((await formatCode("10", "value")).text).toBe("10");
    });

    it("formats strict JSON as JSON", async () => {
        expect((await formatCode("{\"n\":{\"$numberInt\":\"1\"}}", "json")).text).toBe("{ \"n\": { \"$numberInt\": \"1\" } }");
    });

    it("formats SQL with keywords in capitals", async () => {
        expect((await formatCode("select name, n from orders where n > 1 order by n desc", "sql")).text).toBe("SELECT\n    name,\n    n\nFROM\n    orders\nWHERE\n    n > 1\nORDER BY\n    n DESC");
    });

    it("says where the text is wrong and leaves empty text alone", async () => {
        await expect(formatCode("db.orders.find({ status: })", "script")).rejects.toThrow("error.format.syntax");
        expect((await formatCode("  ", "script")).text).toBe("  ");
    });

    it("keeps the cursor at its place in the code", async () => {
        const text = "db.orders.find({a:1})";
        const { text: formatted, cursor } = await formatCode(text, "script", text.indexOf("a:"));
        expect(formatted.slice(cursor, cursor + 2)).toBe("a:");
    });
});
