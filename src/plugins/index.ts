import { createNotificationsPlugin } from "@vuetify/v0";
import { createPinia } from "pinia";
import type { App } from "vue";
import i18n, { v0Locale } from "./i18n";
import vuetify from "./vuetify";

export function registerPlugins(app: App) {
    app.use(vuetify);
    app.use(createNotificationsPlugin());
    app.use(i18n);
    app.use(v0Locale);
    app.use(createPinia());
}
