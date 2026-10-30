<script setup lang="ts">
import { LICENSE, RELEASES, REPOSITORY } from "@/links";
</script>

<template>
    <footer>
        <div class="wrap row">
            <span>© 2026 Leon Snajdr</span>
            <a :href="REPOSITORY">GitHub</a>
            <a :href="LICENSE">Prosperity License</a>
            <a :href="RELEASES">Changelog</a>
        </div>
    </footer>
</template>

<style scoped>
footer {
    border-top: 1px solid var(--line);
}

.row {
    padding-top: 30px;
    padding-bottom: 50px;
    color: var(--dim);
    font-size: 13px;
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
}

a:hover {
    color: #cfd3dd;
}
</style>
