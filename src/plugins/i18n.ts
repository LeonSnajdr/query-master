import { createLocalePlugin } from "@vuetify/v0";
import { VueI18nLocaleAdapter } from "@vuetify/v0/locale/adapters/vue-i18n";
import i18n from "../../i18n/i18n.config";

// The adapter is typed against an untyped composer; our message schema is stricter.
type AdapterI18n = ConstructorParameters<typeof VueI18nLocaleAdapter>[0];

/** Lets v0 components resolve their built-in aria strings through vue-i18n. */
export const v0Locale = createLocalePlugin({ adapter: new VueI18nLocaleAdapter(i18n as unknown as AdapterI18n) });

export default i18n;
