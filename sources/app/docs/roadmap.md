# Roadmap

What QueryMaster does today, what is still open, and the decisions behind both.

## What is there

- **Connections** – single server, replica set and SRV; authentication (SCRAM, X.509, AWS, LDAP), TLS, SSH tunnel with password or key file, read preference, visible databases; groups and folders; connect from a URI; an environment per connection (production gets a red status bar and asks before it writes).
- **Tree** – databases, collections, views, time series, GridFS buckets and indexes; folders, colors, comments and read-only marks (inherited); drag and drop; multi-select with one menu for all; keyboard navigation.
- **Queries** – document browser with filter, sort and projection rows, a JSON mode, history and saved queries (`Ctrl+D`), session restore at startup.
- **Editor** – completion of methods, stages and operators with the server version that introduced them, the values of a field from a sample and the shown page, a search of all data (`Ctrl+Space` again), formatting (`Shift+Alt+F`), multiple cursors, search and replace.
- **Results** – tree, table and JSON; editing in place with value suggestions; add, edit, rename and remove fields with a scope (this document, the selected ones, the query, the collection); *Filter by this value*; sorting, moving and resizing columns; links open with `Ctrl+Click`.
- **Explain** – the plan as a flow from source to result, with time per stage, hints and *Create index …*; forcing an index.
- **Shell** – several statements with a result tab each, a *Text* tab for what was printed, `bulkWrite`, real JavaScript scripts in an embedded engine with output as it comes; stopping a running query or script (`Shift+F5`).
- **Builders** – aggregation (stages can be dragged, switched off and previewed) and SQL (`SELECT` with `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`).
- **Collections** – collection, view, validator and index dialogs with all collation options; statistics; copying across connections; GridFS with upload and metadata.
- **Export and import** – JSON (shell, mongoexport, canonical), CSV and SQL in four dialects, or straight into another database; import of JSON in every notation and CSV with a schema; presets.
- **Schema analysis** – a card per field with type shares and a chart; a click filters; *Use as validator*.
- **Administration** – server status, server log, users, roles, replica set members.
- **App** – command palette (`Ctrl+Shift+P`), rebindable shortcuts with conflict check, notices with a history behind the bell, five themes, English and German, updates from GitHub releases.

## Open

### Before or right after the first release

- Install the installers on a machine that never had a development setup; check window border and snapping on Windows.
- Accept the shell with real scripts of users.
- SSH: verify the host key (it is not checked yet), and connect to every member of a replica set behind SSH (today only the first host is used).
- Sign the installers (Windows SmartScreen, macOS Gatekeeper) and build for Intel Macs.

### Later

- Change streams (needs a replica set to test against).
- A connection test that shows its protocol; the X.509 subject name in the connection dialog.
- Not yet tested against a server: changes to a replica set, GridFS upload inside the app.
- *Copy collections* on a connection (it exists on a database).
- Comments, colors and read-only marks on folders.
- A switch between shell and SQL per query row; more types in the value editor.
- In the import schema: reset and guess again.
- Measure whether long results need virtual scrolling.
- Clean-up: the tree as a flat list of rows (`src/stores/tree.ts`); no change for users.

## Decisions

- **Nothing deprecated is rebuilt.** Map Reduce, server-side functions (`system.js`) and `db.eval` get no UI; `db.runCommand` still reaches them while the server supports them.
- **No storage engine options** in the collection dialog, and no *auto index `_id`* (always on since MongoDB 4.0).
- **SQL builds queries only**; there are no SQL write statements.
- **Icons are Lucide.**
- **No changelog inside the app** and no `F1` help; the releases on GitHub list the changes.
- **License:** Prosperity Public License 3.0.0, see [LICENSE.md](../../../LICENSE.md).
