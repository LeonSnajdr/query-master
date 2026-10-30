import { fileURLToPath, URL } from "node:url";
import Vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// A static site: relative paths, so `dist` works from any folder of whatever server hosts it.
export default defineConfig({
    base: "./",
    plugins: [Vue()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("src", import.meta.url))
        }
    },
    server: {
        port: 5173,
        strictPort: true
    }
});
