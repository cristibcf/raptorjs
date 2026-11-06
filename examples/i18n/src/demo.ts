/**
 * Headless i18n demo (runs on Node):
 *
 *   node examples/i18n/src/demo.ts
 *
 * What it shows, and why i18n belongs in the framework rather than in each
 * application: a language switch is a signal write, so it rewrites the four
 * bound text nodes and touches nothing else - no component re-runs, no element
 * is created, no reload. In a VDOM that same switch re-renders the tree.
 *
 * It also shows the part applications get wrong: Romanian has three plural
 * forms and Polish four, and `Intl.PluralRules` knows which one 101 takes.
 */
import { installMiniDom, stats, resetStats } from "@raptorstack/raptorjs/dom/testing";
import { render } from "@raptorstack/raptorjs/dom";
import { state } from "@raptorstack/raptorjs";
import { setLocale, locale, plural, withLocale, t } from "@raptorstack/raptorjs/i18n";
import { registerLocales, Screen, SUPPORTED } from "./app.ts";

const doc = installMiniDom();
registerLocales();

const jobs = state(3);
const root = doc.createElement("div");
await setLocale("en");
render(() => Screen(() => jobs()) as never, root);

console.log("=== RaptorJS i18n ===\n");
console.log("Registered languages:", SUPPORTED.join(", "));
console.log(`\n[${locale()}] ${root.toHTML()}`);

// --- A language switch, measured ------------------------------------------
resetStats();
await setLocale("ro"); // lazy catalogue: fetched now, once
console.log(`[${locale()}] ${root.toHTML()}`);
await setLocale("pl");
console.log(`[${locale()}] ${root.toHTML()}`);

console.log("\nDOM mutations across TWO full language switches:");
console.log(`  new elements created : ${stats.createElement}   (expected: 0)`);
console.log(`  new text nodes       : ${stats.createText}   (expected: 0)`);
console.log(`  nodes re-inserted    : ${stats.insert}   (expected: 0)`);
console.log(`  text updates         : ${stats.textUpdate}   (4 bindings x 2 switches = 8)`);
console.log("\n-> The language changed; the component never re-ran.");

// --- Plural forms ---------------------------------------------------------
console.log("\nPlural selection (Intl.PluralRules, not `count === 1`):");
for (const tag of ["en", "ro", "pl"]) {
  const row = [0, 1, 2, 5, 11, 21, 101]
    .map((n) => withLocale(tag, () => plural("jobs.count", n)))
    .join(" | ");
  console.log(`  ${tag}: ${row}`);
}

// --- One process, many languages -----------------------------------------
// What an SSR response or a notification job needs: render in the reader's
// language without moving the global locale other requests are reading.
console.log("\nwithLocale (SSR / email), current locale stays " + locale() + ":");
for (const tag of ["ro", "en", "pl"]) {
  console.log(`  ${tag}: ${withLocale(tag, () => t("greeting", { name: "Ana" }))}`);
}
console.log("  current locale after all of it:", locale());
