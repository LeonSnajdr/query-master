import { createApp } from "vue";
import App from "./App.vue";
import { loadAppearance } from "@/composables/appearance";
import { loadKeymap } from "@/keys/keymap";
import { registerPlugins } from "@/plugins";
import "virtual:uno.css";
import "unfonts.css";

const app = createApp(App);

registerPlugins(app);

// Where the app has no menu of its own, the web view's menu (Back, Reload, Inspect …) stays shut;
// text fields and editors keep it for cut, copy and paste.
window.addEventListener("contextmenu", (event) => {
    if (event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, [contenteditable=''], [contenteditable='true']")) return;
    event.preventDefault();
});

// Theme, language and keyboard shortcuts come from the app's database: known before the first frame.
void Promise.all([loadAppearance(), loadKeymap()]).finally(() => app.mount("#app"));
