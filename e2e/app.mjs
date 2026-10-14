// Walks through the real app (the Tauri window, the Rust side, a MongoDB server) and checks what
// a person would check by hand. Started by `tools/e2e.ps1`, which runs the app with the web view's
// debugging port open. Writes only into the database `querymaster_test`.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const uri = process.env.QUERYMASTER_TEST_URI;
assert.ok(uri, "QUERYMASTER_TEST_URI is not set");
const port = process.env.QUERYMASTER_DEBUG_PORT ?? "9222";
const NAME = `E2E ${Date.now()}`;
const DATABASE = "querymaster_test";
const COLLECTION = `e2e_${process.pid}`;

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages().find(candidate => candidate.url().includes("localhost")) ?? browser.contexts()[0].pages()[0];
page.setDefaultTimeout(15_000);
const failures = [];
page.on("pageerror", error => failures.push(`page error: ${error.message}`));
page.on("console", message => message.type() === "error" && failures.push(`console: ${message.text()}`));

const id = name => page.locator(`[data-testid="${name}"]`);
const visible = name => page.locator(`[data-testid="${name}"]:visible`);
// With QUERYMASTER_SHOTS set to a folder, steps leave screenshots there to look at.
const shot = async name => process.env.QUERYMASTER_SHOTS && await page.screenshot({ path: `${process.env.QUERYMASTER_SHOTS}/${name}.png` });
const steps = [];
async function step(name, action) {
    try {
        await action();
        steps.push(`ok    ${name}`);
    } catch (error) {
        // The first lines say what was waited for; the rest is Playwright's retry log.
        steps.push(`FAIL  ${name}: ${String(error.message).split("\n").slice(0, 3).join(" | ")}`);
        // An assertion says what it got; the stack says which one it was.
        if ("actual" in error) steps.push(`      actual ${JSON.stringify(error.actual)}, expected ${JSON.stringify(error.expected)}`);
        const line = String(error.stack).split("\n").find(entry => entry.includes("app.mjs"));
        if (line) steps.push(`      at ${line.trim()}`);
        // What dialogs were open says most about a failure in one.
        const open = await page.locator("dialog[open]").evaluateAll(dialogs => dialogs.map(dialog => dialog.innerText.replace(/\s+/g, " ").slice(0, 400))).catch(() => []);
        if (open.length > 0) steps.push(`      open dialogs: ${open.join(" || ")}`);
        throw error;
    }
}

/** Waits until the field holds `value`: what the page sets after a reply, it sets a moment later. */
async function valueBecomes(locator, value, timeout = 5000) {
    const until = Date.now() + timeout;
    let current = await locator.inputValue();
    while (current !== value && Date.now() < until) {
        await page.waitForTimeout(50);
        current = await locator.inputValue();
    }
    assert.equal(current, value);
}

/** Replaces the text of the code editor inside `scope`. */
async function write(scope, text) {
    // Tabs keep their hidden panels in the page: only the editor that shows is meant.
    const editor = scope.locator(".cm-content:visible").first();
    await editor.click();
    await page.keyboard.press("Control+A");
    // Inserted as one piece: no completion list opens and no bracket is closed for us.
    await page.keyboard.insertText(text);
}

async function runShell(text) {
    const panel = page.locator("[data-testid=tab-panel]:visible");
    await write(panel, text);
    await panel.locator("[data-testid=query-run]").click();
    // The button is disabled (or gives way to Stop) while the run lasts; an older result may still show.
    await page.waitForTimeout(150);
    await panel.locator("[data-testid=query-run]:not([disabled])").waitFor();
    assert.equal(await panel.locator("[data-testid=query-error]").count(), 0, "the statement failed");
    await panel.locator("[data-testid=result-range]").waitFor();
    return panel;
}

async function chooseMenu(label) {
    await page.locator("[data-testid=menu-item]:visible", { hasText: label }).first().click();
}

