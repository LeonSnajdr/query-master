<script setup lang="ts">
import { RELEASES } from "@/links";
</script>

<template>
    <nav class="nav">
        <div class="wrap row">
            <a
                class="logo"
                href="#"
            >
                <img
                    alt=""
                    height="26"
                    src="/icon.png"
                    width="26"
                />QueryMaster
            </a>
            <a
                class="link"
                href="#features"
            >Features</a>
            <a
                class="link"
                href="#faq"
            >FAQ</a>
            <a
                :href="RELEASES"
                class="link"
            >Changelog</a>
            <span class="grow" />
            <a
                class="btn btn-primary"
                href="#download"
            >Download</a>
        </div>
    </nav>
</template>

<style scoped>
.nav {
    position: sticky;
    top: 0;
    z-index: 20;
    backdrop-filter: blur(14px);
    background: rgb(8 9 13 / 72%);
}

.row {
    display: flex;
    align-items: center;
    gap: 28px;
    height: 64px;
    font-size: 14px;
    color: #9aa1b2;
}

.link:hover {
    color: #fff;
}

.logo {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #fff;
    font-weight: 700;
    font-size: 16px;
}

.logo img {
    border-radius: 7px;
}

.grow {
    flex: 1;
}

@media (max-width: 900px) {
    .link {
        display: none;
    }
}
</style>
