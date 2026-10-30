<script setup lang="ts">
import { LICENSE } from "@/links";
</script>

<template>
    <section id="faq">
        <div class="faq">
            <div>
                <div class="eyebrow">
                    // FAQ
                </div>
                <h2>Questions, answered.</h2>
                <p class="lead">
                    Something missing? Open an issue.
                </p>
            </div>
            <div>
                <details open>
                    <summary>Which MongoDB versions are supported?</summary>
                    <p>Everything the official Rust driver 3.x supports. Suggestions show the server version that introduced each stage and operator, so you see what your server can do.</p>
                </details>
                <details>
                    <summary>Where are my passwords stored?</summary>
                    <p>In the keychain of your operating system. Everything else – connections, settings, history, saved queries – lives in a local SQLite database. Nothing leaves your machine except the queries to your server.</p>
                </details>
                <details>
                    <summary>Can I run real JavaScript?</summary>
                    <p>Yes. The shell runs scripts in an embedded JavaScript engine with <code>db</code>, BSON helpers and <code>print</code>, with output as it comes.</p>
                </details>
                <details>
                    <summary>How do updates work?</summary>
                    <p>QueryMaster looks for a newer release when it starts and offers it as a card. It installs and restarts only when you ask; every update is signed.</p>
                </details>
                <details>
                    <summary>What does it cost?</summary>
                    <p>Nothing for personal, hobby, study and noncommercial use – and for charities, schools and public institutions. Companies can try it for thirty days; after that, commercial use needs a licence.</p>
                </details>
                <details>
                    <summary>Is it open source?</summary>
                    <p>
                        The source is public under the <a :href="LICENSE">Prosperity Public License 3.0.0</a>: read it, change it, share it and contribute back. It is not an OSI open-source licence, because commercial use beyond the trial is not free.
                    </p>
                </details>
            </div>
        </div>
    </section>
</template>

<style scoped>
.faq {
    display: grid;
    grid-template-columns: 1fr 1.6fr;
    gap: 56px;
}

details {
    border-bottom: 1px solid var(--line);
}

details:first-child {
    border-top: 1px solid var(--line);
}

summary {
    list-style: none;
    cursor: pointer;
    padding: 20px 0;
    font-weight: 600;
    font-size: 16px;
    display: flex;
    justify-content: space-between;
    gap: 20px;
}

summary::-webkit-details-marker {
    display: none;
}

summary::after {
    content: "+";
    color: var(--muted);
    font-weight: 400;
    font-size: 20px;
    line-height: 1;
    transition: transform 0.2s;
}

details[open] summary::after {
    transform: rotate(45deg);
}

details p {
    color: var(--muted);
    line-height: 1.65;
    padding: 0 40px 22px 0;
    font-size: 15px;
}

details a {
    text-decoration: underline;
}

@media (max-width: 900px) {
    .faq {
        grid-template-columns: 1fr;
        gap: 32px;
    }
}
</style>
