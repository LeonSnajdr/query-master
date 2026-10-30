import { describe, expect, it } from "vitest";
import type { Doc } from "./ejson";
import { NEW_MEMBER, lockedFields, memberProblems, membersOf, parseTags, withMember, withoutMember } from "./replicaSet";

const config: Doc = {
    _id: "rs0",
    version: { $numberInt: "3" },
    members: [
        { _id: { $numberInt: "0" }, host: "db1:27017", priority: { $numberDouble: "2.0" }, votes: { $numberInt: "1" }, tags: { dc: "east" } },
        { _id: { $numberInt: "2" }, host: "db2:27017", priority: { $numberInt: "0" }, votes: { $numberInt: "1" }, hidden: true }
    ]
};
const status: Doc = { members: [{ name: "db1:27017", stateStr: "PRIMARY", health: { $numberDouble: "1.0" }, self: true }] };

describe("replica set members", () => {
    it("reads the configuration and the state of each member", () => {
        expect(membersOf(config, status)).toEqual([
            { id: 0, host: "db1:27017", priority: 2, votes: 1, arbiterOnly: false, hidden: false, tags: { dc: "east" }, state: "PRIMARY", healthy: true, self: true },
            { id: 2, host: "db2:27017", priority: 0, votes: 1, arbiterOnly: false, hidden: true, tags: {} }
        ]);
    });

    it("reads tags and refuses a pair without name or value", () => {
        expect(parseTags(" dc: west , rack:1 ")).toEqual({ dc: "west", rack: "1" });
        expect(parseTags("")).toEqual({});
        expect(parseTags("dc")).toBeUndefined();
        expect(parseTags("dc:")).toBeUndefined();
    });

    it("names what the server would refuse", () => {
        const members = membersOf(config);
        expect(memberProblems(NEW_MEMBER, members)).toEqual(["replicaSet.error.host"]);
        expect(memberProblems({ ...NEW_MEMBER, host: "db3" }, members)).toEqual(["replicaSet.error.hostPort"]);
        expect(memberProblems({ ...NEW_MEMBER, host: "DB1:27017" }, members)).toEqual(["replicaSet.error.exists"]);
        expect(memberProblems({ ...NEW_MEMBER, host: "db3:27017", priority: 1001, tags: "x" }, members)).toEqual(["replicaSet.error.priority", "replicaSet.error.tags"]);
        // An arbiter's priority and tags are not its own: they are not checked.
        expect(memberProblems({ ...NEW_MEMBER, host: "db3:27017", arbiterOnly: true, priority: -1, tags: "x" }, members)).toEqual([]);
    });

    it("greys what an arbiter, a hidden member and one without a vote can not choose", () => {
        expect(lockedFields(NEW_MEMBER)).toEqual({ priority: false, votes: false, hidden: false, tags: false });
        expect(lockedFields({ ...NEW_MEMBER, arbiterOnly: true })).toEqual({ priority: true, votes: true, hidden: true, tags: true });
        expect(lockedFields({ ...NEW_MEMBER, hidden: true }).priority).toBe(true);
        expect(lockedFields({ ...NEW_MEMBER, votes: 0 }).priority).toBe(true);
    });

    it("adds a member with the next _id and a higher version", () => {
        const changed = withMember(config, { ...NEW_MEMBER, host: " db3:27017 ", priority: 5, hidden: true, tags: "dc: west" });
        expect(changed.version).toBe(4);
        expect((changed.members as unknown[]).at(-1)).toEqual({ _id: 3, host: "db3:27017", priority: 0, votes: 1, hidden: true, tags: { dc: "west" } });
        expect((withMember(config, { ...NEW_MEMBER, host: "arb:27017", arbiterOnly: true }).members as unknown[]).at(-1)).toEqual({ _id: 3, host: "arb:27017", arbiterOnly: true });
    });

    it("removes a member by _id", () => {
        const changed = withoutMember(config, 2);
        expect(changed.version).toBe(4);
        expect(membersOf(changed).map(member => member.host)).toEqual(["db1:27017"]);
    });
});