try {
    await step("the app shows its start page, no dialog is stuck open", async () => {
        await id("start-create").waitFor();
        const shown = await page.locator("dialog").evaluateAll(all => all.filter(dialog => getComputedStyle(dialog).display !== "none").length);
        assert.equal(shown, 0);
    });

    // Texts are matched by test id, so the language does not matter; menus are matched in English.
    await step("language can be switched and is English for the rest", async () => {
        await page.locator("nav > button").nth(2).click();
        await page.locator("[data-testid=menu-item]:visible", { hasText: /English/ }).click();
        await page.locator("nav > button", { hasText: "View" }).waitFor();
    });

    await step("a connection is tested and saved", async () => {
        await id("start-create").click();
        await id("connection-name").fill(NAME);
        // The fields come from the string, through "From URI".
        await id("connection-from-uri").click();
        await id("prompt-input").fill(uri);
        await id("prompt-submit").click();
        await id("connection-tab-auth").click();
        assert.ok((await id("connection-username").inputValue()).length > 0, "the user was not taken from the string");
        await id("connection-tab-basic").click();
        assert.equal(await id("connection-host").inputValue(), "localhost");
        await id("connection-test").click();
        await page.locator("[data-testid=connection-notice]", { hasText: "MongoDB" }).waitFor();
        await id("connection-save").click();
        try {
            await page.locator("[data-testid=recent-connection]", { hasText: NAME }).waitFor({ timeout: 8000 });
        } catch {
            // The dialog says why saving failed.
            throw new Error(`not saved: ${await id("connection-notice").innerText().catch(() => "no message")}`);
        }
    });

    await step("connecting lists the databases", async () => {
        await page.locator("[data-testid=recent-connection]", { hasText: NAME }).click();
        await id("database-row").first().waitFor();
        assert.match(await id("connection-version").innerText(), /^\d+\.\d+/);
        assert.match(await id("status-server").innerText(), /MongoDB \d/);
    });

    await step("a shell inserts documents of several types", async () => {
        await id("dock-shell").click();
        const panel = await runShell(`db.getSiblingDB("${DATABASE}").getCollection("${COLLECTION}").insertMany([
            { n: 1, name: "one", at: ISODate("2024-05-01"), big: NumberLong("9007199254740993"), tags: ["a", "b"], nested: { deep: true } },
            { n: 2, name: "two", price: NumberDecimal("9.99") },
            { n: 3, name: "three" }
        ])`);
        assert.match(await panel.locator("[data-testid=query-result]").innerText(), /insertedCount/);
    });

    await step("a script with a loop and print runs against the server", async () => {
        const source = `var docs = db.getSiblingDB("${DATABASE}").getCollection("${COLLECTION}");
var total = 0;
docs.find({}).forEach(function (document) { total += document.n; });
print("total " + total + ", big " + docs.findOne({ n: 1 }).big);
docs.find({}).sort({ n: -1 }).limit(2)`;
        const panel = await runShell(source);
        assert.match(await panel.locator("[data-testid=script-output]").innerText(), /total 6, big 9007199254740993/);
        assert.equal(await panel.locator("[data-testid=result-range]").innerText(), "1 – 2");
        assert.match(await panel.locator("[data-testid=tree-row]").first().innerText(), /5 elements|4 elements|3 elements/);
    });

    await step("bulkWrite and several statements run in order", async () => {
        const target = `db.getSiblingDB("${DATABASE}").getCollection("${COLLECTION}")`;
        const panel = await runShell(`${target}.bulkWrite([
            { insertOne: { document: { n: 10, name: "bulk" } } },
            { updateOne: { filter: { n: 10 }, update: { $set: { name: "changed" } } } },
            { deleteOne: { filter: { n: 10 } } }
        ])`);
        // Rows put key, colon and value on lines of their own: compared without the white space.
        const counts = (await panel.locator("[data-testid=query-result]").innerText()).replace(/\s+/g, "");
        for (const expected of ["insertedCount:1", "modifiedCount:1", "deletedCount:1"]) assert.ok(counts.includes(expected), `${expected} not in ${counts.slice(0, 300)}`);
        // Two statements: both run, the last one is the result.
        await runShell(`print(${target}.countDocuments({}));\n${target}.find({ n: 1 })`);
        assert.equal((await panel.locator("[data-testid=script-output]").innerText()).trim(), "3");
        assert.equal(await panel.locator("[data-testid=result-range]").innerText(), "1 – 1");
    });

    await step("an endless script can be stopped", async () => {
        const panel = page.locator("[data-testid=tab-panel]:visible");
        await write(panel, "for (;;) {}");
        await panel.locator("[data-testid=query-run]").click();
        await panel.locator("[data-testid=query-stop]").click();
        await panel.locator("[data-testid=query-error]", { hasText: "stopped" }).waitFor();
        await panel.locator("[data-testid=query-run]").waitFor();
    });

    await step("the tree shows the new collection after a refresh", async () => {
        await id("connection-row").first().click({ button: "right" });
        await chooseMenu("Refresh");
        const row = page.locator("[data-testid=database-row]", { hasText: DATABASE });
        await row.waitFor();
        await row.locator("[data-testid=database-toggle]").click();
        await page.locator("[data-testid=collection-row]", { hasText: COLLECTION }).waitFor();
    });

    await step("a capped collection, its validator and a view are made through the dialogs", async () => {
        const database = page.locator("[data-testid=database-row]", { hasText: DATABASE });
        await database.click({ button: "right" });
        await chooseMenu("Create collection");
        await id("collection-name").fill(`${COLLECTION}_capped`);
        await page.locator("dialog[open] [role=switch]").first().click();
        await page.locator("dialog[open] input[inputmode=numeric]").first().fill("100000");
        await id("collection-save").click();
        const capped = page.locator("[data-testid=collection-row]", { hasText: `${COLLECTION}_capped` });
        await capped.waitFor();

        await capped.click({ button: "right" });
        await chooseMenu("Create/edit validator");
        const dialog = page.locator("dialog[open]");
        await write(dialog, "{ n: { $type: \"int\" } }");
        await id("collection-save").click();
        await dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
        await capped.click({ button: "right" });
        await chooseMenu("Create/edit validator");
        assert.match(await page.locator("dialog[open] .cm-content:visible").innerText(), /\$type/);
        await page.keyboard.press("Escape");

        await page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) }).click({ button: "right" });
        await chooseMenu("Create view");
        await id("collection-name").fill(`${COLLECTION}_view`);
        await write(page.locator("dialog[open]"), "[{ $match: { n: { $gte: 2 } } }]");
        await id("collection-save").click();
        const view = page.locator("[data-testid=collection-row]", { hasText: `${COLLECTION}_view` });
        await view.waitFor();
        // A view shows as one, and has nothing to unfold.
        assert.equal(await view.locator(".i-lucide-eye").count(), 1);
        assert.ok(await view.locator("[data-testid=collection-toggle].invisible").count() === 1);
    });

    const panel = page.locator("[data-testid=tab-panel]:visible");
    await step("the statistics of all collections are a table without the views", async () => {
        await page.locator("[data-testid=database-row]", { hasText: DATABASE }).click({ button: "right" });
        await chooseMenu("Collections statistics");
        const table = panel.locator("[data-testid=result-table]");
        await table.waitFor();
        assert.match(await table.locator("thead").innerText(), /storageSize/);
        await table.locator("[data-testid=table-cell]", { hasText: new RegExp(`^${COLLECTION}_capped$`) }).waitFor();
        assert.equal(await table.locator("[data-testid=table-cell]", { hasText: `${COLLECTION}_view` }).count(), 0);
    });

    await step("double click opens the collection with its documents", async () => {
        await page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) }).dblclick();
        await visible("browse-title").waitFor();
        await panel.locator("[data-testid=tree-row]").first().waitFor();
        assert.equal(await panel.locator("[data-testid=result-range]").innerText(), "1 – 3");
        const text = await panel.locator("[data-testid=query-result]").innerText();
        assert.match(text, /NumberLong\(9007199254740993\)/);
        assert.match(text, /2024-05-01T00:00:00\.000Z/);
        // Without a filter the count comes from the collection itself.
        await panel.locator("[data-testid=result-count]").click();
        await page.locator("text=/matches 3 documents/").first().waitFor();
        // The export offers its formats; the file dialog itself belongs to the system.
        await visible("result-export").click();
        for (const format of ["JSON", "JSON Lines", "CSV"]) await page.locator("[data-testid=menu-item]:visible", { hasText: `Export as ${format}` }).first().waitFor();
        await page.keyboard.press("Escape");
    });

    await step("a collection unfolds to its indexes; they are created, hidden, duplicated and dropped", async () => {
        const row = page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) });
        await row.locator("[data-testid=collection-toggle]").click();
        await page.locator("[data-testid=index-row]", { hasText: "_id_" }).waitFor();
        await row.click({ button: "right" });
        await chooseMenu("Create index");
        await id("index-field").nth(0).fill("name");
        await id("index-add-field").click();
        await id("index-field").nth(1).fill("n");
        assert.equal(await id("index-name").getAttribute("placeholder"), "name_1_n_1");
        await id("index-save").click();
        const index = page.locator("[data-testid=index-row]", { hasText: "name_1_n_1" });
        await index.waitFor();

        await index.click({ button: "right" });
        await chooseMenu("Hide index");
        await index.getByText("hidden", { exact: true }).waitFor();

        // Re-created with a changed option, under its name; it stays hidden as it was.
        await index.click({ button: "right" });
        await chooseMenu("Re-create index");
        assert.equal(await id("index-name").inputValue(), "name_1_n_1");
        await id("index-unique").click();
        await id("index-save").click();
        await page.locator("dialog[open]").waitFor({ state: "detached" });
        await index.dblclick();
        const definition = await page.locator("dialog[open] .cm-content").innerText();
        assert.match(definition, /unique: true/);
        assert.match(definition, /hidden: true/);
        await page.keyboard.press("Escape");

        // The copy starts with the fields and options of the original, under a name of its own.
        await index.click({ button: "right" });
        await chooseMenu("Duplicate index");
        assert.equal(await id("index-field").count(), 2);
        await page.locator("[data-testid=index-field-row]").nth(1).getByRole("button", { name: "Remove field" }).click();
        await id("index-name").fill("name_copy");
        await id("index-save").click();
        const copy = page.locator("[data-testid=index-row]", { hasText: "name_copy" });
        await copy.waitFor();

        for (const item of [index, copy]) {
            await item.click({ button: "right" });
            await chooseMenu("Drop index");
            await id("confirm-action").click();
            await item.waitFor({ state: "detached" });
        }
    });

    await step("a collection is copied with Ctrl+C and pasted under a new name", async () => {
        const row = page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) });
        await row.click();
        await page.keyboard.press("Control+c");
        await page.locator("[data-testid=database-row]", { hasText: DATABASE }).click({ button: "right" });
        await chooseMenu(`Paste collection ${COLLECTION}`);
        // The name is taken in the same database: the dialog offers one of its own.
        assert.equal(await id("prompt-input").inputValue(), `${COLLECTION}_copy`);
        await id("prompt-submit").click();
        await page.locator("[data-testid=collection-row]", { hasText: `${COLLECTION}_copy` }).waitFor();
        await page.getByText(`Copied to ${COLLECTION}_copy: 3 documents, 0 indexes.`).first().waitFor();
    });

    await step("a collection marked read-only in the tree refuses changes until the mark is gone", async () => {
        const row = page.locator("[data-testid=collection-row]", { hasText: `${COLLECTION}_copy` });
        await row.click({ button: "right" });
        await page.locator("[data-testid=swatch-blue]:visible").click();
        await row.click({ button: "right" });
        await chooseMenu("Set comment");
        await id("prompt-input").fill("archive");
        await id("prompt-submit").click();
        await row.locator("[data-testid=note-comment]", { hasText: "archive" }).waitFor();
        await row.click({ button: "right" });
        await chooseMenu("Read-only");
        await row.locator("[data-testid=note-readonly]").waitFor();
        await row.click({ button: "right" });
        await shot("tree-notes");
        await page.keyboard.press("Escape");

        // Neither the tree nor a tab on the collection may change it now.
        await row.click({ button: "right" });
        await chooseMenu("Drop collection");
        await page.getByText("is marked read-only in the connection tree").first().waitFor();
        assert.equal(await page.locator("dialog[open]").count(), 0);
        await row.dblclick();
        await visible("browse-title").waitFor();
        const lock = visible("query-readonly");
        assert.equal(await lock.getAttribute("aria-pressed"), "true");
        assert.ok(await lock.isDisabled());
        await page.keyboard.press("Control+w");

        await row.click({ button: "right" });
        await chooseMenu("Read-only");
        await row.locator("[data-testid=note-readonly]").waitFor({ state: "detached" });
        await row.click({ button: "right" });
        await chooseMenu("Remove comment");
        await row.locator("[data-testid=note-comment]").waitFor({ state: "detached" });
        await row.click({ button: "right" });
        await page.locator("[data-testid=swatch-none]:visible").click();
    });

    await step("a GridFS bucket shows as one row; its files are listed, renamed and deleted", async () => {
        const bucket = `${COLLECTION}_bucket`;
        await page.locator("[data-testid=database-row]", { hasText: DATABASE }).click({ button: "right" });
        await chooseMenu("Create GridFS bucket");
        await id("prompt-input").fill(bucket);
        await id("prompt-submit").click();
        await visible("gridfs-title").waitFor();
        await page.locator("text=No files in this bucket yet.").first().waitFor();
        await page.keyboard.press("Control+w");

        // A file as a driver writes it: its entry and one chunk ("abc").
        await id("dock-shell").click();
        const test = `db.getSiblingDB("${DATABASE}")`;
        await runShell(`${test}.getCollection("${bucket}.files").insertOne({ _id: 1, length: 3, chunkSize: 261120, uploadDate: new Date(), filename: "hello.txt" }); ${test}.getCollection("${bucket}.chunks").insertOne({ files_id: 1, n: 0, data: BinData(0, "YWJj") })`);
        await page.keyboard.press("Control+w");

        const row = page.locator("[data-testid=collection-row]", { hasText: "GridFS" }).filter({ hasText: bucket });
        await page.locator("[data-testid=connection-row]").first().click({ button: "right" });
        await chooseMenu("Refresh");
        await row.waitFor();
        assert.equal(await page.locator("[data-testid=collection-row]", { hasText: `${bucket}.chunks` }).count(), 0);
        await row.dblclick();
        const file = page.locator("[data-testid=gridfs-file]:visible", { hasText: "hello.txt" });
        await file.waitFor();
        assert.match(await file.innerText(), /3 B/);
        await file.click();
        await visible("gridfs-rename").click();
        await id("prompt-input").fill("hi.txt");
        await id("prompt-submit").click();
        const renamed = page.locator("[data-testid=gridfs-file]:visible", { hasText: "hi.txt" });
        await renamed.click();
        await visible("gridfs-delete").click();
        await id("confirm-action").click();
        await page.locator("text=No files in this bucket yet.").first().waitFor();
        await page.keyboard.press("Control+w");
        await visible("browse-title").waitFor();
    });

    await step("the server status and the server log open as tabs of their own", async () => {
        await id("connection-row").first().click({ button: "right" });
        await chooseMenu("Server status");
        const connectionsShown = page.locator("[data-testid=status-connections]:visible");
        await connectionsShown.waitFor();
        assert.match(await connectionsShown.innerText(), /^\d/);
        await visible("running-operations").waitFor();
        // A second sample gives the rates per second.
        if (process.env.QUERYMASTER_SHOTS) await page.waitForTimeout(3500);
        await shot("server-status");
        await page.keyboard.press("Control+w");

        await id("connection-row").first().click({ button: "right" });
        await chooseMenu("Server log");
        const lines = page.locator("[data-testid=log-line]:visible");
        await lines.first().waitFor();
        await shot("server-log");
        await visible("log-search").fill("connection");
        await lines.first().waitFor();
        await visible("log-search").fill("no line holds this text 4711");
        await lines.first().waitFor({ state: "detached" });
        await page.keyboard.press("Control+w");
        // Closed, the tab before comes back: the collection of the steps before.
        await visible("browse-title").waitFor();
    });

    await step("a role and a user with it are created, signed in with, changed and dropped", async () => {
        const role = `${COLLECTION}_role`;
        const user = `${COLLECTION}_user`;
        await page.locator("[data-testid=database-row]", { hasText: DATABASE }).click({ button: "right" });
        await chooseMenu("Manage roles");
        await visible("role-new").click();
        await visible("role-name-field").fill(role);
        await visible("privilege-actions").fill("find, listCollections");
        await visible("role-save").click();
        await page.locator("[data-testid=role-item]:visible", { hasText: role }).waitFor();
        await shot("roles");
        await page.keyboard.press("Control+w");

        await page.locator("[data-testid=database-row]", { hasText: DATABASE }).click({ button: "right" });
        await chooseMenu("Manage users");
        await visible("user-new").click();
        await visible("user-name").fill(user);
        const password = `pw-${Math.random().toString(36).slice(2)}`;
        await visible("user-password").fill(password);
        await page.locator("[data-testid=role-name]:visible").first().fill(role);
        await visible("user-save").click();
        const item = page.locator("[data-testid=user-item]:visible", { hasText: user });
        await item.waitFor();
        await shot("users");
        // The password is gone from the form once the server has it.
        await valueBecomes(visible("user-password"), "");

        // A second role is granted without touching the password.
        await visible("role-add").click();
        await page.locator("[data-testid=role-name]:visible").nth(1).fill("read");
        await visible("user-save").click();
        await page.locator("[data-testid=role-row]:visible").nth(1).waitFor();
        await valueBecomes(page.locator("[data-testid=role-name]:visible").nth(1), "read");

        // The new user signs in with a connection of its own and sees only what the role grants.
        const limited = new URL(uri);
        limited.username = user;
        limited.password = password;
        limited.pathname = `/${DATABASE}`;
        limited.searchParams.set("authSource", DATABASE);
        const limitedName = `Limited ${process.pid}`;
        await page.locator("[data-testid=tab]", { hasText: "Startup page" }).click();
        await id("start-create").click();
        await id("connection-name").fill(limitedName);
        await id("connection-from-uri").click();
        await id("prompt-input").fill(limited.toString());
        await id("prompt-submit").click();
        await id("connection-save").click();
        // Folded first: the databases that show afterwards are those of the new connection only.
        await page.keyboard.press("Control+Shift+U");
        await id("database-row").first().waitFor({ state: "detached" });
        await page.locator("[data-testid=recent-connection]", { hasText: limitedName }).click();
        const limitedRow = page.locator("[data-testid=connection-row]", { hasText: limitedName });
        await limitedRow.waitFor();
        await id("database-row").first().waitFor();
        assert.deepEqual((await id("database-row").allInnerTexts()).map(text => text.trim().split(/\s/)[0]), [DATABASE]);
        await limitedRow.click({ button: "right" });
        await chooseMenu("Disconnect");
        await id("connection-list").click();
        const limitedItem = page.locator("[data-testid=connection-item]:visible", { hasText: limitedName });
        await limitedItem.locator("button[aria-label=Delete]").click();
        await id("confirm-action").click();
        await page.locator("[data-testid=recent-connection]", { hasText: limitedName }).waitFor({ state: "detached" });
        // The tree as the later steps expect it: the test database open.
        await page.locator("[data-testid=connection-row]", { hasText: NAME }).dblclick();
        await page.locator("[data-testid=database-row]", { hasText: DATABASE }).locator("[data-testid=database-toggle]").click();
        await page.locator("[data-testid=collection-row]").first().waitFor();
        await page.locator("[data-testid=tab]", { hasText: "Users of" }).click();

        await visible("user-drop").click();
        await id("confirm-action").click();
        await item.waitFor({ state: "detached" });
        await page.keyboard.press("Control+w");

        await page.locator("[data-testid=database-row]", { hasText: DATABASE }).click({ button: "right" });
        await chooseMenu("Manage roles");
        await page.locator("[data-testid=role-item]:visible", { hasText: role }).click();
        await visible("role-drop").click();
        await id("confirm-action").click();
        await page.locator("[data-testid=role-item]:visible", { hasText: role }).waitFor({ state: "detached" });
        await page.keyboard.press("Control+w");
        await visible("browse-title").waitFor();
    });

    await step("the aggregation builder runs a pipeline of stages, reordered and switched", async () => {
        await page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) }).click({ button: "right" });
        await chooseMenu("Open aggregation builder");
        await visible("aggregate-title").waitFor();
        const rows = page.locator("[data-testid=pipeline-stage]:visible");
        assert.equal(await rows.count(), 1);
        await write(rows.nth(0), "{ n: { $gte: 1 } }");
        await visible("stage-add").click();
        await chooseMenu("$group");
        assert.equal(await rows.count(), 2);
        await write(rows.nth(1), "{ _id: null, documents: { $sum: 1 } }");
        await visible("query-run").click();
        await panel.locator("[data-testid=query-run]:not([disabled])").waitFor();
        await panel.locator("[data-testid=result-range]").waitFor();
        assert.match(await panel.locator("[data-testid=query-result]").innerText(), /documents/);
        await shot("aggregate");

        // $group moved in front of $match: the stages run in the new order.
        await rows.nth(1).locator(".cm-content").click();
        await visible("stage-up").click();
        assert.equal(await rows.nth(0).locator("[data-testid=stage-operator]").innerText(), "$group");
        await rows.nth(1).locator("[role=switch]").click();
        await visible("query-run").click();
        await panel.locator("[data-testid=query-run]:not([disabled])").waitFor();
        assert.match(await panel.locator("[data-testid=query-result]").innerText(), /documents/);

        // Up to the first stage only; then with options; then over the shell and back.
        await rows.nth(0).locator(".cm-content").click();
        await visible("stage-preview").click();
        await panel.locator("[data-testid=query-run]:not([disabled])").waitFor();
        assert.match(await panel.locator("[data-testid=query-result]").innerText(), /documents/);
        await visible("aggregate-options").click();
        await write(visible("aggregate-options-row"), "{ allowDiskUse: true }");
        await visible("query-run").click();
        await panel.locator("[data-testid=query-run]:not([disabled])").waitFor();
        assert.equal(await panel.locator("[data-testid=query-error]").count(), 0);
        await visible("query-to-shell").click();
        assert.match(await page.locator(".cm-content:visible").first().innerText(), /allowDiskUse: true/);
        await visible("shell-to-builder").click();
        await visible("aggregate-title").waitFor();
        // The stage that was switched off is not part of the statement, so not of the new builder.
        assert.equal(await rows.count(), 1);
        assert.equal(await rows.nth(0).locator("[data-testid=stage-operator]").innerText(), "$group");
        await visible("aggregate-options-row").waitFor();
        for (let close = 0; close < 3; close++) await page.keyboard.press("Control+w");
        await visible("browse-title").waitFor();
    });

    await step("filter and sort narrow and order the result", async () => {
        const rows = panel.locator("[data-testid=stage-row]");
        await write(rows.nth(0), "{ n: { $gte: 2 } }");
        await write(rows.nth(2), "{ n: -1 }");
        await panel.locator("[data-testid=query-run]").click();
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=result-range]")].some(element => element.offsetParent && element.textContent.trim() === "1 – 2"));
        assert.match(await panel.locator("[data-testid=tree-value]").first().innerText(), /./);
        assert.equal(await panel.locator("[data-testid=query-error]").count(), 0);
        // The same query as code of a driver.
        await panel.locator("[data-testid=result-code]").click();
        await id("text-variant-1").click();
        const code = await page.locator("dialog[open] .cm-content").innerText();
        assert.match(code, /\.find\(EJSON\.parse\(/);
        assert.match(code, /\.sort\(EJSON\.parse\(/);
        await page.keyboard.press("Escape");
    });

    await step("table and JSON views show the same documents", async () => {
        await panel.locator("[data-testid=view-table]").click();
        assert.equal(await panel.locator("[data-testid=table-row]").count(), 2);
        assert.match(await panel.locator("[data-testid=result-table] thead").innerText(), /name/);
        await panel.locator("[data-testid=view-json]").click();
        assert.match(await panel.locator("[data-testid=query-result] .cm-content").innerText(), /"name": "three"/);
        await panel.locator("[data-testid=view-tree]").click();
    });

    await step("the table steps into an array and back", async () => {
        const rows = panel.locator("[data-testid=stage-row]");
        await write(rows.nth(0), "{ }");
        await panel.locator("[data-testid=query-run]").click();
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=result-range]")].some(element => element.offsetParent && element.textContent.trim() === "1 – 3"));
        await panel.locator("[data-testid=view-table]").click();
        // The column head carries the type of the values.
        await panel.locator("[data-testid=table-column]", { hasText: "tags" }).filter({ hasText: "array" }).waitFor();
        await panel.locator("[data-testid=table-cell]", { hasText: "[2 elements]" }).dblclick();
        await panel.locator("[data-testid=table-column]", { hasText: "0 - tags.0" }).waitFor();
        await panel.locator("[data-testid=table-step-back]").click();
        await panel.locator("[data-testid=table-column]", { hasText: "tags" }).first().waitFor();
        await panel.locator("[data-testid=view-tree]").click();
        await write(rows.nth(0), "{ n: { $gte: 2 } }");
        await panel.locator("[data-testid=query-run]").click();
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=result-range]")].some(element => element.offsetParent && element.textContent.trim() === "1 – 2"));
    });

    await step("a value is changed in place in the tree", async () => {
        const value = panel.locator("[data-testid=tree-row]", { hasText: /^\s*1\s*name/ }).locator("[data-testid=tree-value]");
        await value.dblclick();
        await panel.locator("[data-testid=tree-edit]").fill("\"THREE\"");
        await page.keyboard.press("Enter");
        await panel.locator("[data-testid=tree-value]", { hasText: "THREE" }).first().waitFor();
    });

    await step("a cell is changed in place in the table", async () => {
        await panel.locator("[data-testid=view-table]").click();
        await panel.locator("[data-testid=table-cell]", { hasText: "two" }).dblclick();
        await panel.locator("[data-testid=table-edit]").fill("\"TWO\"");
        await page.keyboard.press("Enter");
        await panel.locator("[data-testid=table-cell]", { hasText: "TWO" }).waitFor();
        await panel.locator("[data-testid=view-tree]").click();
    });

    await step("a document is edited in the dialog", async () => {
        await panel.locator("[data-testid=tree-row]").first().click();
        await panel.locator("[data-testid=document-edit]").click();
        const dialog = page.locator("dialog[open]");
        const text = await dialog.locator(".cm-content").innerText();
        await write(dialog, text.replace("\"THREE\"", "\"edited\""));
        await dialog.locator("[data-testid=text-submit]").click();
        await dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
        await panel.locator("[data-testid=tree-value]", { hasText: "edited" }).first().waitFor();
    });

    await step("read-only refuses a write, with a message", async () => {
        await panel.locator("[data-testid=query-readonly]").click();
        assert.equal(await panel.locator("[data-testid=document-add]").isDisabled(), true);
        await panel.locator("[data-testid=query-readonly]").click();
    });

    await step("counting reports all matching documents", async () => {
        await panel.locator("[data-testid=result-count]").click();
        await page.locator("text=/matches 2 documents/").first().waitFor();
    });

    await step("a document is removed after confirming", async () => {
        await panel.locator("[data-testid=tree-row]").first().click();
        await panel.locator("[data-testid=document-remove]").click();
        await id("confirm-action").click();
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=result-range]")].some(element => element.offsetParent && element.textContent.trim() === "1 – 1"));
    });

    await step("documents in shell notation are imported from the clipboard; one is read again", async () => {
        await page.evaluate(() => navigator.clipboard.writeText("[{ name: \"clip\", n: 5 }, { name: \"clip\", n: NumberLong(6) }]"));
        const probe = await page.evaluate(async () => {
            try {
                return await navigator.clipboard.readText();
            } catch (error) {
                return `error ${String(error)}`;
            }
        });
        assert.match(probe, /clip/, probe);
        await panel.locator("[data-testid=tree-row]").first().click({ button: "right" });
        await chooseMenu("Import from clipboard");
        await page.locator("dialog[open]", { hasText: "Insert 2 documents" }).waitFor();
        await id("confirm-action").click();
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=result-range]")].some(element => element.offsetParent && element.textContent.trim() === "1 – 3"));
        await panel.locator("[data-testid=tree-row]").first().click({ button: "right" });
        await chooseMenu("Refresh document");
        await page.waitForTimeout(300);
        assert.equal(await panel.locator("[data-testid=query-error]").count(), 0);
        assert.equal(await panel.locator("[data-testid=tree-row]").count() >= 3, true);
    });

    await step("the history offers the statements that ran", async () => {
        await panel.locator("[data-testid=history]").click();
        await page.locator("[data-testid=menu-item]:visible", { hasText: COLLECTION }).first().waitFor();
        await page.keyboard.press("Escape");
    });

    await step("a connection from a typed string is used and gone with disconnect, saved nowhere", async () => {
        const recent = await id("recent-connection").count();
        await page.locator("[data-testid=tab]", { hasText: "Startup page" }).click();
        await id("start-from-uri").click();
        await id("prompt-input").fill(uri);
        await id("prompt-submit").click();
        await page.waitForFunction(() => document.querySelectorAll("[data-testid=connection-row]").length === 2);
        const row = id("connection-row").last();
        assert.doesNotMatch(await row.innerText(), /@/, "the credentials show in the tree");
        assert.equal(await id("recent-connection").count(), recent);
        await row.click({ button: "right" });
        assert.equal(await page.locator("[data-testid=menu-item]:visible", { hasText: "Open connection settings" }).count(), 0);
        await chooseMenu("Disconnect");
        await page.waitForFunction(() => document.querySelectorAll("[data-testid=connection-row]").length === 1);
        assert.equal(await id("recent-connection").count(), recent);
    });

    await step("the settings give new tabs their page size and view", async () => {
        const choose = async (field, label) => {
            await page.locator("dialog[open] [data-testid=select-field]").nth(field).click();
            await page.locator("[data-testid=menu-item]:visible", { hasText: label }).first().click();
        };
        await page.keyboard.press("Control+Alt+P");
        await visible("settings").waitFor();
        await choose(2, "50");
        await choose(3, "Table view");
        await visible("settings-close").click();
        await page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) }).dblclick();
        await panel.locator("[data-testid=table-row]").first().waitFor();
        assert.equal((await panel.locator("[data-testid=page-size]").innerText()).trim(), "50");
        await page.keyboard.press("Control+w");

        // Back to the defaults: later runs, and the app's own data, start as before.
        await page.keyboard.press("Control+Alt+P");
        await choose(2, "20");
        await choose(3, "Tree view");
        await visible("settings-close").click();
    });

    await step("Ctrl+Shift+U folds the whole tree", async () => {
        await id("database-row").first().waitFor();
        await page.keyboard.press("Control+Shift+U");
        await id("database-row").first().waitFor({ state: "detached" });
        await id("connection-row").first().dblclick();
        await id("database-row").first().waitFor();
        assert.equal(await id("collection-row").count(), 0);
    });

    await step("the window maximizes and restores", async () => {
        const before = await page.evaluate(() => window.innerWidth);
        await page.locator("button[aria-label=Maximize]").click();
        await page.waitForFunction(width => window.innerWidth !== width, before);
        await page.locator("button[aria-label=Maximize]").click();
        await page.waitForFunction(width => window.innerWidth === width, before);
    });
} catch {
    failures.push("a step failed");
} finally {
    // Leave nothing behind: the collection, and the connection with its keychain entry.
    await step("clean up: collection dropped, connection deleted", async () => {
        await page.keyboard.press("Escape");
        if (await id("connection-row").count() > 0) {
            await id("connection-row").first().click();
            await id("dock-shell").click();
            // Also what an earlier run left behind when it broke off: every e2e_ collection of the test database.
            const test = `db.getSiblingDB("${DATABASE}")`;
            await runShell(`${test}.getCollectionNames().filter(name => name.startsWith("e2e_")).forEach(name => ${test}.getCollection(name).drop())`).catch(() => undefined);
            const left = await runShell(`${test}.getCollectionNames().filter(name => name.startsWith("e2e_")).length`);
            assert.match(await left.locator("[data-testid=query-result]").innerText(), /^\s*1?\s*0\b/);
            // A user or role a failed step left behind.
            await runShell(`db.getSiblingDB("${DATABASE}").runCommand({ dropUser: "${COLLECTION}_user" })`).catch(() => undefined);
            await runShell(`db.getSiblingDB("${DATABASE}").runCommand({ dropRole: "${COLLECTION}_role" })`).catch(() => undefined);
        }
        await id("connection-list").click();
        const item = page.locator("[data-testid=connection-item]:visible", { hasText: NAME });
        if (await item.count() > 0) {
            await item.locator("button[aria-label=Delete]").click();
            await id("confirm-action").click();
            await page.locator("[data-testid=recent-connection]", { hasText: NAME }).waitFor({ state: "detached" });
        } else await page.keyboard.press("Escape");
    }).catch(() => undefined);

    console.log(steps.join("\n"));
    if (failures.length > 0) console.log(`\nErrors in the page:\n${failures.join("\n")}`);
    await browser.close();
}
if (failures.length > 0) process.exit(1);
