import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildModule,
  buildModuleAsync,
  loadLowLevelEngine,
  createRolldownEngine,
  detectToolchain,
  runCliAsync,
} from "../src/index.ts";

const APP = `
component App {
  const count = state(0)
  const doubled = derived(() => count * 2)
  const price = serverSignal("BTC.price", schema.money)
  <div class="app">
    <button on:click={count++}>+</button>
    <span data-d={doubled}>{doubled}</span>
    <span>{count} / {price}</span>
  </div>
}
`;

// Detectam o singura data daca Rolldown/Oxc sunt instalate (optional, §37).
const toolchain = await detectToolchain();

test("detectToolchain: raporteaza disponibilitatea (fara sa arunce)", () => {
  // Fie versiune string, fie null - niciodata exceptie.
  assert.ok(toolchain.rolldown === null || typeof toolchain.rolldown === "string");
  assert.ok(toolchain.oxc === null || typeof toolchain.oxc === "string");
});

test("buildModuleAsync (naiv) = buildModule, cu toolchain in manifest", async () => {
  const sync = buildModule(APP, "app.raptor");
  const asyncR = await buildModuleAsync(APP, "app.raptor");
  assert.equal(asyncR.bundleCode, sync.bundleCode);
  assert.equal(asyncR.manifest.toolchain["lowlevel"], "naive@0.1.0");
});

test("loadLowLevelEngine('rolldown', {fallback:true}): Rolldown daca exista, altfel naiv", async () => {
  const engine = await loadLowLevelEngine("rolldown", { fallback: true });
  if (toolchain.rolldown) {
    assert.equal(engine.name, "rolldown");
  } else {
    assert.equal(engine.name, "naive");
    assert.match(engine.describe!()["lowlevel"]!, /fallback/);
  }
});

test("loadLowLevelEngine('rolldown', {fallback:false}) arunca cand Rolldown lipseste", async () => {
  if (toolchain.rolldown) return; // instalat: nu ar trebui sa arunce
  await assert.rejects(loadLowLevelEngine("rolldown", { fallback: false }), /Rolldown negasit/);
});

test("loadLowLevelEngine('auto') produce un engine utilizabil (bundle async)", async () => {
  const engine = await loadLowLevelEngine("auto");
  const result = await buildModuleAsync(APP, "app.raptor", { engine });
  assert.ok(result.bundleCode.length > 0);
  assert.ok(result.manifest.toolchain["lowlevel"]);
});

test("cli: raptor toolchain detecteaza engine-ul low-level", async () => {
  const r = await runCliAsync(["toolchain"], () => "");
  assert.equal(r.code, 0);
  assert.match(r.out, /rolldown:/);
  assert.match(r.out, /oxc:/);
});

test("cli: build --engine rolldown ruleaza (Rolldown sau fallback naiv)", async () => {
  const r = await runCliAsync(["build", "app.raptor", "--engine", "rolldown"], () => APP);
  assert.equal(r.code, 0);
  assert.match(r.out, /toolchain:/);
  assert.match(r.out, /bundle: \d+ bytes/);
});

// Test REAL, activat doar daca Rolldown e instalat (§37: inlocuire cand exista).
test(
  "rolldown real: bundleaza + minifica output-ul semantic",
  { skip: toolchain.rolldown ? false : "rolldown neinstalat (optional)" },
  async () => {
    const engine = await createRolldownEngine({ minify: true });
    const result = await buildModuleAsync(APP, "app.raptor", { engine });
    assert.ok(result.bundleCode.length > 0);
    assert.equal(result.manifest.toolchain["rolldown"], toolchain.rolldown);
    // Externii raman externi; codul de componenta e prezent.
    assert.match(result.bundleCode, /@raptor\/(core|dom)/);
  },
);
