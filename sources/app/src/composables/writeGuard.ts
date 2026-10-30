import { backend } from "@/api";
import { useDialogs } from "@/composables/dialogs";
import i18n from "@/plugins/i18n";
import { preview, toNumber, toShell } from "@/shell/ejson";
import type { Doc } from "@/shell/ejson";
import type { ConfirmChange, ConfirmRequest } from "@/composables/dialogs";
import { changesOf, countCommand, needsConfirm, needsName, scriptWrites, touched, writeInfo } from "@/shell/guard";
import type { Environment, WriteInfo } from "@/shell/guard";
import { useConnectionsStore } from "@/stores/connections";

/** Tabs in which a value was changed on production after asking once (asked once per tab). */
const confirmedEdits = new Set<string>();

/** Documents shown before and after in the confirmation. */
const PREVIEWED = 2;

function t(key: string, params: Record<string, unknown> = {}, plural?: number): string {
    const translate = i18n.global.t as (key: string, params: Record<string, unknown>, plural?: number) => string;
    return plural === undefined ? translate(key, params) : translate(key, params, plural);
}

/** Numbers as the language writes them: 1 204 / 1,204. */
function number(value: number): string {
    return value.toLocaleString(i18n.global.locale.value);
}

/** Whether the write takes documents away: a delete, or a findAndModify that removes. */
function removes(info: WriteInfo): boolean {
    return info.command === "delete" || (info.command === "findAndModify" && info.update === undefined);
}

/** What the write does, for the title and the sentence of the confirmation. */
function kindOf(info: WriteInfo): "write" | "delete" | "drop" | "dropDatabase" {
    if (info.command === "drop" || info.command === "dropDatabase") return info.command;
    return removes(info) ? "delete" : "write";
}

/** The sentence of the confirmation: what happens, where, to how many documents. */
function summaryOf(info: WriteInfo, target: string, count: number | undefined): NonNullable<ConfirmRequest["summary"]> {
    const values = { target, command: info.command };
    if (info.command === "dropDatabase") return { keypath: "guard.summary.dropDatabase", values };
    if (count === undefined) {
        if (info.command === "drop") return { keypath: "guard.summary.dropUncounted", values };
        return { keypath: info.filter === undefined ? "guard.summary.writes" : "guard.summary.uncounted", values };
    }
    const keypath = info.command === "drop" ? "guard.summary.drop" : info.command === "insert" ? "guard.summary.insert" : removes(info) ? "guard.summary.delete" : "guard.summary.change";
    return { keypath, values: { ...values, count: number(count) }, plural: count };
}

/** The label of the button: what it does, with the number of documents when known. */
function actionOf(info: WriteInfo, count: number | undefined): string {
    if (info.command === "drop" || info.command === "dropDatabase") return t(`guard.action.${info.command}`);
    const kind = info.command === "insert" ? "insert" : removes(info) ? "delete" : "change";
    return count === undefined ? t(`guard.action.${kind}`) : t(`guard.action.${kind}Count`, { count: number(count) }, count);
}

/**
 * Asks before writing on a connection marked test or production (stage 21). Development and
 * unmarked connections write without asking, as before. The read-only marks stay stronger: they
 * refuse before this is asked.
 */
