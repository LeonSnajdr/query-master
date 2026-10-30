import { describe, expect, it } from "vitest";
import { ShellError } from "@/shell/message";
import { parseStatements } from "@/shell/parse";
import { likePattern, sqlCollection, sqlToShell } from "./sql";

/** What the shell reads from the statement: method and arguments. */
function read(sql: string) {
    const [statement] = parseStatements(sqlToShell(sql));
    return { method: statement!.method, collection: statement!.collection, args: statement!.args, modifiers: statement!.modifiers.map(item => [item.name, item.args[0]]) };
}

function errorOf(sql: string): ShellError {
    try {
        sqlToShell(sql);
    } catch (error) {
        if (error instanceof ShellError) return error;
        throw error;
    }
    throw new Error("no error");
}

describe("sqlToShell", () => {
    it("turns a plain SELECT into a find with projection, sort, skip and limit", () => {
        expect(read("select name, customer.city from orders where total >= 100 and status <> 'void' order by total desc, name limit 10 offset 20")).toEqual({
            method: "find",
            collection: "orders",
            args: [{ $and: [{ total: { $gte: 100 } }, { status: { $ne: "void" } }] }, { "name": 1, "customer.city": 1 }],
            modifiers: [["sort", { total: -1, name: 1 }], ["skip", 20], ["limit", 10]]
        });
        expect(read("SELECT * FROM orders")).toEqual({ method: "find", collection: "orders", args: [{}], modifiers: [] });
    });

    it("binds AND tighter than OR and keeps brackets", () => {
        expect(read("select * from t where a = 1 or b = 2 and c = 3").args[0]).toEqual({ $or: [{ a: 1 }, { $and: [{ b: 2 }, { c: 3 }] }] });
        expect(read("select * from t where (a = 1 or b = 2) and not c = 3").args[0]).toEqual({ $and: [{ $or: [{ a: 1 }, { b: 2 }] }, { $nor: [{ c: 3 }] }] });
    });

    it("reads IN, BETWEEN, IS NULL, LIKE and typed values", () => {
        expect(read("select * from t where s in ('a', 'b') and n not in (1) and d between ISODate('2024-01-01') and ISODate('2024-02-01') and x is null and y is not null and _id = ObjectId('64b7f0c2a1b2c3d4e5f60718') and ok = true").args[0]).toEqual({
            $and: [
                { s: { $in: ["a", "b"] } },
                { n: { $nin: [1] } },
                { d: { $gte: { $date: { $numberLong: "1704067200000" } }, $lte: { $date: { $numberLong: "1706745600000" } } } },
                { x: null },
                { y: { $ne: null } },
                { _id: { $oid: "64b7f0c2a1b2c3d4e5f60718" } },
                { ok: true }
            ]
        });
        expect(read("select * from t where name like 'An%.d_' and city not like '%x'").args[0]).toEqual({
            $and: [
                { name: { $regularExpression: { pattern: "^An.*\\.d.$", options: "" } } },
                { city: { $not: { $regularExpression: { pattern: "^.*x$", options: "" } } } }
            ]
        });
    });

    it("groups with aggregates, HAVING on their names, sorting and limit", () => {
        expect(read("select customer.city, count(*) as orders, sum(total) from orders where status = 'open' group by customer.city having orders > 2 order by orders desc limit 5")).toEqual({
            method: "aggregate",
            collection: "orders",
            args: [[
                { $match: { status: "open" } },
                { $group: { _id: { customer_city: "$customer.city" }, orders: { $sum: 1 }, sum_total: { $sum: "$total" } } },
                { $project: { _id: 0, customer_city: "$_id.customer_city", orders: 1, sum_total: 1 } },
                { $match: { orders: { $gt: 2 } } },
                { $sort: { orders: -1 } },
                { $limit: 5 }
            ]],
            modifiers: []
        });
    });

    it("counts everything, and DISTINCT groups by the fields chosen", () => {
        expect(read("select count(*) from orders").args[0]).toEqual([
            { $group: { _id: null, count: { $sum: 1 } } },
            { $project: { _id: 0, count: 1 } }
        ]);
        expect(read("select distinct status from orders").args[0]).toEqual([
            { $group: { _id: { status: "$status" } } },
            { $project: { _id: 0, status: "$_id.status" } }
        ]);
    });

    it("renames fields with AS through a pipeline", () => {
        expect(read("select name as who from people where age > 30").args[0]).toEqual([
            { $match: { age: { $gt: 30 } } },
            { $project: { _id: 0, who: "$name" } }
        ]);
    });

    it("says what was expected and where", () => {
        // Without a comma or FROM, "form" is an alias of name; the next word is out of place.
        const error = errorOf("select * orders");
        expect(error.key).toBe("error.sql.expected");
        expect(error.position).toBe(9);
        expect(error.params).toEqual({ what: "FROM", found: "orders" });
        expect(errorOf("select name, count(*) from t").key).toBe("error.sql.notGrouped");
        expect(errorOf("select * from t where name = 'x").key).toBe("error.sql.unclosedString");
        expect(errorOf("select sum(*) from t").key).toBe("error.sql.starOnlyInCount");
        expect(errorOf("").key).toBe("error.sql.empty");
    });
});

describe("helpers", () => {
    it("escapes what LIKE takes literally", () => {
        expect(likePattern("a+b(1)%")).toBe("^a\\+b\\(1\\).*$");
    });

    it("finds the collection after FROM", () => {
        expect(sqlCollection("select * from orders where")).toBe("orders");
        expect(sqlCollection("select * ")).toBeUndefined();
    });
});
