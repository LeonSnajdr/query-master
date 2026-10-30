<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from "vue";

/** A piece of code and its highlight class (as One Dark colours it in the app). */
type Token = [text: string, kind: "" | "fn" | "str" | "prop"];

const FIRST: Token[] = [["db", ""], [".", ""], ["getCollection", "fn"], ["(", ""], ["\"orders\"", "str"], [")", ""]];
const SECOND: Token[] = [["  .", ""], ["find", "fn"], ["({ ", ""], ["status", "prop"], [": ", ""], ["\"", "str"]];
const PICKED: Token[] = [...SECOND.slice(0, -1), ["\"open\"", "str"], [" })", ""]];
/** The values of `status` in the demo data, with how often they occur, as the app suggests them. */
const VALUES = [["open", 13], ["paid", 13], ["shipped", 12], ["cancelled", 12]] as const;

const POINTS = [
    "Values from a sample and the page you see",
    "Ctrl+Space again searches all data",
    "Allowed values of a validator come first",
    "Every stage and operator with the version that brought it"
];

const lines = shallowRef<Token[][]>([]);
const caret = shallowRef(true);
/** Which value is selected while the suggestions are open. */
const selected = shallowRef<number>();
const popup = shallowRef({ left: 0, top: 0 });
const result = shallowRef("");

const editor = useTemplateRef("editor");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let timers: number[] = [];

function later(run: () => void, at: number): void {
    timers.push(window.setTimeout(run, at));
}

function stop(): void {
    timers.forEach(window.clearTimeout);
    timers = [];
}

/** The tokens of `line` cut after `count` characters. */
function typed(line: Token[], count: number): Token[] {
    const out: Token[] = [];
    let left = count;
    for (const [text, kind] of line) {
        if (left <= 0) break;
        out.push([text.slice(0, left), kind]);
        left -= text.length;
    }
    return out;
}

const length = (line: Token[]) => line.reduce((sum, [text]) => sum + text.length, 0);

/** The suggestions open below the caret, as in the app. */
async function openAt(index: number): Promise<void> {
    selected.value = index;
    await nextTick();
    const box = editor.value?.getBoundingClientRect();
    const mark = editor.value?.querySelector(".caret")?.getBoundingClientRect();
    if (!box || !mark) return;
    popup.value = { left: Math.max(12, Math.min(mark.left - box.left, box.width - 282)), top: mark.bottom - box.top + 6 };
}

function play(): void {
    stop();
    selected.value = undefined;
    result.value = "";
    caret.value = true;
    if (reduced) {
        lines.value = [FIRST, PICKED];
        caret.value = false;
        result.value = "13 documents · 4 ms";
        return;
    }
    let at = 0;
    for (let count = 1; count <= length(FIRST); count++) later(() => lines.value = [typed(FIRST, count)], at += 38);
    for (let count = 1; count <= length(SECOND); count++) later(() => lines.value = [FIRST, typed(SECOND, count)], at += 38);
    later(() => void openAt(0), at += 450);
    later(() => void openAt(1), at += 650);
    later(() => void openAt(0), at += 450);
    later(() => {
        selected.value = undefined;
        lines.value = [FIRST, PICKED];
    }, at += 600);
    later(() => result.value = "13 documents · 4 ms", at += 700);
    later(play, at += 3500);
}

// Plays while the editor is in view.
let observer: IntersectionObserver | undefined;
onMounted(() => {
    observer = new IntersectionObserver(([entry]) => entry?.isIntersecting ? play() : stop(), { threshold: 0.4 });
    if (editor.value) observer.observe(editor.value);
});
onBeforeUnmount(() => {
    observer?.disconnect();
    stop();
});
</script>