export function useWriteGuard() {
    const connections = useConnectionsStore();
    const dialogs = useDialogs();

    function environmentOf(connectionId: string): Environment | null {
        return connections.environmentOf(connectionId);
    }

    /** Whether writes on the connection are asked about at all (test, production). */
    function guards(connectionId: string): boolean {
        const environment = environmentOf(connectionId);
        return environment === "test" || environment === "production";
    }

    /** The name of the connection, for the mark of the dialog. */
    function nameOf(connectionId: string): string {
        return connections.profiles.find(item => item.id === connectionId)?.name ?? "";
    }

    /** How many documents the write touches; `undefined` when it could not be told in time. */
    async function countOf(connectionId: string, database: string, info: WriteInfo): Promise<number | undefined> {
        if (info.inserted !== undefined) return info.inserted;
        try {
            if (info.command === "drop" && info.collection !== undefined) {
                return toNumber((await backend.runCommand(connectionId, database, { count: info.collection, maxTimeMS: 2000 })).n);
            }
            const command = countCommand(info);
            if (!command) return undefined;
            const page = await backend.runCursorCommand(connectionId, database, command, 1);
            return touched(info, toNumber(page.documents[0]?.n) ?? 0);
        } catch {
            // Counting took longer than allowed (or is not possible): the dialog says so.
            return undefined;
        }
    }

    /** Two documents the write touches, field by field before and after (or the documents that go). */
    async function previewOf(connectionId: string, database: string, info: WriteInfo): Promise<ConfirmChange[] | undefined> {
        if (info.collection === undefined || info.filter === undefined) return undefined;
        try {
            // `updateOne`, `deleteOne`: the one document it touches, though the filter finds more.
            const limit = info.many ? PREVIEWED : 1;
            const page = await backend.runCursorCommand(connectionId, database, { find: info.collection, filter: info.filter, limit }, limit);
            return page.documents.map((document) => {
                const id = preview(document._id ?? null, 60);
                if (removes(info)) return { id, fields: [], removed: preview(document, 160) };
                const fields = (changesOf(document, info.update) ?? []).map(change => ({ field: change.field, before: change.before, after: change.after ?? "?" }));
                return { id, fields };
            });
        } catch {
            return undefined;
        }
    }

    /**
     * Asks before `command` runs on the connection, as its environment wants; `false` when the user
     * stops it. `editOnce` (the id of a tab): on production a change of single values is asked
     * about once per tab. `statement` is offered to copy as a script.
     */
    async function confirmWrite(connectionId: string, database: string, command: Doc, options: { editOnce?: string; statement?: string } = {}): Promise<boolean> {
        const environment = environmentOf(connectionId);
        if (environment !== "test" && environment !== "production") return true;
        const info = writeInfo(command);
        if (options.editOnce !== undefined && environment === "production" && !info.many && confirmedEdits.has(options.editOnce)) return true;
        const count = await countOf(connectionId, database, info);
        if (!needsConfirm(environment, info, count)) return true;
        const target = info.collection === undefined ? database : `${database}.${info.collection}`;
        const changes = await previewOf(connectionId, database, info);
        const confirmed = await dialogs.confirm({
            title: t(`guard.title.${kindOf(info)}.${environment}`),
            environment: { kind: environment, name: nameOf(connectionId) },
            summary: summaryOf(info, target, count),
            changes,
            more: count === undefined || !changes?.length ? undefined : Math.max(0, count - changes.length),
            deleting: removes(info) || info.dropping,
            requireName: needsName(environment, info, count) ? info.collection ?? database : undefined,
            script: options.statement ?? `db.getSiblingDB(${JSON.stringify(database)}).runCommand(${toShell(command)})`,
            action: actionOf(info, count)
        });
        if (confirmed && options.editOnce !== undefined && !info.many) confirmedEdits.add(options.editOnce);
        return confirmed;
    }

    /** Before a script runs: asks when its text may write (production) or write widely (test). */
    async function confirmScript(connectionId: string, database: string, source: string): Promise<boolean> {
        const environment = environmentOf(connectionId);
        const writes = scriptWrites(source);
        if (writes === undefined || environment === "development" || environment === null) return true;
        if (environment === "test" && writes !== "many") return true;
        return dialogs.confirm({
            title: t(`guard.title.script.${environment}`),
            environment: { kind: environment, name: nameOf(connectionId) },
            summary: { keypath: "guard.summary.script", values: { target: database } },
            requireName: writes === "many" ? database : undefined,
            action: t("guard.runScript")
        });
    }

    /** Before an import, a paste or an export into a database: one question for the whole job. */
    async function confirmJob(connectionId: string, database: string, what: string): Promise<boolean> {
        const environment = environmentOf(connectionId);
        if (environment !== "test" && environment !== "production") return true;
        return dialogs.confirm({
            title: t(`guard.title.write.${environment}`),
            environment: { kind: environment, name: nameOf(connectionId) },
            // "Import..." as the menu says it, without the dots.
            summary: { keypath: "guard.summary.job", values: { target: database, command: what.replace(/(\.\.\.|…)$/, "") } },
            action: t("guard.action.change")
        });
    }

    return { environmentOf, guards, confirmWrite, confirmScript, confirmJob };
}

/** For tests and the session: forgets which tabs were asked about already. */
export function forgetConfirmedEdits(tabId?: string): void {
    if (tabId === undefined) confirmedEdits.clear();
    else confirmedEdits.delete(tabId);
}
