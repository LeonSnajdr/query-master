<script setup lang="ts">
import BuiltSection from "@/components/BuiltSection.vue";
import DownloadSection from "@/components/DownloadSection.vue";
import FaqSection from "@/components/FaqSection.vue";
import FeatureGrid from "@/components/FeatureGrid.vue";
import HeroSection from "@/components/HeroSection.vue";
import SiteFooter from "@/components/SiteFooter.vue";
import SiteNav from "@/components/SiteNav.vue";
import SuggestionSection from "@/components/SuggestionSection.vue";
</script>

<template>
    <SiteNav />
    <HeroSection />
    <main class="wrap">
        <SuggestionSection />
        <FeatureGrid />
        <BuiltSection />
        <FaqSection />
    </main>
    <DownloadSection />
    <SiteFooter />
</template>
