import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseExpression,
  analyze,
  substituteIdent,
  countIdent,
  exprToJs,
  parseModule,
  buildGraph,
  diffModules,
  GraphNodeKind,
  type Expr,
} from "../../src/compiler/index.ts";

const COUNTER = `
component Counter {
  const count = state(0)
  const doubled = derived(() => count * 2)
  const dead = derived(() => doubled + 100) // no consumer -> DSE
  <div class="counter">
    <button on:click={count++}>Increment</button>
    <span>Count: {count}</span>
    <span>Doubled: {doubled}</span>
  </div>
}
`;

const TICKER = `
component Ticker {
  const price = serverSignal("BTC.price", schema.money)
  const formatted = derived(() => price.toFixed(2))
  <span class="price">{formatted}</span>
}
`;

test("expr: reads/writes analysis for update and arrow", () => {
  assert.deepEqual(analyze(parseExpression("count++")), {
    reads: ["count"],
    writes: ["count"],
    calls: [],
  });
  assert.deepEqual(analyze(parseExpression("() => x * 2")).reads, ["x"]);
  // Arrow parameters are bound locally, not reported as reads.
  assert.deepEqual(analyze(parseExpression("(v) => v + count")).reads, ["count"]);
  assert.deepEqual(analyze(parseExpression("price.toFixed(2)")).reads, ["price"]);
});

test("expr: substitution for fusion", () => {
  const consumer = parseExpression("b + 1");
  const bBody = parseExpression("a * 2");
  const fused = substituteIdent(consumer, "b", bBody);
  assert.ok(fused, "a simple substitution cannot capture");
  assert.equal(exprToJs(fused, new Set(["a"])), "((a() * 2) + 1)");
});

test("expr: substitution refuses when it would capture a bound variable", () => {
  // `a` reads the signal `x`; at the use site, `x` is map's parameter.
  // A naive substitution yields `items.map(x => x + 1)`, i.e. a different program.
  const consumer = parseExpression("items.map(x => a)");
  const aBody = parseExpression("x + 1");
  assert.equal(substituteIdent(consumer, "a", aBody), null);

  // Without a name conflict, the same shape passes.
  assert.ok(substituteIdent(parseExpression("items.map(y => a)"), "a", aBody));
});

test("expr: countIdent counts only the free uses", () => {
  assert.equal(countIdent(parseExpression("scump + scump"), "scump"), 2);
  assert.equal(countIdent(parseExpression("items.map(x => x + 1)"), "x"), 0, "the parameter is not a free use");
  assert.equal(countIdent(parseExpression("a.b.c"), "a"), 1);
});

test("expr: exprToJs rewrites signal reads into accessors", () => {
  const e: Expr = parseExpression("count * 2 + offset");
  assert.equal(exprToJs(e, new Set(["count", "offset"])), "((count() * 2) + offset())");
});

test("parse: Counter component -> IR with signals, deriveds, bindings", () => {
  const mod = parseModule(COUNTER, "Counter.raptor");
  const c = mod.components[0]!;
  assert.equal(c.name, "Counter");
  assert.deepEqual(
    c.signals.map((s) => s.name),
    ["count"],
  );
  assert.deepEqual(
    c.deriveds.map((d) => d.name),
    ["doubled", "dead"],
  );
  // doubled reads count.
  assert.deepEqual(c.deriveds[0]!.reads, ["count"]);
  // Event binding writes count.
  const button = c.root.children.find((ch) => ch.kind === "Element" && ch.tag === "button");
  assert.ok(button && button.kind === "Element");
  assert.deepEqual(button.events[0]!.writes, ["count"]);
});

test("graph: Dead Signal Elimination finds the unconsumed derived", () => {
  const mod = parseModule(COUNTER, "Counter.raptor");
  const graph = buildGraph(mod);
  assert.deepEqual(graph.deadReactive(), ["Counter.dead"]);
  // count and doubled reach a sink -> live.
  const live = graph.liveNodes();
  assert.ok(live.has("Counter.count"));
  assert.ok(live.has("Counter.doubled"));
  assert.ok(!live.has("Counter.dead"));
});

