import { createApp } from "vue";
import App from "./App.vue";
import { loadAppearance } from "@/composables/appearance";
import { registerPlugins } from "@/plugins";
import "virtual:uno.css";
import "unfonts.css";

const app = createApp(App);

registerPlugins(app);

// Theme and language come from the app's database: known before the first frame.
void loadAppearance().finally(() => app.mount("#app"));
