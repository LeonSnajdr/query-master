import { backend } from "@/api";
import { useDialogs } from "@/composables/dialogs";
import i18n from "@/plugins/i18n";
import { preview, toNumber, toShell } from "@/shell/ejson";
import type { Doc } from "@/shell/ejson";
import { changesOf, countCommand, needsConfirm, needsName, scriptWrites, touched, writeInfo } from "@/shell/guard";
import type { Environment, WriteInfo } from "@/shell/guard";
import { useConnectionsStore } from "@/stores/connections";

/** Tabs in which a value was changed on production after asking once (asked once per tab). */
const confirmedEdits = new Set<string>();

/** Documents shown before and after in the confirmation. */
const PREVIEWED = 2;

function t(key: string, params: Record<string, unknown> = {}): string {
    return (i18n.global.t as (key: string, params: Record<string, unknown>) => string)(key, params);
}

/** Numbers as the language writes them: 1 204 / 1,204. */
function number(value: number): string {
    return value.toLocaleString(i18n.global.locale.value);
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
    async function previewOf(connectionId: string, database: string, info: WriteInfo): Promise<{ heads: string[]; rows: string[][] } | undefined> {
        if (info.collection === undefined || info.filter === undefined) return undefined;
        try {
            const page = await backend.runCursorCommand(connectionId, database, { find: info.collection, filter: info.filter, limit: PREVIEWED }, PREVIEWED);
            const rows: string[][] = [];
            for (const document of page.documents) {
                const id = preview(document._id ?? null, 30);
                if (info.command === "delete" || (info.command === "findAndModify" && info.update === undefined)) {
                    rows.push([id, "", preview(document, 60), t("guard.removed")]);
                    continue;
                }
                for (const change of changesOf(document, info.update) ?? []) rows.push([id, change.field, change.before, change.after ?? "?"]);
            }
            return { heads: [t("guard.document"), t("guard.field"), t("guard.before"), t("guard.after")], rows };
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
        const profile = connections.profiles.find(item => item.id === connectionId);
        const documents = count === undefined ? (info.filter === undefined ? "–" : t("guard.countStopped")) : number(count);
        const confirmed = await dialogs.confirm({
            title: t(`guard.title.${environment}`),
            text: t("guard.text", { name: profile?.name ?? "" }),
            facts: [
                { label: t("guard.command"), value: info.command },
                { label: t("guard.target"), value: target },
                { label: t("guard.documents"), value: documents }
            ],
            table: await previewOf(connectionId, database, info),
            requireName: needsName(environment, info, count) ? info.collection ?? database : undefined,
            script: options.statement ?? `db.getSiblingDB(${JSON.stringify(database)}).runCommand(${toShell(command)})`,
            action: count === undefined || info.dropping ? t("guard.action") : t("guard.actionCount", { count: number(count) })
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
        const profile = connections.profiles.find(item => item.id === connectionId);
        return dialogs.confirm({
            title: t(`guard.title.${environment}`),
            text: t("guard.script", { name: profile?.name ?? "" }),
            facts: [{ label: t("guard.target"), value: database }],
            requireName: writes === "many" ? database : undefined,
            action: t("guard.runScript")
        });
    }

    /** Before an import, a paste or an export into a database: one question for the whole job. */
    async function confirmJob(connectionId: string, database: string, what: string): Promise<boolean> {
        const environment = environmentOf(connectionId);
        if (environment !== "test" && environment !== "production") return true;
        const profile = connections.profiles.find(item => item.id === connectionId);
        return dialogs.confirm({
            title: t(`guard.title.${environment}`),
            text: t("guard.text", { name: profile?.name ?? "" }),
            facts: [{ label: t("guard.command"), value: what }, { label: t("guard.target"), value: database }],
            action: t("guard.action")
        });
    }

    return { environmentOf, guards, confirmWrite, confirmScript, confirmJob };
}

/** For tests and the session: forgets which tabs were asked about already. */
export function forgetConfirmedEdits(tabId?: string): void {
    if (tabId === undefined) confirmedEdits.clear();
    else confirmedEdits.delete(tabId);
}
