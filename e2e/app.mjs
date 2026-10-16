// Walks through the real app (the Tauri window, the Rust side, a MongoDB server) and checks what
// a person would check by hand. Started by `tools/e2e.ps1`, which runs the app with the web view's
// debugging port open. Writes only into the database `querymaster_test`.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
page.on("console", message => message.type() === "error" && failures.push(`console: ${message.text()} (${message.location().url})`));

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
        // The first lines say what was waited for and why it did not happen (e.g. another element
        // intercepts the click); the rest is Playwright's retry log.
        steps.push(`FAIL  ${name}: ${String(error.message).split("\n").slice(0, 6).join(" | ")}`);
        // An assertion says what it got; the stack says which one it was.
        if ("actual" in error) steps.push(`      actual ${JSON.stringify(error.actual)}, expected ${JSON.stringify(error.expected)}`);
        // Every place in this file, so a failure inside a helper also names the call that led there.
        const lines = String(error.stack).split("\n").filter(entry => entry.includes("app.mjs")).slice(0, 4);
        if (lines.length > 0) steps.push(`      at ${lines.map(entry => entry.trim().replace(/^at /, "")).join(" <- ")}`);
        await shot(`fail-${steps.length}`).catch(() => undefined);
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

/**
 * Chooses `text` in a choice field (`field` is the field itself or its `choice-field` box): from
 * the list of a fixed one; typed into a free one and taken from its list, or kept as a new name.
 */
async function choose(field, text) {
    const exact = page.locator("[data-testid=choice-option]:visible").filter({ hasText: new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) });
    const input = field.locator("input[role=combobox]").or(field.and(page.locator("input[role=combobox]")));
    if (await input.count() === 0) {
        // Fixed lists name entries with more than the value ("Semicolon (;)"): part of the text is enough.
        await field.click();
        await page.locator("[data-testid=choice-option]:visible", { hasText: text }).first().click();
        return;
    }
    await input.fill(text);
    await exact.or(visible("choice-new")).first().waitFor();
    if (await exact.count() > 0) await exact.first().click();
    else await visible("choice-new").click();
    await valueBecomes(input, text);
}

/** Closes every notice card, so none lies over what is clicked next. */
async function dismissToasts() {
    const close = page.locator("[data-testid=notice-close]:visible");
    for (let round = 0; round < 20 && await close.count() > 0; round++) await close.first().click().catch(() => undefined);
}

