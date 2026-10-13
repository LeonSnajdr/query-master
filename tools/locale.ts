// Adds or changes interface texts in both languages and keeps the files sorted.
//
//   bun tools/locale.ts <key> <english> <german> [<key> <english> <german> …]
//   bun tools/locale.ts --remove <key> [<key> …]
//   bun tools/locale.ts               (only sorts)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LOCALES = ["en", "de"] as const;
const file = (locale: string) => fileURLToPath(new URL(`../i18n/locales/${locale}/${locale}.json`, import.meta.url));
const read = (locale: string) => JSON.parse(readFileSync(file(locale), "utf8")) as Record<string, string>;

const args = process.argv.slice(2);
const messages = { en: read("en"), de: read("de") };

if (args[0] === "--remove") {
    for (const key of args.slice(1)) {
        for (const locale of LOCALES) delete messages[locale][key];
    }
} else {
    if (args.length % 3 !== 0) throw new Error("Expected triples of key, English text, German text");
    for (let index = 0; index < args.length; index += 3) {
        messages.en[args[index]!] = args[index + 1]!;
        messages.de[args[index]!] = args[index + 2]!;
    }
}

for (const locale of LOCALES) {
    const sorted = Object.fromEntries(Object.keys(messages[locale]).sort((a, b) => a.localeCompare(b)).map(key => [key, messages[locale][key]]));
    writeFileSync(file(locale), `${JSON.stringify(sorted, null, 2)}\n`);
}
console.log(`${Object.keys(messages.en).length} keys`);
