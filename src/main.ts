import { createApp } from "vue";
import App from "./App.vue";
import { loadAppearance } from "@/composables/appearance";
import { loadKeymap } from "@/keys/keymap";
import { registerPlugins } from "@/plugins";
import "virtual:uno.css";
import "unfonts.css";

const app = createApp(App);

registerPlugins(app);

// Theme, language and keyboard shortcuts come from the app's database: known before the first frame.
void Promise.all([loadAppearance(), loadKeymap()]).finally(() => app.mount("#app"));
