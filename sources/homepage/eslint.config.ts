import stylistic from "@stylistic/eslint-plugin";
import { defineConfigWithVueTs, vueTsConfigs } from "@vue/eslint-config-typescript";
import pluginVue from "eslint-plugin-vue";

export default defineConfigWithVueTs(
    {
        ignores: [
            "**/dist/**",
            "**/node_modules/**",
            "docs/**"
        ]
    },
    pluginVue.configs["flat/recommended"],
    vueTsConfigs.recommended,
    stylistic.configs.customize({
        indent: 4,
        quotes: "double",
        semi: true,
        commaDangle: "never",
        braceStyle: "1tbs"
    }),
    {
        files: ["**/*.vue"],
        rules: {
            "vue/multi-word-component-names": "off",
            "vue/no-multiple-template-root": "off",
            "vue/v-on-event-hyphenation": ["error", "never"],
            "vue/attribute-hyphenation": ["error", "never"],
            "vue/component-name-in-template-casing": ["error", "PascalCase", { registeredComponentsOnly: false }],
            "vue/component-api-style": ["error", ["script-setup"]],
            "vue/html-indent": ["error", 4],
            "vue/html-self-closing": [
                "error",
                {
                    html: {
                        void: "always",
                        normal: "always",
                        component: "always"
                    },
                    svg: "always",
                    math: "always"
                }
            ],
            "vue/define-macros-order": [
                "error",
                {
                    order: ["defineEmits", "defineProps", "defineModel"]
                }
            ],
            "vue/attributes-order": [
                "error",
                {
                    order: [
                        "DEFINITION",
                        "LIST_RENDERING",
                        "CONDITIONALS",
                        "RENDER_MODIFIERS",
                        "GLOBAL",
                        ["UNIQUE", "SLOT"],
                        "TWO_WAY_BINDING",
                        "EVENTS",
                        "ATTR_DYNAMIC",
                        "ATTR_STATIC",
                        "ATTR_SHORTHAND_BOOL",
                        "OTHER_DIRECTIVES",
                        "CONTENT"
                    ],
                    alphabetical: true
                }
            ]
        }
    }
);
