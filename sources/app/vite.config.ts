import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import Vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";
import Fonts from "unplugin-fonts/vite";
import { defineConfig } from "vitest/config";

// The release build gets its number from CI (APP_VERSION, as in `tauri.conf.json`); otherwise 0.0.0.
const version = process.env.APP_VERSION ?? (JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as { version: string }).version;

// Tauri expects a fixed port and reports Rust errors in the same terminal.
export default defineConfig({
    // "About QueryMaster" shows it.
    define: {
        __APP_VERSION__: JSON.stringify(version)
    },
    plugins: [Vue(), Fonts({
        fontsource: {
            families: [
                {
                    name: "Open Sans",
                    weights: [400, 600, 700],
                    styles: ["normal"]
                },
                {
                    name: "JetBrains Mono",
                    weights: [400, 700],
                    styles: ["normal"]
                }
            ]
        }
    }), UnoCSS()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("src", import.meta.url))
        }
    },
    clearScreen: false,
    server: {
        port: 1420,
        strictPort: true,
        watch: {
            ignored: ["**/src-tauri/**"]
        }
    },
    test: {
        include: ["src/**/*.test.ts", "i18n/**/*.test.ts"]
    }
});
