import { isDoc, toNumber } from "./ejson";
import type { Doc, Json } from "./ejson";

/** A member of a replica set as the page lists it: its configuration and, if known, its state. */
export interface MemberRow {
    id: number;
    host: string;
    priority: number;
    votes: number;
    arbiterOnly: boolean;
    hidden: boolean;
    tags: Record<string, string>;
    /** `PRIMARY`, `SECONDARY` … from `replSetGetStatus`; absent when it could not be read. */
    state?: string;
    healthy?: boolean;
    /** The member the connection talks to. */
    self?: boolean;
}

/** The form to add a member (*Add member*). */
export interface MemberForm {
    host: string;
    priority: number;
    votes: number;
    arbiterOnly: boolean;
    hidden: boolean;
    /** `dc: east, rack: 1`. */
    tags: string;
}

export const NEW_MEMBER: MemberForm = { host: "", priority: 1, votes: 1, arbiterOnly: false, hidden: false, tags: "" };

function text(value: Json | undefined): string {
    return typeof value === "string" ? value : "";
}

/** The members of `replSetGetConfig`'s `config`, with the state of each from `replSetGetStatus`. */
export function membersOf(config: Doc, status?: Doc): MemberRow[] {
    const states = new Map((Array.isArray(status?.members) ? status.members.filter(isDoc) : []).map(member => [text(member.name), member]));
    const members = Array.isArray(config.members) ? config.members.filter(isDoc) : [];
    return members.map((member) => {
        const host = text(member.host);
        const state = states.get(host);
        const tags = isDoc(member.tags) ? Object.fromEntries(Object.entries(member.tags).map(([key, value]) => [key, text(value)])) : {};
        return {
            id: toNumber(member._id) ?? 0,
            host,
            priority: toNumber(member.priority) ?? 1,
            votes: toNumber(member.votes) ?? 1,
            arbiterOnly: member.arbiterOnly === true,
            hidden: member.hidden === true,
            tags,
            ...(state ? { state: text(state.stateStr), healthy: toNumber(state.health) === 1, self: state.self === true } : {})
        };
    });
}

/** `dc: east, rack: 1` as `{ dc: "east", rack: "1" }`; `undefined` when a pair has no name or value. */
export function parseTags(value: string): Record<string, string> | undefined {
    const pairs = value.split(",").map(pair => pair.trim()).filter(pair => pair !== "");
    const tags: Record<string, string> = {};
    for (const pair of pairs) {
        const at = pair.indexOf(":");
        const key = at === -1 ? "" : pair.slice(0, at).trim();
        const tag = at === -1 ? "" : pair.slice(at + 1).trim();
        if (!key || !tag) return undefined;
        tags[key] = tag;
    }
    return tags;
}

/**
 * What the server would refuse, as i18n keys. An arbiter has priority 0 and one vote and is
 * neither hidden nor tagged; a hidden member or one without a vote has priority 0.
 */
export function memberProblems(form: MemberForm, members: MemberRow[]): string[] {
    const problems: string[] = [];
    const host = form.host.trim();
    if (!host) problems.push("replicaSet.error.host");
    else if (!/^[^\s:]+:\d+$/.test(host)) problems.push("replicaSet.error.hostPort");
    else if (members.some(member => member.host.toLowerCase() === host.toLowerCase())) problems.push("replicaSet.error.exists");
    if (!form.arbiterOnly) {
        if (!(form.priority >= 0 && form.priority <= 1000)) problems.push("replicaSet.error.priority");
        if (parseTags(form.tags) === undefined) problems.push("replicaSet.error.tags");
    }
    return problems;
}

/** The fields the form greys: what the server fixes for an arbiter, a hidden member or one without a vote. */
export function lockedFields(form: MemberForm): { priority: boolean; votes: boolean; hidden: boolean; tags: boolean } {
    return {
        priority: form.arbiterOnly || form.hidden || form.votes === 0,
        votes: form.arbiterOnly,
        hidden: form.arbiterOnly,
        tags: form.arbiterOnly
    };
}

/** The member as `replSetReconfig` takes it, with the next free `_id`. */
export function memberDocument(form: MemberForm, members: MemberRow[]): Doc {
    const id = members.reduce((highest, member) => Math.max(highest, member.id), -1) + 1;
    const host = form.host.trim();
    if (form.arbiterOnly) return { _id: id, host, arbiterOnly: true };
    const locked = lockedFields(form);
    const tags = parseTags(form.tags) ?? {};
    return {
        _id: id,
        host,
        priority: locked.priority ? 0 : form.priority,
        votes: form.votes === 0 ? 0 : 1,
        ...(form.hidden ? { hidden: true } : {}),
        ...(Object.keys(tags).length > 0 ? { tags } : {})
    };
}

/** The configuration with its version raised and the members changed by `change`. */
export function reconfigured(config: Doc, change: (members: Doc[]) => Doc[]): Doc {
    const members = Array.isArray(config.members) ? config.members.filter(isDoc) : [];
    return { ...config, version: (toNumber(config.version) ?? 0) + 1, members: change(members) };
}

/** Adds a member to the configuration of `replSetGetConfig`. */
export function withMember(config: Doc, form: MemberForm): Doc {
    const added = memberDocument(form, membersOf(config));
    return reconfigured(config, members => [...members, added]);
}

/** Takes the member with `_id` out of the configuration. */
export function withoutMember(config: Doc, id: number): Doc {
    return reconfigured(config, members => members.filter(member => toNumber(member._id) !== id));
}
