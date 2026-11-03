# Local storage

Everything the app keeps on the machine lies in one SQLite database (`querymaster.db` in the app's data folder), through sqlx with migrations. Secrets – connection strings with passwords, SSH passphrases – live in the keychain of the operating system, never in a column or a file. The web view keeps nothing in `localStorage`.

## How it is built

- The pool is Tauri state: commands take `State<'_, SqlitePool>` and pass `&SqlitePool` on, so repositories can be tested against a database in memory.
- It is opened in the builder's `setup` (WAL, `foreign_keys`, `busy_timeout`, `synchronous = NORMAL`, at most four connections) and closed on `RunEvent::Exit`, which writes the write-ahead log back.
- Errors are one `thiserror` enum with `#[from]` for sqlx, the driver and files, serialized as `{ key, detail }`; a query only needs `?`.
- The development database is `src-tauri/dev.db`, named by `DATABASE_URL` in `src-tauri/.env`; queries are checked at compile time against it or, without it, against the cache in `src-tauri/.sqlx`.
- UUIDs are stored as `blob`, points in time as `text`.

## Rules for new tables

- Every change is a **new** file in `src-tauri/migrations` (`sqlx migrate add <name>`); an applied migration is never changed. Tables are `strict`.
- After a new or changed query run `cargo sqlx prepare -- --tests` in `src-tauri` and commit `.sqlx`; without it the app only builds where `dev.db` exists.
- Writes that belong together run in one transaction (`pool.begin()`).
- Every repository has a test against `db::memory_pool()`: create, read, update, delete, and the cascade when a connection is deleted.
- An area is a folder under `src-tauri/src` shaped like `connection`: `mod.rs` with the types and the flows, `commands.rs` that only passes through, `repository.rs` with the SQL only. One struct with `Serialize` and `FromRow` per row; a second type only where the shape differs, converted with `impl From<A> for B`.
- Before a commit: `cargo fmt` and `cargo clippy --all-targets -- -D warnings` (`bun run rust:check`); `tools/check-rust.ps1` migrates, prepares, formats, lints and tests in one go.
