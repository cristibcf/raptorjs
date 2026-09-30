import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModule } from "@raptorstack/engine/compiler";
import {
  optimize,
  buildModule,
  emitWireManifest,
  DevEngine,
  formatUpdateLog,
  computeCacheKey,
  SemanticCache,
  resolveConfig,
  defineConfig,
} from "../../src/engine/index.ts";

const COUNTER = `
component Counter {
  const count = state(0)
  const doubled = derived(() => count * 2)
  const dead = derived(() => doubled + 100)
  <div class="counter">
    <button on:click={count++}>Increment</button>
    <span>Count: {count}</span>
    <span>Doubled: {doubled}</span>
  </div>
}
`;

// Fusion chain: a -> b -> text (each with a single consumer).
const CHAIN = `
component Chain {
  const a = state(1)
  const b = derived(() => a + 1)
  const c = derived(() => b * 2)
  <span>{c}</span>
}
`;

const FUSION_BLOCKED = `
component Chain {
  const a = state(1)
  @debug const b = derived(() => a + 1)
  const c = derived(() => b * 2)
  <span>{c}</span>
}
`;

const TICKER = `
component Ticker {
  const price = serverSignal("BTC.price", schema.money)
  const formatted = derived(() => price.toFixed(2))
  <span class="price">{formatted}</span>
}
`;

test("optimize: DSE eliminates the unconsumed derived", () => {
  const mod = parseModule(COUNTER, "Counter.raptor");
  // Isolate DSE (without fusion) to see exactly what remains after elimination.
  const { module, metrics } = optimize(mod, { fusion: false });
  const names = module.components[0]!.deriveds.map((d) => d.name);
  assert.deepEqual(names, ["doubled"]); // 'dead' eliminated, 'doubled' kept
  assert.equal(metrics.eliminated, 1);
});

test("optimize: Dependency Fusion collapses the derived chain", () => {
  const mod = parseModule(CHAIN, "Chain.raptor");
  const { module, metrics } = optimize(mod);
  // b and c fuse into the text binding -> 0 deriveds left.
  assert.equal(module.components[0]!.deriveds.length, 0);
  assert.equal(metrics.fused, 2);
});

test("optimize: fusion is blocked at the debug boundary", () => {
  const mod = parseModule(FUSION_BLOCKED, "Chain.raptor");
  const { module, trace } = optimize(mod);
  // b (@debug) stays; c can still fuse into text if it has a single consumer.
  const names = module.components[0]!.deriveds.map((d) => d.name);
  assert.ok(names.includes("b"));
  assert.ok(trace.some((e) => e.action === "blocked"));
});

test("optimize: fusion disabled keeps all deriveds", () => {
  const mod = parseModule(CHAIN, "Chain.raptor");
  const { module } = optimize(mod, { fusion: false });
  assert.equal(module.components[0]!.deriveds.length, 2);
});

test("codegen: same graph -> browser + server + wire", () => {
  const result = buildModule(TICKER, "Ticker.raptor");
  // Browser: 'formatted' (single consumer) is fused directly into the text binding.
  assert.match(result.browser, /mountChild\(_e0, \(\) => price\(\)\.toFixed\(2\), null\)/);
  assert.match(result.browser, /export function Ticker\(\)/);
  assert.doesNotMatch(result.browser, /const formatted/);
  // Server: producer registered from the same server signal.
  assert.equal(result.server.producers[0]!.address, "BTC.price");
  // Wire: RAS address starting at 0x18A1.
  assert.equal(result.wire.addresses[0]!.ras, "0x18A1");
  assert.equal(result.wire.addresses[0]!.logical, "BTC.price");
  assert.deepEqual(result.wire.schemas, ["money"]);
});

test("codegen: event handler count++ -> count.set(count() + 1)", () => {
  const result = buildModule(COUNTER, "Counter.raptor");
  assert.match(result.browser, /"on:click": \(\) => count\.set\(count\(\) \+ 1\)/);
});

