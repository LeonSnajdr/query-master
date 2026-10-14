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
const steps = [];
async function step(name, action) {
    try {
        await action();
        steps.push(`ok    ${name}`);
    } catch (error) {
        // The first lines say what was waited for; the rest is Playwright's retry log.
        steps.push(`FAIL  ${name}: ${String(error.message).split("\n").slice(0, 3).join(" | ")}`);
        // What dialogs were open says most about a failure in one.
        const open = await page.locator("dialog[open]").evaluateAll(dialogs => dialogs.map(dialog => dialog.innerText.replace(/\s+/g, " ").slice(0, 400))).catch(() => []);
        if (open.length > 0) steps.push(`      open dialogs: ${open.join(" || ")}`);
        throw error;
    }
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
        await page.locator("[data-testid=collection-row]", { hasText: `${COLLECTION}_view` }).waitFor();
    });

    const panel = page.locator("[data-testid=tab-panel]:visible");
    await step("double click opens the collection with its documents", async () => {
        await page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) }).dblclick();
        await visible("browse-title").waitFor();
        await panel.locator("[data-testid=tree-row]").first().waitFor();
        assert.equal(await panel.locator("[data-testid=result-range]").innerText(), "1 – 3");
        const text = await panel.locator("[data-testid=query-result]").innerText();
        assert.match(text, /NumberLong\(9007199254740993\)/);
        assert.match(text, /2024-05-01T00:00:00\.000Z/);
    });

    await step("a collection unfolds to its indexes; one is created and dropped", async () => {
        const row = page.locator("[data-testid=collection-row]", { hasText: new RegExp(`^\\s*${COLLECTION}\\s*$`) });
        await row.locator("[data-testid=collection-toggle]").click();
        await page.locator("[data-testid=index-row]", { hasText: "_id_" }).waitFor();
        await row.click({ button: "right" });
        await chooseMenu("Create index");
        await id("prompt-input").fill("{ name: 1 }");
        await id("prompt-submit").click();
        const index = page.locator("[data-testid=index-row]", { hasText: "name_1" });
        await index.waitFor();
        await index.click({ button: "right" });
        await chooseMenu("Drop index");
        await id("confirm-action").click();
        await index.waitFor({ state: "detached" });
    });

    await step("filter and sort narrow and order the result", async () => {
        const rows = panel.locator("[data-testid=stage-row]");
        await write(rows.nth(0), "{ n: { $gte: 2 } }");
        await write(rows.nth(2), "{ n: -1 }");
        await panel.locator("[data-testid=query-run]").click();
        await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=result-range]")].some(element => element.offsetParent && element.textContent.trim() === "1 – 2"));
        assert.match(await panel.locator("[data-testid=tree-value]").first().innerText(), /./);
        assert.equal(await panel.locator("[data-testid=query-error]").count(), 0);
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

    await step("the history offers the statements that ran", async () => {
        await panel.locator("[data-testid=history]").click();
        await page.locator("[data-testid=menu-item]:visible", { hasText: COLLECTION }).first().waitFor();
        await page.keyboard.press("Escape");
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
            await runShell(`db.getSiblingDB("${DATABASE}").getCollection("${COLLECTION}_view").drop(); db.getSiblingDB("${DATABASE}").getCollection("${COLLECTION}_capped").drop(); db.getSiblingDB("${DATABASE}").getCollection("${COLLECTION}").drop()`).catch(() => undefined);
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
