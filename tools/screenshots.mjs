// Takes the screenshots in docs/screenshots from the browser preview with its made-up data
// (`bun run dev` must be running). Needs Microsoft Edge; `node tools/screenshots.mjs [name]` takes one.
import { chromium } from "playwright-core";

const out = new URL("../docs/screenshots/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const only = process.argv[2];
// Vite listens on the IPv6 loopback only.
const base = process.env.QUERYMASTER_PREVIEW ?? "http://[::1]:1420/";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(8000);

async function menu(top, item) {
    await page.locator(`[data-testid="menu-${top}"]`).click();
    await page.locator("[data-testid=\"menu-item\"]:visible", { hasText: item }).first().click();
    await page.waitForTimeout(300);
}

/** Opens the preview in English and the given theme; the preview forgets both on every load. */
async function open(query, theme = "One Dark") {
    await page.goto(base + query);
    await page.waitForTimeout(2200);
    await menu("Ansicht", "Sprache: English");
    await page.waitForTimeout(400);
    await menu("View", `Theme: ${theme}`);
    await page.mouse.move(5, 795);
}

async function stages() {
    const editors = page.locator("[data-testid=\"pipeline-stage\"] .cm-content");
    const texts = ["{ status: \"open\", total: { $gt: 10 } }", "{ createdAt: -1 }", "{ number: 1, status: 1, total: 1, customer: 1 }"];
    for (const [index, text] of texts.entries()) {
        await editors.nth(index).click();
        await page.keyboard.press("Control+A");
        await page.keyboard.insertText(text);
    }
    await page.mouse.click(1000, 300);
}

async function run() {
    await page.locator("[data-testid=\"query-run\"]").click();
    await page.waitForTimeout(1200);
}

async function shellLine(text) {
    await page.locator("[data-testid=\"code-editor\"] .cm-content:visible").first().click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(text, { delay: 10 });
    await page.waitForTimeout(400);
    await page.keyboard.press("Control+Space");
    await page.waitForTimeout(1200);
}

const shots = {
    async tree() {
        await open("?demo");
        await stages();
        await run();
    },
    async light() {
        await open("?demo", "One Light");
        await stages();
        await run();
    },
    table: () => open("?demo&table"),
    mirage: () => open("?demo&table", "Ayu Mirage"),
    async plan() {
        await open("?demo");
        await page.locator("[data-testid=\"view-plan\"]").click();
        await page.waitForTimeout(1200);
    },
    async values() {
        await open("?demo&shell");
        await shellLine("db.getCollection(\"orders\").find({ status: \"");
    },
    async palette() {
        await open("?demo");
        await page.keyboard.press("Control+Shift+P");
        await page.waitForTimeout(500);
        await page.keyboard.type("ord");
    },
    async connection() {
        await open("?demo");
        await page.keyboard.press("Control+F2");
        await page.waitForTimeout(800);
    }
};

for (const [name, prepare] of Object.entries(shots)) {
    if (only && only !== name) continue;
    try {
        await prepare();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${out}${name}.png` });
        console.log(`ok    ${name}`);
    } catch (error) {
        console.log(`FAIL  ${name}: ${String(error.message).split("\n")[0]}`);
    }
}
await browser.close();
