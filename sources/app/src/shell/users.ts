import { isDoc } from "@/shell/ejson";
import type { Doc, Json } from "@/shell/ejson";

/** A role granted to a user or inherited by a role: its name and the database it is defined in. */
export interface RoleRef {
    role: string;
    db: string;
}

/** Built-in roles every server knows, for the choice next to the roles a database defines. */
/** Letters, digits and signs a typed password can hold without trouble in a URI or a shell. */
const PASSWORD_SIGNS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.~!*";

/** A new password of `length` signs from the random source of the system (*Generate*). */
export function generatePassword(length = 20): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    const limit = 256 - (256 % PASSWORD_SIGNS.length);
    // Bytes above the last whole round are skipped, so every sign is equally likely.
    const signs = [...bytes].filter(byte => byte < limit).map(byte => PASSWORD_SIGNS[byte % PASSWORD_SIGNS.length]!);
    return signs.length >= length ? signs.slice(0, length).join("") : generatePassword(length);
}

export const BUILTIN_ROLES: RoleRef[] = [
    ...["read", "readWrite", "dbAdmin", "dbOwner", "userAdmin"].map(role => ({ role, db: "" })),
    ...["readAnyDatabase", "readWriteAnyDatabase", "userAdminAnyDatabase", "dbAdminAnyDatabase", "clusterMonitor", "clusterManager",
        "clusterAdmin", "hostManager", "backup", "restore", "root"].map(role => ({ role, db: "admin" }))
];

/** Privilege actions offered when a role is edited (MongoDB 7/8); others typed by hand are kept. */
export const PRIVILEGE_ACTIONS = [
    "find", "insert", "update", "remove", "bypassDocumentValidation", "useUUID",
    "changeStream", "createCollection", "createIndex", "dropCollection", "dropIndex", "collMod", "renameCollectionSameDB",
    "convertToCapped", "compact", "reIndex", "dropDatabase", "listCollections", "listIndexes", "listDatabases",
    "collStats", "dbStats", "dbHash", "indexStats", "validate", "killCursors", "killAnyCursor", "killop", "inprog",
    "serverStatus", "top", "getLog", "hostInfo", "connPoolStats", "replSetGetStatus", "replSetGetConfig",
    "createUser", "dropUser", "updateUser", "viewUser", "grantRole", "revokeRole", "createRole", "dropRole", "updateRole", "viewRole",
    "changePassword", "changeOwnPassword", "changeCustomData", "changeOwnCustomData", "setAuthenticationRestriction",
    "shutdown", "fsync", "setParameter", "getParameter", "logRotate", "applicationMessage", "planCacheRead", "planCacheWrite"
];

/** What the user form edits. */
export interface UserForm {
    user: string;
    /** Empty: unchanged (an existing user) or none (not allowed for a new one). */
    password: string;
    roles: RoleRef[];
    /** Shell text of `customData`; empty for none. */
    customData?: Doc;
}

/** A privilege of a role: a resource and what may be done there. */
export interface PrivilegeForm {
    /** `cluster` for the whole deployment, `any` for every resource; else a database (empty: every database). */
    kind: "namespace" | "cluster" | "any";
    db: string;
    /** Empty: every collection of the database. */
    collection: string;
    actions: string[];
}

export interface RoleForm {
    role: string;
    privileges: PrivilegeForm[];
    roles: RoleRef[];
}

function roleList(roles: RoleRef[], database: string): Doc[] {
    return roles
        .filter(item => item.role.trim())
        .map(item => ({ role: item.role.trim(), db: item.db.trim() || database }));
}

/** `createUser` for a new user, or `updateUser` for one that exists. */
export function userCommand(form: UserForm, database: string, existing: boolean): Doc {
    const command: Doc = existing ? { updateUser: form.user.trim() } : { createUser: form.user.trim() };
    if (form.password) command.pwd = form.password;
    command.roles = roleList(form.roles, database);
    if (form.customData && Object.keys(form.customData).length > 0) command.customData = form.customData;
    return command;
}

/** Problems of a user form, as i18n keys. */
export function userFormErrors(form: UserForm, existing: boolean): string[] {
    const errors: string[] = [];
    if (!form.user.trim()) errors.push("users.error.name");
    if (!existing && !form.password) errors.push("users.error.password");
    return errors;
}

function resource(privilege: PrivilegeForm): Doc {
    if (privilege.kind === "any") return { anyResource: true };
    return privilege.kind === "cluster" ? { cluster: true } : { db: privilege.db.trim(), collection: privilege.collection.trim() };
}

/** `createRole` or `updateRole`; privileges without actions are left out. */
export function roleCommand(form: RoleForm, database: string, existing: boolean): Doc {
    return {
        [existing ? "updateRole" : "createRole"]: form.role.trim(),
        privileges: form.privileges
            .filter(privilege => privilege.actions.length > 0)
            .map(privilege => ({ resource: resource(privilege), actions: [...privilege.actions] })),
        roles: roleList(form.roles, database)
    };
}

function refs(value: Json | undefined): RoleRef[] {
    return Array.isArray(value)
        ? value.filter(isDoc).map(item => ({ role: String(item.role ?? ""), db: String(item.db ?? "") }))
        : [];
}

/** The form for a user as `usersInfo` gives it; the password is never shown. */
export function userFormOf(info: Doc): UserForm {
    return {
        user: String(info.user ?? ""),
        password: "",
        roles: refs(info.roles),
        customData: isDoc(info.customData) ? info.customData : undefined
    };
}

/** The form for a role as `rolesInfo` with `showPrivileges` gives it. */
export function roleFormOf(info: Doc): RoleForm {
    const privileges = Array.isArray(info.privileges) ? info.privileges.filter(isDoc) : [];
    return {
        role: String(info.role ?? ""),
        privileges: privileges.map((privilege) => {
            const target = isDoc(privilege.resource) ? privilege.resource : {};
            return {
                kind: target.anyResource === true ? "any" : target.cluster === true ? "cluster" : "namespace",
                db: typeof target.db === "string" ? target.db : "",
                collection: typeof target.collection === "string" ? target.collection : "",
                actions: Array.isArray(privilege.actions) ? privilege.actions.map(String) : []
            };
        }),
        roles: refs(info.roles)
    };
}

/** `role@db`, as roles are written in lists. */
export function roleLabel(ref: RoleRef): string {
    return ref.db ? `${ref.role}@${ref.db}` : ref.role;
}
