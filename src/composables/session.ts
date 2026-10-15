import { watch } from "vue";
import { useI18n } from "vue-i18n";
import { backend } from "@/api";
import type { SessionTab } from "@/api";
import { startupChoice, useAppearance } from "@/composables/appearance";
import { useNotices } from "@/composables/notices";
import { isDoc } from "@/shell/ejson";
import type { Json } from "@/shell/ejson";
import { useConnectionsStore } from "@/stores/connections";
import { useTabsStore } from "@/stores/tabs";
import type { TabKind, WorkTab } from "@/stores/tabs";

/** How long the tabs must stay unchanged before they are kept (and at most this late). */
const SAVE_DELAY = 2000;

/** Kinds of tab kept: all but none; a server tab keeps its page. */
const KEPT_KINDS: TabKind[] = ["start", "browse", "shell", "aggregate", "sql", "server", "schema"];

/** What a tab needs to be opened again, without results (stage 20). */
export function sessionContent(tab: WorkTab): Json {
    return {
        kind: tab.kind,
        database: tab.database,
        ...(tab.collection === undefined ? {} : { collection: tab.collection }),
        ...(tab.kind === "shell" || tab.kind === "sql" ? { text: tab.text } : {}),
        ...(tab.kind === "browse" ? { stages: tab.stages.map(stage => ({ ...stage })) } : {}),
        ...(tab.kind === "aggregate"
            ? { pipeline: (tab.pipeline ?? []).map(stage => ({ operator: stage.operator, text: stage.text, enabled: stage.enabled })), options: tab.aggregateOptions ?? "" }
            : {}),
        ...(tab.page === undefined ? {} : { page: tab.page }),
        ...(tab.file === undefined ? {} : { file: tab.file }),
        view: tab.view,
        pageSize: tab.pageSize
    } as Json;
}

/** The tabs as the session keeps them; tabs of connections from a typed string are left out (they are not saved). */
export function sessionOf(tabs: WorkTab[], activeId: string | undefined, kept: (connectionId: string) => boolean): SessionTab[] {
    return tabs
        .filter(tab => KEPT_KINDS.includes(tab.kind) && (tab.kind === "start" || kept(tab.connectionId)))
        .map(tab => ({ active: tab.id === activeId, connectionId: tab.kind === "start" ? null : tab.connectionId, content: sessionContent(tab) }));
}

/** Tabs worth offering: more than the start page alone. */
export function worthRestoring(tabs: SessionTab[]): boolean {
    return tabs.some(tab => isDoc(tab.content) && tab.content.kind !== "start");
}

/**
 * Keeps the open tabs in SQLite while the app runs and offers them at the next start, as the
 * setting "At the start" says (ask, restore, start empty). Tabs come back without running: a
 * connection is opened when a tab runs, so a start without network does not hang.
 */
export function useSession() {
    const { t } = useI18n();
    const notices = useNotices();
    const tabs = useTabsStore();
    const connections = useConnectionsStore();
    const { setPreferences } = useAppearance();
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Nothing is written over the last session before the start has decided about it. */
    let keeping = false;

    const kept = (connectionId: string) => connections.profiles.some(profile => profile.id === connectionId) && !connections.isTransient(connectionId);

    function save(): void {
        if (!keeping) return;
        clearTimeout(timer);
        timer = undefined;
        void backend.saveSession(sessionOf(tabs.tabs, tabs.activeId, kept)).catch(error => console.warn("The session was not kept", error));
    }

    function restore(saved: SessionTab[]): number {
        let restored = 0;
        let active: string | undefined;
        for (const entry of saved) {
            if (!isDoc(entry.content)) continue;
            const kind = entry.content.kind as TabKind;
            if (kind === "start") continue;
            if (entry.connectionId === null || !kept(entry.connectionId)) continue;
            const tab = tabs.restoreTab(kind, entry.connectionId, entry.content);
            restored++;
            if (entry.active) active = tab.id;
        }
        if (active) tabs.activeId = active;
        return restored;
    }

    async function start(): Promise<void> {
        let saved: SessionTab[] = [];
        try {
            saved = await backend.loadSession();
        } catch (error) {
            console.warn("The last session could not be read", error);
        }
        watch(() => JSON.stringify(sessionOf(tabs.tabs, tabs.activeId, kept)), () => {
            clearTimeout(timer);
            timer = setTimeout(save, SAVE_DELAY);
        });
        window.addEventListener("pagehide", save);
        const choice = startupChoice();
        if (choice === "empty" || !worthRestoring(saved)) {
            keeping = true;
            return;
        }
        if (choice === "restore") {
            restore(saved);
            keeping = true;
            return;
        }
        // Asked with a card that stays until it is answered; meanwhile the old session is kept as it is.
        notices.notify({
            kind: "info",
            title: t("session.title"),
            detail: saved.filter(tab => isDoc(tab.content) && tab.content.kind !== "start").map(tab => (isDoc(tab.content) ? String(tab.content.collection ?? tab.content.database ?? "") : "")).join(" · "),
            sticky: true,
            actions: [
                {
                    label: t("session.restore"),
                    run: () => {
                        const count = restore(saved);
                        keeping = true;
                        save();
                        notices.answer(t("session.restored", { count }, count));
                    }
                },
                {
                    label: t("session.never"),
                    run: () => {
                        setPreferences({ startup: "empty" });
                        keeping = true;
                        save();
                    }
                }
            ]
        });
        // Work on new tabs before an answer: from then on they are what is kept.
        const stop = watch(() => tabs.tabs.length, () => {
            keeping = true;
            stop();
        });
    }

    return { start, save };
}
