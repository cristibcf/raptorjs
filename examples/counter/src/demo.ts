/**
 * Demo counter headless (ruleaza pe Node): dovedeste modelul fine-grained din
 * whitepaper sectiunea 6 - un click actualizeaza EXACT un text-node, fara
 * re-render de componenta si fara elemente noi.
 *
 *   node examples/counter/src/demo.ts
 *
 * Aceeasi logica, scrisa in TSX, este in src/main.tsx (pentru browser/Vite).
 */
import { installMiniDom, stats, resetStats, type MiniElement } from "@raptor/dom/testing";
import { render, mountChild, applyProps } from "@raptor/dom";
import { state, derived } from "@raptor/core";

const doc = installMiniDom();

/** Echivalentul "output-ului compilerului" pentru componenta Counter. */
function Counter(): MiniElement {
  const count = state(0);
  const parity = derived(() => (count() % 2 === 0 ? "par" : "impar"));

  const section = doc.createElement("section");

  const h2 = doc.createElement("h2");
  mountChild(h2, () => count(), null); // text-node legat fine-grained
  section.appendChild(h2);

  const p = doc.createElement("p");
  mountChild(p, () => `Valoare ${parity()}`, null);
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

console.log("Dupa 3 click-uri:", root.toHTML());
console.log("\nMutatii DOM in cele 3 click-uri:");
console.log(`  elemente noi create : ${stats.createElement}   (asteptat: 0)`);
console.log(`  text-node-uri noi   : ${stats.createText}   (asteptat: 0)`);
console.log(`  actualizari de text : ${stats.textUpdate}   (2 binduri x 3 click-uri = 6)`);
console.log("\n-> Nicio componenta re-executata, niciun nod recreat: doar text mutat exact.");