test("graph: server signal produces schema + address nodes (wire chain)", () => {
  const mod = parseModule(TICKER, "Ticker.raptor");
  const graph = buildGraph(mod);
  const nodes = [...graph.nodes.values()];
  const schema = nodes.find((n) => n.kind === GraphNodeKind.Schema);
  const address = nodes.find((n) => n.kind === GraphNodeKind.Address);
  assert.equal(schema?.label, "money");
  assert.equal(address?.label, "BTC.price");
  // No dead nodes: price -> formatted -> text binding.
  assert.deepEqual(graph.deadReactive(), []);
});

test("diff: changing a binding -> patch with preserved state", () => {
  const oldM = parseModule(COUNTER, "Counter.raptor");
  const newM = parseModule(COUNTER.replace("Count: {count}", "Count: {count * 1}"), "Counter.raptor");
  const diff = diffModules(oldM, newM);
  const patch = diff.patches[0]!;
  assert.equal(patch.strategy, "patch");
  assert.deepEqual(patch.preservedSignals, ["Counter.count"]);
  assert.ok(patch.regeneratedBindings.length >= 1);
});

test("diff: structural change -> remount with a reason", () => {
  const oldM = parseModule(COUNTER, "Counter.raptor");
  const newM = parseModule(
    COUNTER.replace("<span>Doubled: {doubled}</span>", "<span>Doubled: {doubled}</span><hr />"),
    "Counter.raptor",
  );
  const diff = diffModules(oldM, newM);
  const patch = diff.patches[0]!;
  assert.equal(patch.strategy, "remount");
  assert.ok(patch.fallbackReason && patch.fallbackReason.includes("structure"));
});

test("diff: no changes -> no patch", () => {
  const oldM = parseModule(COUNTER, "Counter.raptor");
  const newM = parseModule(COUNTER, "Counter.raptor");
  const diff = diffModules(oldM, newM);
  assert.deepEqual(diff.patches, []);
});

/**
 * Regression for audit round 2 (R8): the parser is recursive-descent, so a
 * pathological nesting gave `RangeError: Maximum call stack size exceeded`.
 *
 * That message looks like the compiler broke, when in fact the file is absurd.
 * The limit is now a choice, and is reported like any other syntax mistake.
 */
test("pathological nesting gives a parse error, not a full stack", () => {
  const cazuri: Array<[string, string]> = [
    ["JSX", `component App { ${"<div>".repeat(5000)}${"</div>".repeat(5000)} }`],
    ["expressions", `component App { const a = derived(() => ${"(".repeat(5000)}1${")".repeat(5000)}) }`],
  ];

  for (const [nume, sursa] of cazuri) {
    assert.throws(
      () => parseModule(sursa, "adanc.raptor"),
      (error: unknown) => {
        assert.ok(!(error instanceof RangeError), `${nume}: not the stack, but our own limit`);
        assert.match((error as Error).message, /nested/, nume);
        return true;
      },
      nume,
    );
  }

  // And ordinary nesting stays untouched.
  const normal = parseModule(`component App { ${"<div>".repeat(20)}x${"</div>".repeat(20)} }`, "ok.raptor");
  assert.equal(normal.components.length, 1);
});

/**
 * Regression for audit round 3 (U3): `derived(() => n++)` compiled silently.
 *
 * Writes are emitted separately by codegen (`writeToJs`), so in a read position
 * `exprToJs` ignores them - and the increment disappeared from the emitted code
 * without anyone saying a word. A `derived` is a read value, not an action.
 */
test("a derived that writes is rejected at parse time, not compiled silently", () => {
  for (const scriere of ["n++", "n += 1", "n = 2"]) {
    assert.throws(
      () => parseModule(`component App { const n = state(1)\n const d = derived(() => ${scriere})\n <div>{d}</div> }`, "x.raptor"),
      (error: unknown) => {
        assert.match((error as Error).message, /cannot write/, scriere);
        return true;
      },
      scriere,
    );
  }

  // A handler is allowed to write - that is the place for it.
  assert.doesNotThrow(() =>
    parseModule(`component App { const n = state(1)\n <button on:click={n++}>+</button> }`, "x.raptor"),
  );
});
