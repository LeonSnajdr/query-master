# QueryMaster

A desktop client for MongoDB: connections, a shell-like query editor with completion, and results
as tree, table or text. Built with Tauri 2, Vue 3 and Vuetify0; it talks to MongoDB through the
official Rust driver (`mongodb` 3.x), so current server versions work.

## Develop

```bash
bun install
```

```bash
bun run app:dev
```

`bun run dev` alone opens the interface in a browser with made-up data (`src/api.mock.ts`);
`http://localhost:1420/?demo` opens a collection of it right away.

```bash
bun run lint
```

```bash
bun run type-check
```

```bash
bun run test
```

```bash
bun run rust:check
```

```bash
bun run rust:test
```

```bash
bun run app:build
```

## How it is put together

- `src/shell` – the shell language. `parse.ts` reads statements (they are read, never executed as
  code), `plan.ts` turns them into database commands, `context.ts` and `complete.ts` find what to
  suggest at the cursor, `catalog.ts` lists methods, stages and operators with the server version
  that brought them.
- `src-tauri/src` – the two commands that run a database command (`mongo.rs`), the local SQLite
  database (`db`, tables in `src-tauri/migrations`) and the saved connections in it (`connection`;
  their connection strings live in the keychain of the operating system).
- `i18n/locales` – every text of the interface, English and German, as flat keys. Descriptions of
  completion entries are `doc.<group>.<name>`; errors of the Rust side arrive as keys too
  (`error.backend.*`). `i18n/locales.test.ts` keeps both languages and the catalog in step.

## Local database

What the app stores lies in SQLite through sqlx. Queries are checked at compile time against
`src-tauri/dev.db` (`DATABASE_URL` in `src-tauri/.env`) or, without it, against the cache in
`src-tauri/.sqlx`. After adding a migration or changing a query, in `src-tauri`:

```bash
sqlx migrate run
```

```bash
cargo sqlx prepare -- --tests
```

`sqlx` is `cargo install sqlx-cli`. Rules for new tables: `docs/roadmap/11-ablage.md`.

## Against a real server

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- --include-ignored
```

The ignored tests use the server in `QUERYMASTER_TEST_URI` (default `mongodb://localhost:27017`);
they write only into a collection of their own in the database `querymaster_test` and drop it.

## Not there yet

Aggregation, SQL and Map Reduce builders (the aggregation entry opens a shell with a pipeline), GridFS,
users, roles and functions, folders, colors and comments in the tree, validators, copying collections,
the server log, `bulkWrite`, change streams, SSH tunnels.