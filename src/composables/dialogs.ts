import { nextTick, reactive } from "vue";
import type { Profile } from "@/api";
import type { Doc } from "@/shell/ejson";

/** A question for one line of text. */
export interface PromptRequest {
    title: string;
    label: string;
    value?: string;
    /** Label of the confirming button. */
    action: string;
    /** The value is code (index keys …) and shown in the code font. */
    code?: boolean;
    /** Names to suggest while typing, such as those already taken. */
    suggestions?: string[];
}

export interface ConfirmRequest {
    title: string;
    text: string;
    action: string;
}

/** Text to read or to edit in a code editor. */
export interface TextRequest {
    title: string;
    text: string;
    /** With an action the text can be changed and is handed back. */
    action?: string;
    /** Checks the edited text; a string is shown as the error and the dialog stays open. */
    submit?: (text: string) => Promise<string | undefined> | string | undefined;
    /** Other forms of the text to switch between (the query in other languages); `text` is the first. */
    variants?: { label: string; text: string }[];
}

/** The collection dialog: a new collection, a new view, or the validator of a collection. */
export interface CollectionRequest {
    mode: "collection" | "view" | "validator";
    connectionId: string;
    database: string;
    /** The collection whose validator is edited, or the source of a new view. */
    collection?: string;
    /** A new view: the pipeline to start with, as text. */
    pipeline?: string;
}

/** The index dialog: a new index of a collection, a copy of `index`, or `index` made anew. */
export interface IndexRequest {
    connectionId: string;
    database: string;
    collection: string;
    /** The index to start from, as `listIndexes` gives it. */
    index?: Doc;
    /** `index` is dropped and created again as the dialog then says (an index can not be changed). */
    recreate?: boolean;
}

/** The tabs of the settings dialog. */
export type SettingsPage = "general" | "keys";

/** What the Help dialog shows: the keyboard shortcuts (F12) or "About QueryMaster". */
export type HelpPage = "shortcuts" | "about";

// One dialog of each kind for the whole app (`AppDialogs.vue` renders them).
const state = reactive({
    settingsOpen: false,
    settingsPage: "general" as SettingsPage,
    help: undefined as HelpPage | undefined,
    indexOpen: false,
    index: undefined as IndexRequest | undefined,
    prompt: undefined as PromptRequest | undefined,
    confirm: undefined as ConfirmRequest | undefined,
    text: undefined as TextRequest | undefined,
    connectionOpen: false,
    collectionOpen: false,
    collection: undefined as CollectionRequest | undefined,
    connection: undefined as Profile | undefined,
    /** The dialog starts from `connection` but saves a new one. */
    connectionClone: false
});

let answerPrompt: ((value: string | undefined) => void) | undefined;
let answerConfirm: ((value: boolean) => void) | undefined;

/** Dialogs any part of the app can open, each answering with a promise. */
export function useDialogs() {
    /** Asks for a line of text; `undefined` when the dialog is dismissed. */
    function ask(request: PromptRequest): Promise<string | undefined> {
        answerPrompt?.(undefined);
        state.prompt = request;
        return new Promise(resolve => (answerPrompt = resolve));
    }

    function confirm(request: ConfirmRequest): Promise<boolean> {
        answerConfirm?.(false);
        state.confirm = request;
        return new Promise(resolve => (answerConfirm = resolve));
    }

    function showText(request: TextRequest): void {
        state.text = request;
    }

    /** Opens the connection dialog for a new connection, or for the one given. */
    function editConnection(profile?: Profile): void {
        state.connection = profile;
        state.connectionClone = false;
        state.connectionOpen = true;
    }

    /** Opens the connection dialog for a new connection that starts as a copy of the one given. */
    function cloneConnection(profile: Profile): void {
        state.connection = profile;
        state.connectionClone = true;
        state.connectionOpen = true;
    }

    function editCollection(request: CollectionRequest): void {
        // A new object every time: the dialog starts afresh even for the same collection.
        state.collection = { ...request };
        state.collectionOpen = true;
    }

    function editIndex(request: IndexRequest): void {
        state.index = { ...request };
        state.indexOpen = true;
    }

    /** Opens the settings; on a page if one is given, otherwise where they were left. */
    function openSettings(page?: SettingsPage): void {
        if (page) state.settingsPage = page;
        if (state.help === undefined) {
            state.settingsOpen = true;
            return;
        }
        // From the help: that dialog closes first, a modal dialog does not open over a closing one.
        state.help = undefined;
        void nextTick(() => (state.settingsOpen = true));
    }

    function openHelp(page: HelpPage): void {
        state.help = page;
    }

    return { ask, confirm, showText, editConnection, cloneConnection, editCollection, editIndex, openSettings, openHelp };
}

/** For `AppDialogs.vue` only. */
export function useDialogState() {
    return {
        state,
        resolvePrompt(value: string | undefined) {
            state.prompt = undefined;
            answerPrompt?.(value);
            answerPrompt = undefined;
        },
        resolveConfirm(value: boolean) {
            state.confirm = undefined;
            answerConfirm?.(value);
            answerConfirm = undefined;
        }
    };
}
