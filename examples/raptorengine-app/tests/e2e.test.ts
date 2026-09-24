/**
 * Test end-to-end: sursa .raptor -> IR -> optimize -> codegen browser -> se
 * COMPILEAZA si RULEAZA cod real pe runtime-ul @raptor/core + @raptor/dom.
 *
 * Aceasta valideaza teza whitepaper-ului (35): outputs generate din acelasi graf
 * semantic sunt corecte si fine-grained. Codul generat se scrie pe disc in
 * exemplu (unde @raptor/* se rezolva) si se importa dinamic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { buildModule } from "@raptor/engine";
import { installMiniDom, resetStats, stats, type MiniElement } from "@raptor/dom/testing";

installMiniDom();
const doc = (globalThis as unknown as { document: any }).document;

// mini-dom.querySelector accepta doar tag-uri; helper pentru selectie dupa clasa.
function byClass(el: any, cls: string): any {
  for (const c of el.childNodes) {
    if (c.nodeType === 1) {
      const klass = String(c.getAttribute("class") ?? "");
      if (klass.split(/\s+/).includes(cls)) return c;
      const found = byClass(c, cls);
      if (found) return found;
    }
  }
  return null;
}

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "src", "App.raptor"), "utf8");
const result = buildModule(source, "App.raptor");

// Scrie codul generat unde node_modules/@raptor/* se rezolva (radacina exemplului).
const genDir = join(here, "..", ".generated");
mkdirSync(genDir, { recursive: true });
const genFile = join(genDir, "App.browser.ts");
writeFileSync(genFile, result.browser);

test("build: DSE elimina 'unused', fusion colapseaza 'label'", () => {
  assert.ok(result.manifest.metrics.eliminated >= 1);
  assert.ok(result.manifest.metrics.fused >= 1);
  // 'doubled' are 2 consumatori (text + atribut) -> supravietuieste in output.
  assert.match(result.browser, /const doubled = derived\(\(\) => \(count\(\) \* 2\)\)/);
});

test("e2e: codul generat ruleaza si produce DOM corect + reactivitate fine-grained", async () => {
  const mod = (await import(pathToFileURL(genFile).href)) as { App: () => MiniElement };
  const { render } = await import("@raptor/dom");

  const root = doc.createElement("div") as MiniElement;
  render(mod.App, root);

  // Stare initiala. (Textul static "doubled =" e concatenat fara spatiu de mini-dom.)
  assert.equal(root.querySelector("button")!.textContent, "increment");
  assert.equal(byClass(root, "count").textContent, "clicks: 0");
  assert.equal(byClass(root, "double").textContent, "doubled =0");
  assert.equal(byClass(root, "double").getAttribute("data-value"), "0");
  assert.equal(byClass(root, "price").textContent, "price =0");

  // Click -> count=1. Masuram doar mutatiile provocate de update.
  resetStats();
  root.querySelector("button")!.click();

  assert.equal(byClass(root, "count").textContent, "clicks: 1");
  assert.equal(byClass(root, "double").textContent, "doubled =2");
  assert.equal(byClass(root, "double").getAttribute("data-value"), "2");

  // Fine-grained: niciun element nou creat; doar text/atribut actualizate.
  assert.equal(stats.createElement, 0, "update-ul nu trebuie sa creeze elemente noi");
  assert.equal(stats.createText, 0, "update-ul reuseste text nodes (fast-path)");
  assert.ok(stats.textUpdate >= 2, "text bindings pentru label si doubled");
});
