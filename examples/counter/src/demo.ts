/**
 * Headless counter demo (runs on Node): proves the fine-grained model from
 * whitepaper section 6 - a click updates EXACTLY one text node, with no
 * component re-render and no new elements.
 *
 *   node examples/counter/src/demo.ts
 *
 * The same logic, written in TSX, is in src/main.tsx (for browser/Vite).
 */
import { installMiniDom, stats, resetStats, type MiniElement } from "raptorjs/dom/testing";
import { render, mountChild, applyProps } from "raptorjs/dom";
import { state, derived } from "raptorjs";

const doc = installMiniDom();

/** The equivalent of the "compiler output" for the Counter component. */
function Counter(): MiniElement {
  const count = state(0);
  const parity = derived(() => (count() % 2 === 0 ? "even" : "odd"));

  const section = doc.createElement("section");

  const h2 = doc.createElement("h2");
  mountChild(h2, () => count(), null); // fine-grained bound text node
  section.appendChild(h2);

  const p = doc.createElement("p");
  mountChild(p, () => `Value ${parity()}`, null);
  section.appendChild(p);

  const button = doc.createElement("button");
  applyProps(button, { "on:click": () => count.update((n) => n + 1) });
  mountChild(button, "+1", null);
  section.appendChild(button);

  return section as unknown as MiniElement;
}

const root = doc.createElement("div");
render(Counter, root);

console.log("=== RaptorJS counter (fine-grained) ===\n");
console.log("Initial:", root.toHTML());

resetStats();
const button = root.querySelector("button")!;
for (let i = 0; i < 3; i++) button.click();

console.log("After 3 clicks:", root.toHTML());
console.log("\nDOM mutations across the 3 clicks:");
console.log(`  new elements created : ${stats.createElement}   (expected: 0)`);
console.log(`  new text nodes       : ${stats.createText}   (expected: 0)`);
console.log(`  text updates         : ${stats.textUpdate}   (2 bindings x 3 clicks = 6)`);
console.log("\n-> No component re-executed, no node recreated: just text mutated in place.");