test("build: reproducible manifest + scorecard metrics", () => {
  const a = buildModule(COUNTER, "Counter.raptor");
  const b = buildModule(COUNTER, "Counter.raptor");
  assert.equal(a.manifest.inputsHash, b.manifest.inputsHash); // deterministic
  assert.equal(a.manifest.metrics.eliminated, 1);
  assert.equal(a.manifest.reproducible, true);
  assert.equal(a.manifest.engineVersion, "0.1.0");
});

test("wire: distinct and sequential RAS addresses for multiple signals", () => {
  const src = `
component Multi {
  const a = serverSignal("x.a", schema.money)
  const b = serverSignal("x.b", schema.money)
  <div><span>{a}</span><span>{b}</span></div>
}`;
  const wire = emitWireManifest(parseModule(src, "Multi.raptor"));
  assert.equal(wire.addresses[0]!.ras, "0x18A1");
  assert.equal(wire.addresses[1]!.ras, "0x18A2");
  assert.equal(wire.addresses[0]!.decoderSlot, 0);
  assert.equal(wire.addresses[1]!.decoderSlot, 1);
});

test("cache: stable key on no-op, different on edit", () => {
  const k1 = computeCacheKey({ source: COUNTER, profile: "default", target: "web" });
  const k2 = computeCacheKey({ source: COUNTER, profile: "default", target: "web" });
  const k3 = computeCacheKey({ source: COUNTER + "\n", profile: "default", target: "web" });
  const k4 = computeCacheKey({ source: COUNTER, profile: "realtime", target: "web" });
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
  assert.notEqual(k1, k4); // the profile enters the key (21.1)
});

test("cache: getOrCompute counts hits/misses", () => {
  const cache = new SemanticCache<number>();
  let calls = 0;
  const r1 = cache.getOrCompute("k", () => (calls++, 42));
  const r2 = cache.getOrCompute("k", () => (calls++, 99));
  assert.equal(r1.hit, false);
  assert.equal(r2.hit, true);
  assert.equal(r2.value, 42);
  assert.equal(calls, 1);
  assert.deepEqual(cache.stats, { hits: 1, misses: 1 });
});

test("dev HMR: local binding edit -> patch with preserved state", () => {
  const dev = new DevEngine();
  assert.equal(dev.update("Counter.raptor", COUNTER).kind, "load");
  // Edit of a binding expression (not of the structure) -> state-preserving patch.
  const patched = dev.update("Counter.raptor", COUNTER.replace("Doubled: {doubled}", "Doubled: {doubled + 0}"));
  assert.equal(patched.kind, "patch");
  assert.ok(patched.preservedSignals >= 1);
  assert.ok(patched.regeneratedBindings >= 1);
});

test("dev HMR: no-op on identical source (cache hit)", () => {
  const dev = new DevEngine();
  dev.update("Counter.raptor", COUNTER);
  const noop = dev.update("Counter.raptor", COUNTER);
  assert.equal(noop.kind, "noop");
  assert.match(formatUpdateLog(noop), /no-op: cache hit/);
});

test("dev HMR: structural change -> remount with fallback", () => {
  const dev = new DevEngine();
  dev.update("Counter.raptor", COUNTER);
  const remount = dev.update(
    "Counter.raptor",
    COUNTER.replace("<span>Doubled: {doubled}</span>", "<span>Doubled: {doubled}</span><hr />"),
  );
  assert.equal(remount.kind, "remount");
  assert.match(formatUpdateLog(remount), /fallback: remount/);
});

test("profile: realtime isolates components with server signals into a separate chunk", () => {
  const src = `
component Page { const x = state(0) <div>{x}</div> }
component Live { const p = serverSignal("BTC.price", schema.money) <div>{p}</div> }
`;
  const result = buildModule(src, "app.raptor", { config: defineConfig({ profile: "realtime" }) });
  const realtime = result.chunks.find((c) => c.kind === "realtime");
  assert.ok(realtime);
  assert.deepEqual(realtime.components, ["Live"]);
});

test("config: resolveConfig applies defaults", () => {
  const cfg = resolveConfig({ profile: "dashboard" });
  assert.equal(cfg.profile, "dashboard");
  assert.equal(cfg.target, "web");
  assert.equal(cfg.wire.enabled, true);
});