/** Replaces the text of the code editor inside `scope`. */
async function write(scope, text) {
    // Tabs keep their hidden panels in the page: only the editor that shows is meant.
    const editor = scope.locator(".cm-content:visible").first();
    // At the start of the first line: a list of suggestions still open below it does not catch the click.
    await editor.click({ position: { x: 4, y: 4 } });
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

/** Opens the menu of a group (Documents, Fields, Copy) beside its line. */
async function openGroup(label) {
    await page.locator("[data-testid=menu-group]:visible", { hasText: label }).first().hover();
    await page.locator("[data-testid=sub-menu]:visible").waitFor();
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

    await step("a script prints while it runs, a cursor it ends with pages, a mistake puts the cursor on its line", async () => {
        const panel = page.locator("[data-testid=tab-panel]:visible");
        await write(panel, `print("early");\nvar end = Date.now() + 1500;\nwhile (Date.now() < end) {}\ndb.getSiblingDB("${DATABASE}").getCollection("${COLLECTION}").find({}).sort({ n: 1 })`);
        await panel.locator("[data-testid=query-run]").click();
        // The line is there while the script still runs: Stop is still offered.
        await panel.locator("[data-testid=script-output]", { hasText: "early" }).waitFor({ timeout: 1200 });
        assert.equal(await panel.locator("[data-testid=query-stop]").count(), 1, "the output came only at the end");
        await panel.locator("[data-testid=query-run]:not([disabled])").waitFor();
        assert.equal(await panel.locator("[data-testid=result-range]").innerText(), "1 – 3");

        await write(panel, "var a = 1;\n  nope();");
        await panel.locator("[data-testid=query-run]").click();
        await panel.locator("[data-testid=query-error]", { hasText: "nope is not defined" }).waitFor();
        assert.match(await panel.locator(".cm-activeLine:visible").innerText(), /nope\(\)/);
    });

    await step("several statements give a result tab each; a failing one stops there with the cursor on it", async () => {
        const target = `db.getSiblingDB("${DATABASE}").getCollection("${COLLECTION}")`;
        const panel = await runShell(`${target}.find({ n: 1 });\n${target}.countDocuments({});\n${target}.find({}).sort({ n: 1 })`);
        const results = panel.locator("[data-testid=statement-result]");
        assert.equal(await results.count(), 3);
        assert.match(await results.nth(1).innerText(), /2 · .*countDocuments/);
        assert.equal(await panel.locator("[data-testid=result-range]").innerText(), "1 – 3");
        await results.first().click();
        await panel.locator("[data-testid=result-range]", { hasText: /^1 – 1$/ }).waitFor();

        const panelAgain = page.locator("[data-testid=tab-panel]:visible");
        await write(panelAgain, `${target}.find({ n: 1 });\n${target}.insertOne(5);\n${target}.find({})`);
        await panelAgain.locator("[data-testid=query-run]").click();
        await panelAgain.locator("[data-testid=query-error]").waitFor();
        // The first ran and stays; the third never ran, so there is no row of tabs.
        assert.equal(await panelAgain.locator("[data-testid=statement-result]").count(), 0);
        assert.match(await panelAgain.locator(".cm-activeLine:visible").innerText(), /insertOne\(5\)/);
    });

    await step("a connection marked production asks before writing, with the documents it touches", async () => {
        const target = `db.getSiblingDB("${DATABASE}").getCollection("${COLLECTION}")`;
        const setEnvironment = async (label) => {
            await page.locator("[data-testid=connection-row]", { hasText: NAME }).click({ button: "right" });
            await openGroup("Environment");
            await chooseMenu(label);
        };
        await setEnvironment("Production");
        await id("status-production").waitFor();
        const panel = page.locator("[data-testid=tab-panel]:visible");
        // `$inc` by 0: the documents are touched, but the later steps see them as they were.
        const statement = `${target}.updateMany({ n: { $gte: 2 } }, { $inc: { n: 0 } })`;

        // Cancelled: nothing is written.
        await write(panel, statement);
        await panel.locator("[data-testid=query-run]").click();
        await id("confirm-facts").waitFor();
        assert.match(await id("confirm-facts").innerText(), /Documents\s*2/);
        // The field `n`, before and after, in a column of its own.
        assert.match(await id("confirm-table").innerText(), /\tn\t/);
        await page.keyboard.press("Escape");
        await panel.locator("[data-testid=query-error]", { hasText: "cancelled" }).waitFor();

        // Confirmed: the statement runs on the two documents.
        await panel.locator("[data-testid=query-run]").click();
        await id("confirm-action").click();
        await panel.locator("[data-testid=query-result]", { hasText: "matchedCount" }).waitFor();
        assert.ok((await panel.locator("[data-testid=query-result]").innerText()).replace(/\s+/g, "").includes("matchedCount:2"));

        await setEnvironment("None");
        await id("status-production").waitFor({ state: "detached" });
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
        // Dates show in the machine's locale and time zone, as in the table.
        assert.match(text, /\nat\n:\n[^\n]*2024[^\n]*\ndate\n/);
        // Without a filter the count comes from the collection itself.
        await panel.locator("[data-testid=result-count]").click();
        await page.locator("[data-testid=status-message]", { hasText: /matches 3 documents/ }).waitFor();
        // The export of the result opens the wizard with its collection, as one row; so does Ctrl+S.
        await visible("result-export").click();
        await id("export-wizard").waitFor();
        assert.equal(await id("export-row").count(), 1);
        await id("export-close").click();
        await id("export-wizard").waitFor({ state: "hidden" });
        await panel.locator("[data-testid=tree-row]").first().click();
        await page.keyboard.press("Control+s");
        await id("export-wizard").waitFor();
        assert.equal(await id("export-output").inputValue(), `${DATABASE}.${COLLECTION}.json`);
        await id("export-close").click();
        await id("export-wizard").waitFor({ state: "hidden" });
        // Ctrl+O: the import wizard, every file going into this collection.
        await page.keyboard.press("Control+o");
        await id("import-wizard").waitFor();
        await id("import-empty").waitFor();
        await id("import-close").click();
        await id("import-wizard").waitFor({ state: "hidden" });
    });

    await step("a collection unfolds to its indexes; they are created, hidden, duplicated and dropped", async () => {
        const row = page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) });
        await row.locator("[data-testid=collection-toggle]").click();
        await page.locator("[data-testid=index-row]", { hasText: "_id_" }).waitFor();
        await row.click({ button: "right" });
        await chooseMenu("Create index");
        // The field comes from the fields of a sample of the collection: typed in part, taken from the list.
        await id("index-field").nth(0).fill("nam");
        await page.locator("[data-testid=choice-option]:visible", { hasText: /^\s*name\s*$/ }).click();
        await valueBecomes(id("index-field").nth(0), "name");
        await id("index-add-field").click();
        await choose(id("index-field").nth(1), "n");
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

    await step("the export wizard writes a filtered collection to the clipboard and into a database", async () => {
        const row = page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) });
        const openWizard = async () => {
            await row.click({ button: "right" });
            await chooseMenu("Export...");
            await id("export-wizard").waitFor();
        };
        const wizardSelect = (position, label) => choose(page.locator("[data-testid=export-wizard] [data-testid=choice-field]").nth(position), label);
        // A row is done a moment before the text reaches the clipboard: wait for it to change.
        const readClipboard = () => page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
        let clipboard = await readClipboard();
        const clipboardChanged = async () => {
            for (let attempt = 0; attempt < 50; attempt++) {
                const text = await readClipboard();
                if (text !== clipboard) return (clipboard = text);
                await page.waitForTimeout(100);
            }
            throw new Error("the export did not reach the clipboard");
        };

        // JSON in the shell's notation, with a filter of the row.
        await openWizard();
        await shot("export-wizard");
        assert.equal(await id("export-output").inputValue(), `${DATABASE}.${COLLECTION}.json`);
        await wizardSelect(0, "Clipboard");
        await id("export-filter").fill("{ n: { $gte: 2 } }");
        await id("export-next").click();
        await id("export-start").click();
        await page.locator("[data-testid=export-progress-row][data-state=done]").waitFor();
        const text = await clipboardChanged();
        assert.equal(text.match(/^\{/gm)?.length, 2, text);
        assert.match(text, /^\t"_id": ObjectId\("[0-9a-f]{24}"\),\r$/m);
        await id("export-close").click();

        // CSV with a semicolon, and columns chosen on the schema page, one of them typed in.
        await openWizard();
        await id("export-tile-csv").click();
        await wizardSelect(0, "Clipboard");
        await id("export-filter").fill("{ n: 1 }");
        await id("export-next").click();
        await wizardSelect(0, "Semicolon");
        await shot("export-csv");
        await id("export-schema").click();
        const columns = page.locator("[data-testid=schema-column]");
        await page.locator("[data-testid=schema-column]", { hasText: /^\s*name\s*$/ }).waitFor();
        for (const name of await columns.allInnerTexts()) {
            if (name.trim() !== "name") await columns.filter({ hasText: new RegExp(`^\\s*${name.trim()}\\s*$`) }).click();
        }
        await id("schema-remove").click();
        await id("schema-typed").fill("nested.deep");
        await id("schema-typed").press("Enter");
        await page.locator("[data-testid=schema-fields] li", { hasText: /^\s*tags\s*$/ }).dblclick();
        assert.deepEqual((await columns.allInnerTexts()).map(name => name.trim()), ["name", "nested.deep", "tags"]);
        await shot("export-schema");
        await id("export-start").click();
        await page.locator("[data-testid=export-progress-row][data-state=done]").waitFor();
        const csv = await clipboardChanged();
        assert.match(csv, /^name;nested\.deep;tags\r?\none;true;"?\[.*"a".*"b".*\]"?\r?\n$/, csv);
        await id("export-close").click();

        // SQL for PostgreSQL with CREATE TABLE, the columns of the first level as they come.
        await openWizard();
        await id("export-tile-sql").click();
        await wizardSelect(0, "Clipboard");
        await id("export-filter").fill("{ n: 2 }");
        await id("export-next").click();
        await wizardSelect(0, "PostgreSQL");
        await shot("export-sql");
        await id("export-schema").click();
        await id("export-start").click();
        await page.locator("[data-testid=export-progress-row][data-state=done]").waitFor();
        const sql = await clipboardChanged();
        assert.match(sql, new RegExp(`^CREATE TABLE "${COLLECTION}" \\(\\r\\n\\t"_id" VARCHAR\\(24\\),`), sql);
        assert.match(sql, new RegExp(`INSERT INTO "${COLLECTION}" \\("_id", "n", "name", "price"\\) VALUES \\('[0-9a-f]{24}', 2, 'two', 9\\.99\\);\\r\\n$`), sql);
        await id("export-close").click();

        // "Export as" opens the wizard on the chosen tile.
        await row.click({ button: "right" });
        await openGroup("Export as");
        await chooseMenu("CSV …");
        await id("export-wizard").waitFor();
        assert.equal(await id("export-tile-csv").getAttribute("aria-checked"), "true");
        await id("export-close").click();
        await id("export-wizard").waitFor({ state: "hidden" });

        // Into a database: the same server, another collection name; an index of the source goes along.
        const source = `db.getSiblingDB("${DATABASE}").getCollection("${COLLECTION}")`;
        await id("dock-shell").click();
        await runShell(`${source}.createIndex({ name: 1 }, { name: "e2e_export_name" })`);
        await openWizard();
        await id("export-tile-database").click();
        await shot("export-database");
        await wizardSelect(0, NAME);
        await choose(id("export-target-database"), DATABASE);
        await id("export-output").fill(`${COLLECTION}_exported`);
        await id("export-next").click();
        await page.locator("[data-testid=export-progress-row][data-state=done]").waitFor();
        await id("export-close").click();
        await page.locator("[data-testid=collection-row]", { hasText: `${COLLECTION}_exported` }).waitFor();
        // "Options and indexes too" is on by default: the index is there in the copy.
        // The names as one text: the documents of `getIndexes()` show folded in the tree.
        const indexes = await runShell(`db.getSiblingDB("${DATABASE}").getCollection("${COLLECTION}_exported").getIndexes().map(function (index) { return index.name; }).join(",")`);
        assert.match(await indexes.locator("[data-testid=query-result]").innerText(), /e2e_export_name/);
        await runShell(`${source}.dropIndex("e2e_export_name")`);
        // The steps after this one expect the tabs as they were.
        await page.keyboard.press("Control+w");
    });

    await step("the import wizard reads exported JSON and CSV files back into new collections", async () => {
        const folder = mkdtempSync(join(tmpdir(), "querymaster-e2e-"));
        const row = page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) });
        const progressText = async (testid) => {
            await page.locator(`[data-testid=${testid}-progress-row][data-state=done]`).waitFor();
            return page.locator(`[data-testid=${testid}-progress-count]`).innerText();
        };

        // Into a folder: JSON in the shell's notation, then CSV, each a file named.
        for (const format of ["json", "csv"]) {
            await row.click({ button: "right" });
            await chooseMenu("Export...");
            await id(`export-tile-${format}`).click();
            await id("export-path").fill(folder);
            await id("export-next").click();
            if (format === "csv") await id("export-schema").click();
            await id("export-start").click();
            assert.match(await progressText("export"), /^3$/);
            assert.match(await id("export-progress-summary").innerText(), /1 of 1 finished · 3 documents/);
            await id("export-close").click();
        }
        const file = format => join(folder, `${DATABASE}.${COLLECTION}.${format}`);
        assert.ok(readFileSync(file("json"), "utf8").startsWith("﻿{\r\n\t\"_id\": ObjectId("));

        // Files dropped on the window: the name gives database and collection, the collection is renamed.
        const drop = paths => page.evaluate(paths => window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
            event: "tauri://drag-drop",
            payload: { paths, position: { x: 400, y: 400 } }
        }), paths);
        await page.locator("[data-testid=database-row]", { hasText: DATABASE }).click({ button: "right" });
        await chooseMenu("Import...");
        await id("import-empty").waitFor();
        await drop([file("json")]);
        await id("import-row").waitFor();
        assert.equal((await id("import-database").innerText()).trim(), DATABASE);
        assert.equal((await id("import-collection").innerText()).trim(), COLLECTION);
        // A double click edits the row in place. Typing filters the collections of the database
        // (the export made one more); Esc closes the list and puts the name back, the row stays open.
        await id("import-row").dblclick();
        const edit = id("import-edit-collection");
        await edit.fill(`${COLLECTION}_exp`);
        await page.locator("[data-testid=choice-option]:visible", { hasText: `${COLLECTION}_exported` }).waitFor();
        await shot("choice-filter");
        await edit.press("Escape");
        await valueBecomes(edit, COLLECTION);
        assert.equal(await visible("choice-option").count(), 0);
        // A name no collection has is taken as new, as the list says; Enter keeps the row.
        await edit.fill(`${COLLECTION}_json`);
        await visible("choice-new").waitFor();
        await visible("choice-new-mark").waitFor();
        await shot("choice-new");
        await edit.press("Enter");
        // The row says the collection will be created.
        await id("import-collection-new").waitFor();
        assert.equal((await id("import-collection").innerText()).trim(), `${COLLECTION}_json`);
        // The mode, set through its column header for every file.
        await id("import-header-mode").click();
        await page.locator("[data-testid=import-bulk-mode]:visible", { hasText: "Generate new _id" }).click();
        assert.match(await page.locator("[data-testid=import-row] [data-testid=choice-field]").innerText(), /Generate new _id/);
        await shot("import-wizard");
        await id("import-next").click();
        assert.match(await progressText("import"), /^3$/);
        await id("import-close").click();

        // CSV: the settings, then the columns with the types guessed from the first rows.
        await page.locator("[data-testid=database-row]", { hasText: DATABASE }).click({ button: "right" });
        await chooseMenu("Import...");
        await drop([file("csv")]);
        assert.equal(await id("import-tile-csv").getAttribute("aria-checked"), "true");
        // The collection, set through its column header.
        await id("import-header-collection").click();
        // Ctrl+A in the field selects its text, not the rows of the table.
        await visible("import-bulk-value").fill("draft");
        await visible("import-bulk-value").press("Control+a");
        await visible("import-bulk-value").pressSequentially(`${COLLECTION}_csv`);
        await valueBecomes(visible("import-bulk-value"), `${COLLECTION}_csv`);
        assert.equal(await page.locator("[data-testid=import-row][data-selected]").count(), 0);
        // Enter, with no entry of the list marked, keeps the text and applies it.
        await visible("import-bulk-value").press("Enter");
        assert.equal((await id("import-collection").innerText()).trim(), `${COLLECTION}_csv`);
        await id("import-next").click();
        // The export kept the semicolon of the CSV step before: the wizard remembers its settings.
        await choose(page.locator("[data-testid=import-wizard] [data-testid=choice-field]").first(), "Semicolon");
        await id("import-schema-next").click();
        const names = page.locator("[data-testid=import-column-name]");
        await names.first().waitFor();
        const columns = await names.evaluateAll(inputs => inputs.map(input => input.value));
        assert.deepEqual(columns.slice(0, 3), ["_id", "n", "name"]);
        assert.match(await page.locator("[data-testid=import-column] [data-testid=choice-field]").nth(1).innerText(), /Int32/);
        await page.locator("[data-testid=import-preview] tbody tr").nth(2).waitFor();
        await shot("import-schema");
        await id("import-start").click();
        assert.match(await progressText("import"), /^3$/);
        await id("import-close").click();
        await page.locator("[data-testid=collection-row]", { hasText: `${COLLECTION}_csv` }).waitFor();
        await page.locator("[data-testid=collection-row]", { hasText: `${COLLECTION}_json` }).waitFor();
        rmSync(folder, { recursive: true, force: true });
    });

    await step("collections selected together with Ctrl are exported and dropped at once", async () => {
        const row = suffix => page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}_${suffix}\\s*$`) });
        await row("csv").click();
        await row("json").click({ modifiers: ["Control"] });
        assert.equal(await page.locator("[data-testid=collection-row][aria-selected=true]").count(), 2);
        // The export wizard takes both.
        await row("json").click({ button: "right" });
        await page.locator("[data-testid=menu-item]", { hasText: "2 collections selected" }).waitFor();
        await chooseMenu("Export...");
        await page.locator("[data-testid=export-row]").nth(1).waitFor();
        assert.equal(await page.locator("[data-testid=export-row]").count(), 2);
        await id("export-close").click();
        // One question for both, then both are gone.
        await row("json").click({ button: "right" });
        await chooseMenu("Drop 2 collections");
        assert.match(await id("confirm-text").innerText(), new RegExp(`${COLLECTION}_csv, ${COLLECTION}_json`));
        await id("confirm-action").click();
        await row("csv").waitFor({ state: "detached" });
        await row("json").waitFor({ state: "detached" });
    });

    await step("a collection is copied with Ctrl+C and pasted under a new name", async () => {
        const row = page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) });
        await row.click();
        await page.keyboard.press("Control+c");
        await page.locator("[data-testid=database-row]", { hasText: DATABASE }).click({ button: "right" });
        await chooseMenu(`Paste collection ${COLLECTION}`);
        // Pasting is the export into a database: the wizard on its tile Database, the target chosen,
        // and in the same database a name of its own.
        await id("export-wizard").waitFor();
        assert.equal(await id("export-tile-database").getAttribute("aria-checked"), "true");
        assert.equal(await id("export-output").inputValue(), `${COLLECTION}_copy`);
        await id("export-next").click();
        await page.locator("[data-testid=export-progress-row][data-state=done]").waitFor();
        assert.equal((await id("export-progress-count").innerText()).replace(/\D/g, ""), "3");
        await id("export-close").click();
        await page.locator("[data-testid=collection-row]", { hasText: `${COLLECTION}_copy` }).waitFor();
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
        await page.locator("[data-testid=notice-title]", { hasText: "is marked read-only in the connection tree" }).first().waitFor();
        assert.equal(await page.locator("dialog[open]").count(), 0);
        // A problem's card stays until it is closed: closed here, so it lies over nothing later on.
        await dismissToasts();
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

    await step("folders group collections in the tree; renamed and deleted they keep the collections", async () => {
        const folder = `f${process.pid}`;
        await page.locator("[data-testid=database-row]", { hasText: DATABASE }).click({ button: "right" });
        await chooseMenu("Add folder");
        await id("prompt-input").fill(folder);
        await id("prompt-submit").click();
        const folderRow = page.locator("[data-testid=folder-row]", { hasText: folder });
        await folderRow.waitFor();
        assert.match(await folderRow.innerText(), /0\s*$/);

        const capped = page.locator("[data-testid=collection-row]", { hasText: `${COLLECTION}_capped` });
        await capped.click({ button: "right" });
        await chooseMenu(`Move to folder ${folder}`);
        await page.waitForFunction(name => [...document.querySelectorAll("[data-testid=folder-row]")].some(row => row.textContent.includes(name) && /1\s*$/.test(row.textContent)), folder);
        // Folded, the folder hides its collection; unfolded it shows it again.
        await folderRow.click();
        await capped.waitFor({ state: "detached" });
        await folderRow.click();
        await capped.waitFor();

        await folderRow.click({ button: "right" });
        await chooseMenu("Rename folder");
        await id("prompt-input").fill(`${folder}_old`);
        await id("prompt-submit").click();
        const renamed = page.locator("[data-testid=folder-row]", { hasText: `${folder}_old` });
        await renamed.waitFor();
        await capped.waitFor();
        await renamed.click({ button: "right" });
        await chooseMenu("Delete folder");
        await id("confirm-action").click();
        await renamed.waitFor({ state: "detached" });
        await capped.waitFor();
    });

    await step("folders lie in folders; a collection and a folder are dragged in and out", async () => {
        const outer = `o${process.pid}`;
        await page.locator("[data-testid=database-row]", { hasText: DATABASE }).click({ button: "right" });
        await chooseMenu("Add folder");
        await id("prompt-input").fill(outer);
        await id("prompt-submit").click();
        const outerRow = page.locator("[data-testid=folder-row]", { hasText: outer });
        await outerRow.click({ button: "right" });
        await chooseMenu("Add folder inside");
        await id("prompt-input").fill("inner");
        await id("prompt-submit").click();
        const innerRow = page.locator("[data-testid=folder-row]", { hasText: "inner" });
        await innerRow.waitFor();

        // Dragged with the mouse: pressed, moved past the threshold, let go on the folder.
        const drag = async (from, to) => {
            const a = await from.boundingBox();
            const b = await to.boundingBox();
            await page.mouse.move(a.x + 40, a.y + a.height / 2);
            await page.mouse.down();
            await page.mouse.move(a.x + 40, a.y + a.height / 2 + 10, { steps: 3 });
            await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 8 });
            await page.mouse.up();
        };
        const capped = page.locator("[data-testid=collection-row]", { hasText: `${COLLECTION}_capped` });
        await drag(capped, innerRow);
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=folder-row]")].some(row => row.textContent.includes("inner") && /1\s*$/.test(row.textContent)));
        // The outer folder counts what lies below it.
        assert.match(await outerRow.innerText(), /1\s*$/);
        // Out again: onto its database.
        await drag(capped, page.locator("[data-testid=database-row]", { hasText: DATABASE }));
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=folder-row]")].some(row => row.textContent.includes("inner") && /0\s*$/.test(row.textContent)));

        // The inner folder to the top, then the outer one deleted with all in it.
        await drag(innerRow, page.locator("[data-testid=database-row]", { hasText: DATABASE }));
        await page.waitForFunction(name => [...document.querySelectorAll("[data-testid=folder-row]")].filter(row => row.textContent.includes(name) || row.textContent.includes("inner")).every(row => row.style.paddingLeft.startsWith("calc(2.875rem")), outer);
        for (const row of [innerRow, outerRow]) {
            await row.click({ button: "right" });
            await chooseMenu("Delete folder");
            await id("confirm-action").click();
            await row.waitFor({ state: "detached" });
        }
        await capped.waitFor();
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
        // Both roles are kept; the server gives them back in an order of its own.
        const granted = async () => (await page.locator("[data-testid=role-name]:visible").evaluateAll(inputs => inputs.map(input => input.value))).sort();
        for (let attempt = 0; attempt < 50 && (await granted()).join() !== [role, "read"].sort().join(); attempt++) await page.waitForTimeout(100);
        assert.deepEqual(await granted(), [role, "read"].sort());

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
        await limitedItem.click();
        await id("connection-delete").click();
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

        // A stage after $group is offered the fields $group makes, not those of the collection.
        await rows.nth(1).locator(".cm-content").click();
        await visible("stage-add").click();
        await chooseMenu("$project");
        await rows.nth(2).locator(".cm-content").click();
        await page.keyboard.press("Control+A");
        await page.keyboard.type("{ d");
        // The sample of the stages before is read when the stage gets the focus.
        await page.waitForTimeout(500);
        await page.keyboard.press("Control+Space");
        await page.locator(".cm-tooltip-autocomplete", { hasText: "documents" }).waitFor();
        await page.keyboard.press("Escape");
        await visible("stage-remove").click();
        assert.equal(await rows.count(), 2);

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

    await step("the SQL builder turns SELECTs into find and aggregate, and points at mistakes", async () => {
        await page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) }).click({ button: "right" });
        await chooseMenu("Open SQL builder");
        await visible("sql-title").waitFor();
        const editor = page.locator("[data-testid=tab-panel]:visible [data-testid=code-editor]").first();
        const sqlRun = async (text) => {
            await write(editor, text);
            await panel.locator("[data-testid=query-run]").click();
            await page.waitForTimeout(150);
            await panel.locator("[data-testid=query-run]:not([disabled])").waitFor();
        };
        await sqlRun(`SELECT name, n FROM ${COLLECTION} WHERE n >= 2 ORDER BY n DESC`);
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=result-range]")].some(element => element.offsetParent && element.textContent.trim() === "1 – 2"));
        await shot("sql");
        assert.match(await visible("sql-statement").innerText(), /\.find\(\{ n: \{ \$gte: 2 \} \}, \{ name: 1, n: 1 \}\)\.sort\(\{ n: -1 \}\)/);

        await sqlRun(`SELECT count(*) AS total FROM ${COLLECTION}`);
        assert.match(await panel.locator("[data-testid=query-result]").innerText(), /total/);

        await sqlRun(`SELECT * ${COLLECTION}`);
        await panel.locator("[data-testid=query-error]").waitFor();
        assert.match(await panel.locator("[data-testid=query-error]").innerText(), /Expected FROM/);

        // Shift+Alt+F formats the text, here as SQL; the query still runs the same.
        await write(editor, `select name, n from ${COLLECTION} where n >= 2`);
        await page.keyboard.press("Shift+Alt+F");
        await page.waitForFunction(() => [...document.querySelectorAll(".cm-content")].some(element => element.offsetParent && /^SELECT\n/.test(element.innerText)));
        await panel.locator("[data-testid=query-run]").click();
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=result-range]")].some(element => element.offsetParent && element.textContent.trim() === "1 – 2"));
        await page.keyboard.press("Control+w");
        await visible("browse-title").waitFor();
    });

    await step("filter and sort narrow and order the result", async () => {
        const rows = panel.locator("[data-testid=pipeline-stage]");
        await write(rows.nth(0), "{ n: { $gte: 2 } }");
        await write(rows.nth(1), "{ n: -1 }");
        await panel.locator("[data-testid=query-run]").click();
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=result-range]")].some(element => element.offsetParent && element.textContent.trim() === "1 – 2"));
        // The same stages as the aggregation: $sort moved in front runs as a pipeline, alike here.
        await rows.nth(1).locator(".cm-content").click();
        await panel.locator("[data-testid=stage-up]").click();
        assert.equal(await rows.nth(0).locator("[data-testid=stage-operator]").innerText(), "$sort");
        await panel.locator("[data-testid=query-run]").click();
        await panel.locator("[data-testid=query-run]:not([disabled])").waitFor();
        assert.equal(await panel.locator("[data-testid=query-error]").count(), 0);
        assert.equal((await panel.locator("[data-testid=result-range]").innerText()).trim(), "1 – 2");
        await panel.locator("[data-testid=stage-down]").click();
        assert.equal(await rows.nth(0).locator("[data-testid=stage-operator]").innerText(), "$match");
        await panel.locator("[data-testid=query-run]").click();
        await panel.locator("[data-testid=query-run]:not([disabled])").waitFor();
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

    await step("the bulb shows the plan of the query as a flow; a stage shows its details", async () => {
        await panel.locator("[data-testid=result-explain]").click();
        await panel.locator("[data-testid=plan-node]").first().waitFor();
        // Source, at least one stage, result; the numbers above.
        assert.ok(await panel.locator("[data-testid=plan-node]").count() >= 3);
        assert.match(await panel.locator("[data-testid=plan-returned]").innerText(), /2/);
        await panel.locator("[data-testid=plan-node]").nth(1).click();
        await panel.locator("[data-testid=plan-view] .cm-content").first().waitFor();
        assert.match(await panel.locator("[data-testid=plan-view] .cm-content").first().innerText(), /stage/);
        await panel.locator("[data-testid=view-tree]").click();
        await panel.locator("[data-testid=tree-row]").first().waitFor();
    });

    await step("table and JSON views show the same documents", async () => {
        await panel.locator("[data-testid=view-table]").click();
        assert.equal(await panel.locator("[data-testid=table-row]").count(), 2);
        assert.match(await panel.locator("[data-testid=result-table] thead").innerText(), /name/);
        // Dragging the edge of a column head widens the column; a double click gives the width back.
        const head = panel.locator("[data-testid=table-column]").first();
        const before = (await head.boundingBox()).width;
        const handle = (await head.locator("[data-testid=column-resize]").boundingBox());
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await page.mouse.down();
        await page.mouse.move(handle.x + 80, handle.y + handle.height / 2, { steps: 4 });
        await page.mouse.up();
        assert.ok((await head.boundingBox()).width > before + 60, "the column did not widen");
        await head.locator("[data-testid=column-resize]").dblclick();
        assert.ok(Math.abs((await head.boundingBox()).width - before) < 2, "the width did not come back");
        await panel.locator("[data-testid=view-json]").click();
        assert.match(await panel.locator("[data-testid=query-result] .cm-content").innerText(), /"name": "three"/);
        await panel.locator("[data-testid=view-tree]").click();
    });

    await step("the table steps into an array and back", async () => {
        const rows = panel.locator("[data-testid=pipeline-stage]");
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
        // The same by keys: Ctrl+Enter steps into the chosen cell, Backspace back; Ctrl+K hides its column.
        await panel.locator("[data-testid=table-cell]", { hasText: "[2 elements]" }).click();
        await page.keyboard.press("Control+Enter");
        await panel.locator("[data-testid=table-column]", { hasText: "0 - tags.0" }).waitFor();
        await page.keyboard.press("Backspace");
        await panel.locator("[data-testid=table-column]", { hasText: "tags" }).first().waitFor();
        const columns = await panel.locator("[data-testid=table-column]").count();
        await panel.locator("[data-testid=table-cell]", { hasText: "[2 elements]" }).click();
        await page.keyboard.press("Control+k");
        await page.waitForFunction(count => document.querySelectorAll("[data-testid=tab-panel]:not([style*='none']) [data-testid=table-column]").length === count - 1, columns);
        await page.keyboard.press("Control+Shift+k");
        await page.waitForFunction(count => document.querySelectorAll("[data-testid=tab-panel]:not([style*='none']) [data-testid=table-column]").length === count, columns);
        await panel.locator("[data-testid=view-tree]").click();
        await write(rows.nth(0), "{ n: { $gte: 2 } }");
        await panel.locator("[data-testid=query-run]").click();
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=result-range]")].some(element => element.offsetParent && element.textContent.trim() === "1 – 2"));
    });

    await step("a value is changed in place in the tree", async () => {
        const value = panel.locator("[data-testid=tree-row]", { hasText: /^\s*1\s*name/ }).locator("[data-testid=tree-value]");
        await value.dblclick();
        // The values of the field are offered at once (stage 24), as in a filter.
        const list = page.locator(".cm-tooltip-autocomplete:visible");
        await list.locator("li", { hasText: "two" }).waitFor();
        // Below the values, not among them: the search of all data, with what it found.
        const footer = page.locator("[data-testid=search-footer]:visible");
        await footer.filter({ hasText: "sample and page" }).waitFor();
        await footer.locator("[data-testid=search-all]").click();
        await footer.filter({ hasText: /\d+ found/ }).waitFor();
        assert.equal(await list.locator("li", { hasText: "Search all data" }).count(), 0);
        await panel.locator("[data-testid=tree-edit]").fill("THREE");
        // "THREE" fits "three" of the list: Esc closes the list, Enter then writes what is typed.
        await page.waitForTimeout(300);
        if (await list.count() > 0) await page.keyboard.press("Escape");
        await page.keyboard.press("Enter");
        await panel.locator("[data-testid=tree-value]", { hasText: "THREE" }).first().waitFor();
    });

    await step("a cell is changed in place in the table", async () => {
        await panel.locator("[data-testid=view-table]").click();
        await panel.locator("[data-testid=table-cell]", { hasText: "two" }).dblclick();
        // Typing narrows the values; Enter takes one (with its type), Esc leaves without writing.
        const list = page.locator(".cm-tooltip-autocomplete:visible");
        await list.locator("li", { hasText: "one" }).waitFor();
        await page.keyboard.type("on");
        await page.waitForFunction(() => [...document.querySelectorAll(".cm-tooltip-autocomplete li")].map(item => item.textContent).join("|").match(/^one/));
        // The list takes no Enter for a moment after it changed (CodeMirror's interactionDelay).
        await page.waitForTimeout(150);
        await page.keyboard.press("Enter");
        assert.equal(await panel.locator("[data-testid=table-edit]").innerText(), "one");
        await page.keyboard.press("Escape");
        await panel.locator("[data-testid=table-edit]").waitFor({ state: "detached" });
        await panel.locator("[data-testid=table-cell]", { hasText: "two" }).dblclick();
        await panel.locator("[data-testid=table-edit]").fill("TWO");
        await page.waitForTimeout(300);
        if (await list.count() > 0) await page.keyboard.press("Escape");
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
        await page.locator("[data-testid=status-message]", { hasText: /matches 2 documents/ }).waitFor();
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
        await openGroup("Documents");
        await shot("submenu");
        await chooseMenu("Import from clipboard");
        await page.locator("dialog[open]", { hasText: "Insert 2 documents" }).waitFor();
        await id("confirm-action").click();
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=result-range]")].some(element => element.offsetParent && element.textContent.trim() === "1 – 3"));
        await panel.locator("[data-testid=tree-row]").first().click({ button: "right" });
        await openGroup("Documents");
        await chooseMenu("Refresh document");
        await page.waitForTimeout(300);
        assert.equal(await panel.locator("[data-testid=query-error]").count(), 0);
        assert.equal(await panel.locator("[data-testid=tree-row]").count() >= 3, true);

        // The two documents from the clipboard (first, sorted by n), marked with Ctrl, go together.
        const clips = panel.locator("[data-testid=tree-row][data-root]");
        await clips.nth(0).click();
        await clips.nth(1).click({ modifiers: ["Control"] });
        await clips.nth(1).click({ button: "right" });
        await openGroup("Documents");
        await chooseMenu("Remove document");
        await page.locator("dialog[open]", { hasText: "Remove 2 documents?" }).waitFor();
        await id("confirm-action").click();
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=result-range]")].some(element => element.offsetParent && element.textContent.trim() === "1 – 1"));
    });

    await step("notices: an answer in the status bar, cards that close, the session's list behind the bell", async () => {
        // An answer to a click: only in the status bar, no card.
        await panel.locator("[data-testid=result-count]").click();
        await page.locator("[data-testid=status-message]", { hasText: /matches 1 document/ }).waitFor();
        // A problem: a card with "Copy" that stays longer than a success. The clipboard holds no document.
        await page.evaluate(() => navigator.clipboard.writeText("not a document"));
        await page.keyboard.press("Control+Shift+V");
        const error = page.locator("[data-testid=notice][data-kind=error]").first();
        await error.waitFor();
        await error.locator("[data-testid=notice-action]", { hasText: "Copy" }).waitFor();
        await page.waitForTimeout(4500);
        assert.equal(await error.isVisible(), true, "an error went away as fast as a success");
        // With a dialog open the stack stays in its corner, over the dialog's backdrop.
        await page.keyboard.press("Control+Alt+P");
        await visible("settings").waitFor();
        // The card lies over the dialog's backdrop, not under it.
        await page.waitForFunction(() => {
            const card = document.querySelector("[data-testid=notice][data-kind=error]");
            if (!card) return false;
            const box = card.getBoundingClientRect();
            return card.contains(document.elementFromPoint(box.left + box.width / 2, box.top + 12));
        });
        await shot("notice-over-dialog");
        await visible("settings-close").click();
        // Behind the bell: the session's notices, the error among them; opening reads them and
        // takes the cards into the list, the error with its "Copy".
        assert.match(await id("notice-count").innerText(), /^\d+$/);
        await id("notice-bell").click();
        await error.waitFor({ state: "hidden" });
        const entries = page.locator("[data-testid=notice-entry]:visible");
        assert.ok(await entries.count() >= 2);
        await entries.locator("[data-testid=notice-entry-action]", { hasText: "Copy" }).first().waitFor();
        await entries.filter({ hasText: /matches 1 document/ }).first().waitFor();
        await shot("notice-center");
        await visible("notice-clear").click();
        assert.equal(await entries.count(), 0);
        await page.keyboard.press("Escape");
        assert.equal(await id("notice-count").count(), 0);
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
        // The row is the tree's last: the toasts at the bottom left may lie over it.
        await dismissToasts();
        await row.click({ button: "right" });
        assert.equal(await page.locator("[data-testid=menu-item]:visible", { hasText: "Open connection settings" }).count(), 0);
        await chooseMenu("Disconnect");
        await page.waitForFunction(() => document.querySelectorAll("[data-testid=connection-row]").length === 1);
        assert.equal(await id("recent-connection").count(), recent);
    });

    await step("the settings give new tabs their page size and view", async () => {
        const setting = (field, label) => choose(page.locator("dialog[open] [data-testid=choice-field]").nth(field), label);
        await page.keyboard.press("Control+Alt+P");
        await visible("settings").waitFor();
        await setting(2, "50");
        await setting(3, "Table view");
        await visible("settings-close").click();
        try {
            // A tab already open on the collection would come to the front: the settings are for new ones.
            const openTabs = page.locator("[data-testid=tab]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) });
            while (await openTabs.count() > 0) {
                await openTabs.first().click();
                await page.keyboard.press("Control+w");
                await page.waitForTimeout(100);
            }
            await page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) }).dblclick();
            await panel.locator("[data-testid=table-row]").first().waitFor();
            assert.equal((await panel.locator("[data-testid=page-size]").innerText()).trim(), "50");
            await page.keyboard.press("Control+w");
        } finally {
            // Back to the defaults, also when the step fails: later runs, and the app's own data, start as before.
            await page.keyboard.press("Escape");
            await page.keyboard.press("Control+Alt+P");
            await setting(2, "20");
            await setting(3, "Tree view");
            await visible("settings-close").click();
        }
    });

    await step("a query is saved with Ctrl+D, marked with a star and offered in the history", async () => {
        const name = `e2e saved ${process.pid}`;
        await page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) }).dblclick();
        const panel = page.locator("[data-testid=tab-panel]:visible");
        await panel.locator("[data-testid=result-range]").waitFor();
        await page.keyboard.press("Control+d");
        await id("save-query-name").fill(name);
        await id("save-query-submit").click();
        await panel.locator("[data-testid=save-query-star][aria-pressed=true]").waitFor();
        await panel.locator("[data-testid=history]").click();
        await page.locator("[data-testid=menu-item]:visible", { hasText: name }).waitFor();
        await page.keyboard.press("Escape");
        // Kept when the tabs do not change for a moment: the next step loads the page anew.
        await page.waitForTimeout(2500);
    });

    await step("the command palette finds a collection and a command and runs them", async () => {
        await page.keyboard.press("Control+Shift+P");
        await id("palette-input").fill(`@${COLLECTION}`);
        await page.locator("[data-testid=palette-option]", { hasText: COLLECTION }).first().waitFor();
        await page.keyboard.press("Enter");
        await id("palette").waitFor({ state: "hidden" });
        await page.locator("[data-testid=tab][data-selected]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) }).waitFor();

        // `>` narrows to commands: the settings open from the palette.
        await page.keyboard.press("Control+Shift+P");
        await id("palette-input").fill(">settings");
        await page.keyboard.press("Enter");
        await visible("settings").waitFor();
        await visible("settings-close").click();
    });

    await step("the schema analysis shows a card per field; a bar opens the documents with that value", async () => {
        await page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) }).click({ button: "right" });
        await chooseMenu("Analyse schema");
        const schemaPanel = page.locator("[data-testid=schema-panel]:visible");
        const card = schemaPanel.locator("[data-testid=schema-card]", { has: page.locator("[data-testid=schema-field]", { hasText: /^n$/ }) });
        await card.waitFor();
        assert.match(await schemaPanel.locator("[data-testid=schema-overview]").innerText(), /of \d+ documents/);
        // Each value of `n` is in one document: its bar filters to that one.
        await card.locator("[data-testid=schema-bar]").first().click();
        assert.match((await schemaPanel.locator("[data-testid=schema-filter]").innerText()).trim(), /^\{ n: \d+ \}$/);
        await schemaPanel.locator("[data-testid=schema-open]").click();
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=result-range]")].some(element => element.offsetParent && element.textContent.trim() === "1 – 1"));
        await page.keyboard.press("Control+w");
    });

    await step("a shortcut changed in the settings acts, shows on the buttons, outlasts a reload and is reset", async () => {
        const browseRow = page.locator("dialog[open] [data-command='tab.browse']");
        const startup = page.locator("dialog[open] [data-testid=settings-startup]");
        const startupText = async () => {
            const input = startup.locator("input[role=combobox]").or(startup.and(page.locator("input[role=combobox]")));
            return (await input.count()) > 0 ? input.inputValue() : (await startup.innerText()).trim();
        };
        await page.keyboard.press("Control+Alt+P");
        // The card at the start is asked for below; the setting as it was comes back at the end.
        const startupBefore = await startupText();
        await choose(startup, "Ask to restore the last session");
        await visible("settings-tab-keys").click();
        await browseRow.locator("[data-testid=keys-chip]").click();
        await browseRow.locator("[data-testid=keys-recorder]").waitFor();
        await page.keyboard.press("Control+B");
        await browseRow.getByText("Ctrl + B").waitFor();
        await visible("settings-close").click();
        assert.match(await id("dock-browse").getAttribute("title"), /\(Ctrl \+ B\)$/);

        // The new key opens the collection; the old one is free. A tab open on it would only come to the front.
        const openTabs = page.locator("[data-testid=tab]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) });
        while (await openTabs.count() > 0) {
            await openTabs.first().click();
            await page.keyboard.press("Control+w");
            await page.waitForTimeout(100);
        }
        await page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) }).click();
        const tabs = await id("tab").count();
        await page.keyboard.press("Control+Q");
        await page.waitForTimeout(300);
        assert.equal(await id("tab").count(), tabs);
        await page.keyboard.press("Control+B");
        await page.waitForFunction(count => document.querySelectorAll("[data-testid=tab]").length === count + 1, tabs);
        await page.keyboard.press("Control+w");

        // Kept in the app's database: still there after the page is loaded anew. The tabs are kept
        // when they do not change for a moment.
        const before = await id("tab").count();
        await page.waitForTimeout(2500);
        await page.reload();
        await id("dock-browse").waitFor();
        assert.match(await id("dock-browse").getAttribute("title"), /\(Ctrl \+ B\)$/);
        // The card at the start brings the tabs of before back, without running them (stage 20);
        // their connection opens in the tree behind them.
        await page.locator("[data-testid=notice-action]:visible", { hasText: "Restore" }).click();
        await page.waitForFunction(count => document.querySelectorAll("[data-testid=tab]").length === count, before);
        await page.locator("[data-testid=connection-row]", { hasText: NAME }).waitFor();
        await id("database-row").first().waitFor();

        await page.keyboard.press("Control+Alt+P");
        await visible("settings-tab-keys").click();
        await visible("keys-reset-all").click();
        await id("confirm-action").click();
        await browseRow.getByText("Ctrl + Q").waitFor();
        await visible("settings-tab-general").click();
        if (startupBefore && (await startupText()) !== startupBefore) await choose(startup, startupBefore);
        await visible("settings-close").click();
        assert.match(await id("dock-browse").getAttribute("title"), /\(Ctrl \+ Q\)$/);
        // The restore opened the connection again; the next steps work on it. The start page is the
        // first tab; a restored one lies in front of it.
        await id("tab").first().click();
        await page.locator("[data-testid=recent-connection]", { hasText: NAME }).click();
        await id("database-row").first().waitFor();
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
        // This run's connection, and any an earlier run left behind when it broke off ("E2E <time>").
        const items = page.locator("[data-testid=connection-item]:visible", { hasText: /E2E \d{10,}/ });
        for (let round = 0; round < 20; round++) {
            if (await items.count() === 0) await id("connection-list").click();
            await page.waitForTimeout(200);
            if (await items.count() === 0) break;
            const name = (await items.first().innerText()).match(/E2E \d+/)[0];
            await items.first().click();
            await id("connection-delete").click();
            await id("confirm-action").click();
            await page.locator("[data-testid=recent-connection]", { hasText: name }).waitFor({ state: "detached" });
        }
        await page.keyboard.press("Escape");
    }).catch(() => undefined);

    console.log(steps.join("\n"));
    if (failures.length > 0) console.log(`\nErrors in the page:\n${failures.join("\n")}`);
    await browser.close();
}
if (failures.length > 0) process.exit(1);
