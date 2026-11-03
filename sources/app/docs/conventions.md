# Conventions

The rules every change to the app follows.

- **English everywhere.** Code, comments, docs, plans, commit messages, branch names and pull requests are in English. The only German in the repository is the German translation of the interface (`i18n/locales/de`) and its spelling dictionary.
- **Texts of the interface** live in `i18n/locales/{en,de}` as flat keys, added with `bun tools/locale.ts`; `bun run test` keeps both languages and the completion catalog in step, `bun run cspell` checks their spelling. Errors of the Rust side arrive as keys too (`error.backend.*`).
- **Components from Vuetify0 first** (`@vuetify/v0`): buttons, dialogs, popovers, selection, timers and focus come from there, not from hand-written equivalents. No display class (`flex`, `grid`) on `DialogContent`.
- **Database commands, not driver methods.** New features build commands in `src/shell/plan.ts` or a composable and send them through `run_command`; the Rust side only grows where it has to (SSH, files, GridFS streams).
- **Statements are read, never executed as code** – except scripts, which run in the embedded JavaScript engine (`src/shell/runtime`, bundled with `bun run build:runtime`).
- **Local data only in SQLite**, following [storage.md](storage.md). No `localStorage`, no JSON files; secrets go into the keychain.
- **Writes are guarded.** Every function that writes checks the read-only state of its tab (`guardWrite` in `src/stores/tabs.ts`) and of its node in the tree; on a production connection it asks with the number of documents and a preview.
- **Common practice of the library wins** over habits from other projects; where a plan departs from it, the plan says why.
- **Before a commit:** `bun run type-check`, `bun run lint`, `bun run test`, `bun run cspell` and, for Rust, `bun run rust:check` and `bun run rust:test`. Larger changes also run `bun run e2e` against a real server and get a look in the running window (`bun run dev`).
