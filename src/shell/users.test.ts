import { describe, expect, it } from "vitest";
import { roleCommand, roleFormOf, userCommand, userFormErrors, userFormOf } from "./users";

describe("userCommand", () => {
    it("creates a user with two roles; a role without database is one of this database", () => {
        const command = userCommand({ user: " anna ", password: "secret", roles: [{ role: "readWrite", db: "" }, { role: "clusterMonitor", db: "admin" }, { role: " ", db: "" }] }, "shop", false);
        expect(command).toEqual({ createUser: "anna", pwd: "secret", roles: [{ role: "readWrite", db: "shop" }, { role: "clusterMonitor", db: "admin" }] });
    });

    it("updates without a password when none is typed, and keeps custom data", () => {
        expect(userCommand({ user: "anna", password: "", roles: [], customData: { team: "ops" } }, "shop", true)).toEqual({ updateUser: "anna", roles: [], customData: { team: "ops" } });
    });

    it("asks for a name, and for a password only for a new user", () => {
        expect(userFormErrors({ user: "", password: "", roles: [] }, false)).toEqual(["users.error.name", "users.error.password"]);
        expect(userFormErrors({ user: "anna", password: "", roles: [] }, true)).toEqual([]);
    });

    it("reads a user of usersInfo without its password", () => {
        expect(userFormOf({ _id: "shop.anna", user: "anna", db: "shop", roles: [{ role: "read", db: "shop" }], mechanisms: ["SCRAM-SHA-256"] }))
            .toEqual({ user: "anna", password: "", roles: [{ role: "read", db: "shop" }], customData: undefined });
    });
});

describe("roleCommand", () => {
    it("writes privileges on a collection and on the cluster, and inherited roles", () => {
        const command = roleCommand({
            role: "reporter",
            privileges: [
                { kind: "namespace", db: "shop", collection: "orders", actions: ["find"] },
                { kind: "cluster", db: "", collection: "", actions: ["serverStatus"] },
                { kind: "namespace", db: "shop", collection: "", actions: [] }
            ],
            roles: [{ role: "read", db: "" }]
        }, "shop", false);
        expect(command).toEqual({
            createRole: "reporter",
            privileges: [
                { resource: { db: "shop", collection: "orders" }, actions: ["find"] },
                { resource: { cluster: true }, actions: ["serverStatus"] }
            ],
            roles: [{ role: "read", db: "shop" }]
        });
    });

    it("reads a role of rolesInfo back into the form", () => {
        const form = roleFormOf({
            role: "reporter",
            db: "shop",
            privileges: [{ resource: { db: "shop", collection: "" }, actions: ["find", "listCollections"] }, { resource: { cluster: true }, actions: ["top"] }],
            roles: [{ role: "read", db: "shop" }]
        });
        expect(form).toEqual({
            role: "reporter",
            privileges: [
                { kind: "namespace", db: "shop", collection: "", actions: ["find", "listCollections"] },
                { kind: "cluster", db: "", collection: "", actions: ["top"] }
            ],
            roles: [{ role: "read", db: "shop" }]
        });
        expect(roleCommand(form, "shop", true).updateRole).toBe("reporter");
    });
});
