/**
 * End-to-end test: .raptor source -> IR -> optimize -> browser codegen -> it
 * COMPILES and RUNS real code on the @raptorstack/raptorjs + @raptorstack/raptorjs/dom runtime.
 *
 * This validates the whitepaper's thesis (35): outputs generated from the same
 * semantic graph are correct and fine-grained. The generated code is written to
 * disk in the example (where @raptorstack/* resolves) and imported dynamically.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { buildModule } from "@raptorstack/engine";
import { installMiniDom, resetStats, stats, type MiniElement } from "@raptorstack/raptorjs/dom/testing";

installMiniDom();
const doc = (globalThis as unknown as { document: any }).document;

// mini-dom.querySelector only accepts tags; helper for selecting by class.
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

// Write the generated code where node_modules/@raptorstack/* resolves (the example root).
const genDir = join(here, "..", ".generated");
mkdirSync(genDir, { recursive: true });
const genFile = join(genDir, "App.browser.ts");
writeFileSync(genFile, result.browser);

test("build: DSE eliminates 'unused', fusion collapses 'label'", () => {
  assert.ok(result.manifest.metrics.eliminated >= 1);
  assert.ok(result.manifest.metrics.fused >= 1);
  // 'doubled' has 2 consumers (text + attribute) -> survives in the output.
  assert.match(result.browser, /const doubled = derived\(\(\) => \(count\(\) \* 2\)\)/);
});

test("e2e: the generated code runs and produces correct DOM + fine-grained reactivity", async () => {
  const mod = (await import(pathToFileURL(genFile).href)) as { App: () => MiniElement };
  const { render } = await import("@raptorstack/raptorjs/dom");

  const root = doc.createElement("div") as MiniElement;
  render(mod.App, root);

  // Initial state. (The static text "doubled =" is concatenated without a space by mini-dom.)
  assert.equal(root.querySelector("button")!.textContent, "increment");
  assert.equal(byClass(root, "count").textContent, "clicks: 0");
  assert.equal(byClass(root, "double").textContent, "doubled =0");
  assert.equal(byClass(root, "double").getAttribute("data-value"), "0");
  assert.equal(byClass(root, "price").textContent, "price =0");

  // Click -> count=1. We measure only the mutations caused by the update.
  resetStats();
  root.querySelector("button")!.click();

  assert.equal(byClass(root, "count").textContent, "clicks: 1");
  assert.equal(byClass(root, "double").textContent, "doubled =2");
  assert.equal(byClass(root, "double").getAttribute("data-value"), "2");

  // Fine-grained: no new element created; only text/attribute updated.
  assert.equal(stats.createElement, 0, "the update must not create new elements");
  assert.equal(stats.createText, 0, "the update reuses text nodes (fast-path)");
  assert.ok(stats.textUpdate >= 2, "text bindings for label and doubled");
});
