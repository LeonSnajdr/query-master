import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// Bundles what a script sees (`src/shell/runtime`) into one file the Rust side embeds. Not minified:
// the file is versioned, so a change in it should read as a change.
export default defineConfig({
    publicDir: false,
    build: {
        lib: {
            entry: fileURLToPath(new URL("src/shell/runtime/index.ts", import.meta.url)),
            formats: ["iife"],
            name: "QueryMasterRuntime",
            fileName: () => "runtime.js"
        },
        outDir: fileURLToPath(new URL("src-tauri/script", import.meta.url)),
        emptyOutDir: false,
        minify: false,
        target: "es2022"
    }
});
