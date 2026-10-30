<script setup lang="ts">
import { shallowRef } from "vue";

/** The themes the hero screenshot switches between; each is a real screenshot of the app. */
const THEMES = [
    { name: "One Dark", shot: "tree.png", swatch: "#282c34", ring: "#3a3f4b" },
    { name: "One Light", shot: "light.png", swatch: "#fafafa", ring: "#3a3f4b" },
    { name: "Ayu Mirage", shot: "mirage.png", swatch: "#1f2430", ring: "#ffcc66" }
] as const;

const current = shallowRef<string>(THEMES[0].shot);
/** The next screenshot fades in over the current one, then takes its place. */
const next = shallowRef<string>();
const shown = () => next.value ?? current.value;

function show(shot: string): void {
    if (shot !== shown()) next.value = shot;
}

function arrived(): void {
    window.setTimeout(() => {
        current.value = next.value ?? current.value;
        next.value = undefined;
    }, 360);
}
</script>

<template>
    <header class="hero">
        <div class="wrap">
            <span class="pill"><i />Tested against MongoDB 7.0</span>
            <h1>The MongoDB client that thinks one step ahead.</h1>
            <p class="sub">
                Write queries with suggestions from your real data, see why they are slow, and never wipe production by accident. Native, fast, keyboard-first.
            </p>
            <div class="ctas">
                <a
                    class="btn btn-primary"
                    href="#download"
                >⬇ Download for Windows</a>
                <a
                    class="btn btn-secondary"
                    href="#download"
                >macOS &amp; Linux</a>
            </div>
            <div class="meta">
                Free for personal use · 30-day trial for work · Built with Tauri &amp; Rust
            </div>
            <div
                aria-label="Theme"
                class="themes"
                role="tablist"
            >
                <button
                    v-for="theme in THEMES"
                    :key="theme.shot"
                    @click="show(theme.shot)"
                    :aria-selected="shown() === theme.shot"
                    :class="{ on: shown() === theme.shot }"
                    role="tab"
                    type="button"
                >
                    <i :style="{ background: theme.swatch, borderColor: theme.ring }" />{{ theme.name }}
                </button>
            </div>
        </div>
        <div class="stage wrap">
            <div class="frame">
                <img
                    :src="`./screenshots/${current}`"
                    alt="QueryMaster with an aggregation pipeline and its results as a tree"
                    height="1600"
                    width="2560"
                />
                <img
                    v-if="next"
                    @load="arrived"
                    :src="`./screenshots/${next}`"
                    alt=""
                    class="next"
                />
            </div>
        </div>
        <div class="wrap">
            <div class="facts">
                <span>MongoDB 4.2 – 8.2</span><span>·</span><span>Windows</span><span>·</span><span>macOS</span><span>·</span><span>Linux</span><span>·</span><span>English / Deutsch</span>
            </div>
        </div>
    </header>
</template>

<style scoped>
.hero {
    position: relative;
    text-align: center;
    padding: 84px 0 0;
    overflow: hidden;
}

.hero::before {
    content: "";
    position: absolute;
    inset: -200px 0 auto;
    height: 760px;
    pointer-events: none;
    background:
        radial-gradient(600px 300px at 50% 40%, rgb(97 175 239 / 25%), transparent 70%),
        radial-gradient(500px 260px at 30% 60%, rgb(124 92 255 / 18%), transparent 70%);
}

.pill {
    position: relative;
    display: inline-flex;
    gap: 8px;
    align-items: center;
    border: 1px solid #252a36;
    background: #10131a;
    border-radius: 999px;
    padding: 6px 14px;
    font-size: 13px;
    color: #aab1c2;
}

.pill i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 8px var(--green);
}

h1 {
    position: relative;
    font-size: clamp(40px, 6vw, 72px);
    letter-spacing: -0.035em;
    line-height: 1.03;
    font-weight: 800;
    margin: 22px auto 18px;
    max-width: 900px;
    background: linear-gradient(180deg, #fff 30%, #9aa3b8);
    background-clip: text;
    color: transparent;
}

.sub {
    position: relative;
    font-size: 19px;
    color: #9aa1b2;
    max-width: 640px;
    margin: 0 auto 30px;
    line-height: 1.55;
}

.meta {
    position: relative;
    margin-top: 14px;
    font-size: 12px;
    color: #6b7285;
}

.themes {
    position: relative;
    display: inline-flex;
    gap: 4px;
    margin-top: 56px;
    padding: 4px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: #0e1118;
}

.themes button {
    font: inherit;
    font-size: 13px;
    color: var(--muted);
    background: none;
    border: 0;
    border-radius: 999px;
    padding: 7px 14px;
    cursor: pointer;
    display: flex;
    gap: 8px;
    align-items: center;
}

.themes button i {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1px solid;
}

.themes button.on {
    background: #1b1f2a;
    color: #fff;
}

.stage {
    position: relative;
    margin: 26px auto 0;
    max-width: 1120px;
    perspective: 1800px;
}

.frame {
    position: relative;
    overflow: hidden;
    transform: rotateX(8deg);
    transform-origin: bottom;
    border-radius: 14px 14px 0 0;
    border: 1px solid var(--line-strong);
    border-bottom: 0;
    background: #21252b;
    box-shadow: 0 -20px 120px rgb(97 175 239 / 18%), 0 0 0 1px rgb(255 255 255 / 3%);
}

.frame img {
    width: 100%;
    height: auto;
}

.frame .next {
    position: absolute;
    inset: 0;
    animation: fade-in 0.35s both;
}

.stage::after {
    content: "";
    position: absolute;
    inset: auto 0 0;
    height: 40%;
    background: linear-gradient(transparent, var(--bg));
    pointer-events: none;
}

.facts {
    display: flex;
    justify-content: center;
    gap: 36px;
    flex-wrap: wrap;
    padding: 34px 0 10px;
    color: var(--dim);
    font-size: 14px;
    font-weight: 600;
}

@keyframes fade-in {
    from {
        opacity: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .frame .next {
        animation: none;
    }
}
</style>
