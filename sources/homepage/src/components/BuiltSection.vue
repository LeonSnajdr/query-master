<script setup lang="ts">
const FACTS = [
    { value: "Rust", label: "official mongodb 3.x driver" },
    { value: "Tauri", label: "no Electron, small installer" },
    { value: "Signed", label: "updates from GitHub releases" },
    { value: "0", label: "passwords in plain files" }
];
</script>

<template>
    <section>
        <div class="eyebrow">
            // Built right
        </div>
        <h2>Native where it counts.</h2>
        <p class="lead">
            The official Rust driver talks to your server. Your passwords stay in the system keychain.
        </p>
        <div class="facts">
            <div
                v-for="fact in FACTS"
                :key="fact.value"
            >
                <b>{{ fact.value }}</b><span>{{ fact.label }}</span>
            </div>
        </div>
    </section>
</template>

<style scoped>
.facts {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1px;
    background: var(--line);
    border: 1px solid var(--line);
    border-radius: 18px;
    overflow: hidden;
}

.facts div {
    background: var(--panel);
    padding: 28px;
}

b {
    display: block;
    font-size: 32px;
    letter-spacing: -0.03em;
}

span {
    color: var(--muted);
    font-size: 14px;
}

@media (max-width: 900px) {
    .facts {
        grid-template-columns: 1fr 1fr;
    }
}
</style>
