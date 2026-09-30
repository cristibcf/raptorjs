import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildModule,
  buildModuleAsync,
  loadLowLevelEngine,
  createRolldownEngine,
  detectToolchain,
  runCliAsync,
} from "../../src/engine/index.ts";

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

// Detect once whether Rolldown/Oxc are installed (optional, §37).
const toolchain = await detectToolchain();

test("detectToolchain: reports availability (without throwing)", () => {
  // Either a string version, or null - never an exception.
  assert.ok(toolchain.rolldown === null || typeof toolchain.rolldown === "string");
  assert.ok(toolchain.oxc === null || typeof toolchain.oxc === "string");
});

test("buildModuleAsync (naive) = buildModule, with toolchain in manifest", async () => {
  const sync = buildModule(APP, "app.raptor");
  const asyncR = await buildModuleAsync(APP, "app.raptor");
  assert.equal(asyncR.bundleCode, sync.bundleCode);
  assert.equal(asyncR.manifest.toolchain["lowlevel"], "naive@0.1.0");
});

test("loadLowLevelEngine('rolldown', {fallback:true}): Rolldown if present, otherwise naive", async () => {
  const engine = await loadLowLevelEngine("rolldown", { fallback: true });
  if (toolchain.rolldown) {
    assert.equal(engine.name, "rolldown");
  } else {
    assert.equal(engine.name, "naive");
    assert.match(engine.describe!()["lowlevel"]!, /fallback/);
  }
});

test("loadLowLevelEngine('rolldown', {fallback:false}) throws when Rolldown is missing", async () => {
  if (toolchain.rolldown) return; // installed: should not throw
  await assert.rejects(loadLowLevelEngine("rolldown", { fallback: false }), /Rolldown not found/);
});

test("loadLowLevelEngine('auto') produces a usable engine (async bundle)", async () => {
  const engine = await loadLowLevelEngine("auto");
  const result = await buildModuleAsync(APP, "app.raptor", { engine });
  assert.ok(result.bundleCode.length > 0);
  assert.ok(result.manifest.toolchain["lowlevel"]);
});

test("cli: raptor toolchain detects the low-level engine", async () => {
  const r = await runCliAsync(["toolchain"], () => "");
  assert.equal(r.code, 0);
  assert.match(r.out, /rolldown:/);
  assert.match(r.out, /oxc:/);
});

test("cli: build --engine rolldown runs (Rolldown or naive fallback)", async () => {
  const r = await runCliAsync(["build", "app.raptor", "--engine", "rolldown"], () => APP);
  assert.equal(r.code, 0);
  assert.match(r.out, /toolchain:/);
  assert.match(r.out, /bundle: \d+ bytes/);
});

// REAL test, enabled only if Rolldown is installed (§37: replacement when present).
test(
  "rolldown real: bundles + minifies the semantic output",
  { skip: toolchain.rolldown ? false : "rolldown not installed (optional)" },
  async () => {
    const engine = await createRolldownEngine({ minify: true });
    const result = await buildModuleAsync(APP, "app.raptor", { engine });
    assert.ok(result.bundleCode.length > 0);
    assert.equal(result.manifest.toolchain["rolldown"], toolchain.rolldown);
    // Externals stay external; the component code is present.
    assert.match(result.bundleCode, /@raptor\/(core|dom)/);
  },
);
