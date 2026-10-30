<script setup lang="ts">
/** A tile with a part of a screenshot: `zoom` is its width, `shift` the margin that brings the part into view. */
interface ShotTile {
    title: string;
    text: string;
    shot: string;
    alt: string;
    zoom: string;
    shift: string;
    span: 3 | 4;
}

const SHOTS: ShotTile[] = [
    { title: "Explain, as a picture", text: "Stages, time and documents per step – plus a hint where an index helps.", shot: "plan.png", alt: "Explain plan with COLLSCAN and SORT", zoom: "190%", shift: "-50% 0 0 -48%", span: 3 },
    { title: "Command palette", text: "Collections, saved queries, commands and connections. All in one box.", shot: "palette.png", alt: "Command palette searching for ord", zoom: "170%", shift: "-4% 0 0 -42%", span: 3 },
    { title: "Tree, table or JSON", text: "Edit values in place, filter by a value with one click, export to JSON, CSV or SQL.", shot: "table.png", alt: "Results as a table", zoom: "140%", shift: "-22% 0 0 -32%", span: 4 }
];

const KEYS = [
    { keys: ["Ctrl", "Shift", "P"], does: "palette" },
    { keys: ["Ctrl", "Space"], does: "suggest" },
    { keys: ["Ctrl", "Enter"], does: "run" },
    { keys: ["Shift", "Alt", "F"], does: "format" }
];

const BUILDERS = ["$match", "$group", "$lookup", "$sort", "$project", "SELECT … WHERE", "GROUP BY"];
const REST = ["schema analysis", "JS scripts", "saved queries", "import / export", "users & roles", "server log", "GridFS"];
</script>

<template>
    <section>
        <div class="eyebrow">
            // Features
        </div>
        <h2>Everything you reach for, one keystroke away.</h2>
        <p class="lead">
            From the first find() to an index that finally makes it fast.
        </p>
        <div class="grid">
            <div
                v-for="tile in SHOTS"
                :key="tile.shot"
                :class="`span-${tile.span}`"
                class="tile"
            >
                <div class="text">
                    <h3>{{ tile.title }}</h3>
                    <p>{{ tile.text }}</p>
                </div>
                <div class="shot">
                    <img
                        :alt="tile.alt"
                        :src="`./screenshots/${tile.shot}`"
                        :style="{ width: tile.zoom, margin: tile.shift }"
                        loading="lazy"
                    />
                </div>
            </div>
            <div class="tile span-2">
                <div class="text">
                    <h3>Your shortcuts</h3>
                    <p>Rebind everything, with a conflict check.</p>
                </div>
                <div class="keys">
                    <div
                        v-for="shortcut in KEYS"
                        :key="shortcut.does"
                    >
                        <template
                            v-for="key in shortcut.keys"
                            :key="key"
                        >
                            <span class="kbd">{{ key }}</span>{{ " " }}
                        </template><small>{{ shortcut.does }}</small>
                    </div>
                </div>
            </div>
            <div class="tile span-2">
                <div class="text">
                    <h3>Safe on production</h3>
                    <p>A red status bar, and a question before anything is deleted.</p>
                </div>
                <div class="production">
                    <div class="query">
                        db.orders.deleteMany({ status: "cancelled" })
                    </div>
                    <div class="ask">
                        Delete <b>12 documents</b> in <b>orders</b> on <b>Production</b>? Type the collection name to confirm.
                    </div>
                    <div class="status">
                        <span>Production – MongoDB 7.0</span><span>●</span>
                    </div>
                </div>
            </div>
            <div class="tile span-2">
                <div class="text">
                    <h3>Builders</h3>
                    <p>Aggregation and SQL, with stages you drag into order.</p>
                </div>
                <div class="chips">
                    <span
                        v-for="chip in BUILDERS"
                        :key="chip"
                    >{{ chip }}</span>
                </div>
            </div>
            <div class="tile span-2">
                <div class="text">
                    <h3>And the rest</h3>
                    <p>Everything a daily driver needs.</p>
                </div>
                <div class="chips">
                    <span
                        v-for="chip in REST"
                        :key="chip"
                    >{{ chip }}</span>
                </div>
            </div>
        </div>
    </section>
</template>

<style scoped>
.grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 16px;
}

.tile {
    position: relative;
    overflow: hidden;
    background: linear-gradient(180deg, var(--panel-raised), var(--panel));
    border: 1px solid var(--line);
    border-radius: 18px;
    transition: border-color 0.2s;
}

.tile:hover {
    border-color: #2c3346;
}

.span-2 {
    grid-column: span 2;
}

.span-3 {
    grid-column: span 3;
}

.span-4 {
    grid-column: span 4;
}

.text {
    padding: 22px 24px 0;
}

h3 {
    font-size: 17px;
    margin-bottom: 6px;
}

p {
    color: var(--muted);
    font-size: 14px;
    line-height: 1.55;
}

.shot {
    margin: 18px 0 0 24px;
    border-radius: 10px 0 0;
    border: 1px solid var(--line-strong);
    overflow: hidden;
    height: 230px;
}

.shot img {
    max-width: none;
    height: auto;
}

.keys {
    padding: 24px;
    display: grid;
    gap: 12px;
}

.keys small {
    color: #6b7285;
    margin-left: 6px;
}

.production {
    margin: 22px 24px 24px;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    overflow: hidden;
    font-size: 12px;
}

.query {
    padding: 14px;
    font-family: var(--mono);
    color: #b9bfcc;
}

.ask {
    margin: 0 14px 14px;
    padding: 12px;
    border-radius: 8px;
    background: #1a1d24;
    border: 1px solid #3a2a2f;
    color: #e8b4b9;
    line-height: 1.5;
}

.ask b {
    color: #fff;
}

.status {
    background: #a8323e;
    color: #fff;
    padding: 6px 12px;
    display: flex;
    justify-content: space-between;
    font-style: italic;
}

.chips {
    padding: 22px 24px 24px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.chips span {
    font-family: var(--mono);
    font-size: 12px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    padding: 5px 11px;
    color: #b9bfcc;
    background: #10131a;
}

@media (max-width: 900px) {
    .span-2,
    .span-3,
    .span-4 {
        grid-column: span 6;
    }
}
</style>