<template>
    <section id="features">
        <div class="spot">
            <div>
                <div class="eyebrow">
                    // Suggestions
                </div>
                <h2>It knows what's in your collections.</h2>
                <p class="lead">
                    Other editors complete method names. QueryMaster also completes your data: the values of a field, how often they occur, and the operators your server version supports.
                </p>
                <ul>
                    <li
                        v-for="(point, index) in POINTS"
                        :key="point"
                    >
                        <span>{{ String(index + 1).padStart(2, "0") }}</span>{{ point }}
                    </li>
                </ul>
            </div>
            <div
                ref="editor"
                aria-label="A query is typed and QueryMaster suggests the values of status"
                class="editor"
                role="img"
            >
                <div class="bar">
                    <i /><i /><i /><span>shop @ localhost — shell</span><b>Ctrl+Enter</b>
                </div>
                <div class="code">
                    <div
                        v-for="(line, row) in lines"
                        :key="row"
                    >
                        <span class="number">{{ row + 1 }}</span><span
                            v-for="([text, kind], index) in line"
                            :key="index"
                            :class="kind"
                        >{{ text }}</span><span
                            v-if="caret && row === lines.length - 1"
                            class="caret"
                        />
                    </div>
                </div>
                <div
                    :class="{ show: selected !== undefined }"
                    :style="{ left: `${popup.left}px`, top: `${popup.top}px` }"
                    class="popup"
                >
                    <div
                        v-for="([value, count], index) in VALUES"
                        :key="value"
                        :class="{ selected: index === selected }"
                        class="item"
                    >
                        <em>c</em>{{ value }}<small>{{ count }}×</small>
                    </div>
                    <div class="foot">
                        ⌕ Search all data <span>Ctrl+Space</span>
                    </div>
                </div>
                <div class="out">
                    <b v-if="result">{{ result }}</b>
                </div>
            </div>
        </div>
    </section>
</template>

<style scoped>
.spot {
    display: grid;
    grid-template-columns: 1fr 1.15fr;
    gap: 56px;
    align-items: center;
}

ul {
    list-style: none;
    margin-top: 8px;
}

li {
    padding: 10px 0;
    border-top: 1px solid var(--line);
    color: #b9bfcc;
    font-size: 15px;
    display: flex;
    gap: 12px;
    align-items: baseline;
}

li span {
    color: var(--blue);
    font-family: var(--mono);
    font-size: 12px;
    min-width: 22px;
}

.editor {
    position: relative;
    background: #1a1d24;
    border: 1px solid #2b2f39;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 30px 90px rgb(0 0 0 / 50%), 0 0 80px rgb(97 175 239 / 8%);
}

.bar {
    display: flex;
    gap: 6px;
    padding: 12px 14px;
    border-bottom: 1px solid #2b2f39;
    font-size: 12px;
    color: #6b7280;
    align-items: center;
}

.bar i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #3a3f4b;
}

.bar span {
    margin-left: 10px;
}

.bar b {
    margin-left: auto;
    font-weight: 500;
    font-family: var(--mono);
    color: #8b92a0;
}

.code {
    padding: 20px 20px 0;
    font-family: var(--mono);
    font-size: 14px;
    line-height: 1.8;
    min-height: 250px;
    white-space: pre;
}

.number {
    color: #4b5263;
    display: inline-block;
    width: 22px;
}

.fn {
    color: var(--blue);
}

.str {
    color: var(--green);
}

.prop {
    color: var(--red);
}

.caret {
    display: inline-block;
    width: 2px;
    height: 18px;
    background: #528bff;
    vertical-align: -4px;
    animation: blink 1s steps(1) infinite;
}

.popup {
    position: absolute;
    width: min(270px, calc(100% - 24px));
    background: #21252b;
    border: 1px solid #3a3f4b;
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 13px;
    overflow: hidden;
    opacity: 0;
    transform: translateY(-4px);
    transition: opacity 0.2s, transform 0.2s;
    box-shadow: 0 12px 30px rgb(0 0 0 / 45%);
    pointer-events: none;
}

.popup.show {
    opacity: 1;
    transform: none;
}

.item {
    padding: 5px 12px;
    display: flex;
    gap: 10px;
    align-items: baseline;
}

.item em {
    color: #6b7280;
}

.item small {
    color: #7f8899;
    margin-left: 4px;
}

.item.selected {
    background: #3e64c8;
    color: #fff;
}

.item.selected em,
.item.selected small {
    color: #dfe6ff;
}

.foot {
    border-top: 1px solid #343946;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--blue);
    display: flex;
    justify-content: space-between;
}

.foot span {
    color: #6b7280;
}

.out {
    margin: 0 20px 20px;
    border-top: 1px solid #2b2f39;
    padding-top: 12px;
    font-family: var(--mono);
    font-size: 12px;
    min-height: 34px;
}

.out b {
    color: var(--green);
    font-weight: 600;
}

@keyframes blink {
    50% {
        opacity: 0;
    }
}

@media (max-width: 900px) {
    .spot {
        grid-template-columns: 1fr;
        gap: 32px;
    }

    .code {
        font-size: 12px;
        min-height: 220px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .caret {
        animation: none;
    }

    .popup {
        transition: none;
    }
}
</style>
