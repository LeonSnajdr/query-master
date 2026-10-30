<script setup lang="ts">
import { DOWNLOAD } from "@/links";
</script>

<template>
    <div
        id="download"
        class="download"
    >
        <h2>Query like you mean it.</h2>
        <p class="lead">
            Free for personal use, 30 days to try at work. Windows, macOS and Linux.
        </p>
        <div class="ctas">
            <a
                :href="DOWNLOAD"
                class="btn btn-primary"
            >⬇ Download the latest release</a>
        </div>
        <p class="note">
            Windows: .msi or -setup.exe · macOS: .dmg · Linux: .AppImage, .deb or .rpm
        </p>
    </div>
</template>

<style scoped>
.download {
    margin: 120px 0 0;
    padding: 90px 24px;
    text-align: center;
    border-top: 1px solid var(--line);
    background: radial-gradient(500px 200px at 50% 0%, rgb(97 175 239 / 18%), transparent 70%);
}

.lead {
    margin: 0 auto 26px;
}

.note {
    margin-top: 16px;
    font-size: 12px;
    color: #6b7285;
}
</style>
