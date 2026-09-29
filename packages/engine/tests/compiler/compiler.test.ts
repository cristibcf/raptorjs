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
  const dead = derived(() => doubled + 100) // niciun consumator -> DSE
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

test("expr: analiza reads/writes pentru update si arrow", () => {
  assert.deepEqual(analyze(parseExpression("count++")), {
    reads: ["count"],
    writes: ["count"],
    calls: [],
  });
  assert.deepEqual(analyze(parseExpression("() => x * 2")).reads, ["x"]);
  // Parametrii arrow sunt legati local, nu se raporteaza ca reads.
  assert.deepEqual(analyze(parseExpression("(v) => v + count")).reads, ["count"]);
  assert.deepEqual(analyze(parseExpression("price.toFixed(2)")).reads, ["price"]);
});

test("expr: substitutie pentru fusion", () => {
  const consumer = parseExpression("b + 1");
  const bBody = parseExpression("a * 2");
  const fused = substituteIdent(consumer, "b", bBody);
  assert.ok(fused, "substitutia simpla nu are cum sa captureze");
  assert.equal(exprToJs(fused, new Set(["a"])), "((a() * 2) + 1)");
});

test("expr: substitutia refuza cand ar captura o variabila legata", () => {
  // `a` citeste semnalul `x`; la locul folosirii, `x` e parametrul lui `map`.
  // Inlocuind naiv iese `items.map(x => x + 1)`, adica alt program.
  const consumer = parseExpression("items.map(x => a)");
  const aBody = parseExpression("x + 1");
  assert.equal(substituteIdent(consumer, "a", aBody), null);

  // Fara conflict de nume, aceeasi forma trece.
  assert.ok(substituteIdent(parseExpression("items.map(y => a)"), "a", aBody));
});

test("expr: countIdent numara doar folosirile libere", () => {
  assert.equal(countIdent(parseExpression("scump + scump"), "scump"), 2);
  assert.equal(countIdent(parseExpression("items.map(x => x + 1)"), "x"), 0, "parametrul nu e o folosire libera");
  assert.equal(countIdent(parseExpression("a.b.c"), "a"), 1);
});

test("expr: exprToJs rescrie citirile de semnale in accesori", () => {
  const e: Expr = parseExpression("count * 2 + offset");
  assert.equal(exprToJs(e, new Set(["count", "offset"])), "((count() * 2) + offset())");
});

test("parse: componenta Counter -> IR cu signals, deriveds, bindings", () => {
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
  // doubled citeste count.
  assert.deepEqual(c.deriveds[0]!.reads, ["count"]);
  // Event binding scrie count.
  const button = c.root.children.find((ch) => ch.kind === "Element" && ch.tag === "button");
  assert.ok(button && button.kind === "Element");
  assert.deepEqual(button.events[0]!.writes, ["count"]);
});

test("graph: Dead Signal Elimination gaseste derived-ul neconsumat", () => {
  const mod = parseModule(COUNTER, "Counter.raptor");
  const graph = buildGraph(mod);
  assert.deepEqual(graph.deadReactive(), ["Counter.dead"]);
  // count si doubled ajung la un sink -> live.
  const live = graph.liveNodes();
  assert.ok(live.has("Counter.count"));
  assert.ok(live.has("Counter.doubled"));
  assert.ok(!live.has("Counter.dead"));
});

test("graph: server signal produce noduri schema + address (lant wire)", () => {
  const mod = parseModule(TICKER, "Ticker.raptor");
  const graph = buildGraph(mod);
  const nodes = [...graph.nodes.values()];
  const schema = nodes.find((n) => n.kind === GraphNodeKind.Schema);
  const address = nodes.find((n) => n.kind === GraphNodeKind.Address);
  assert.equal(schema?.label, "money");
  assert.equal(address?.label, "BTC.price");
  // Fara noduri moarte: price -> formatted -> text binding.
  assert.deepEqual(graph.deadReactive(), []);
});

test("diff: schimbarea unui binding -> patch cu stare pastrata", () => {
  const oldM = parseModule(COUNTER, "Counter.raptor");
  const newM = parseModule(COUNTER.replace("Count: {count}", "Count: {count * 1}"), "Counter.raptor");
  const diff = diffModules(oldM, newM);
  const patch = diff.patches[0]!;
  assert.equal(patch.strategy, "patch");
  assert.deepEqual(patch.preservedSignals, ["Counter.count"]);
  assert.ok(patch.regeneratedBindings.length >= 1);
});

test("diff: schimbare structurala -> remount cu motiv", () => {
  const oldM = parseModule(COUNTER, "Counter.raptor");
  const newM = parseModule(
    COUNTER.replace("<span>Doubled: {doubled}</span>", "<span>Doubled: {doubled}</span><hr />"),
    "Counter.raptor",
  );
  const diff = diffModules(oldM, newM);
  const patch = diff.patches[0]!;
  assert.equal(patch.strategy, "remount");
  assert.ok(patch.fallbackReason && patch.fallbackReason.includes("structura"));
});

test("diff: fara schimbari -> niciun patch", () => {
  const oldM = parseModule(COUNTER, "Counter.raptor");
  const newM = parseModule(COUNTER, "Counter.raptor");
  const diff = diffModules(oldM, newM);
  assert.deepEqual(diff.patches, []);
});

/**
 * Regresie pentru runda 2 de audit (R8): parserul e recursiv-descendent, deci o
 * imbricare patologica dadea `RangeError: Maximum call stack size exceeded`.
 *
 * Mesajul ala arata ca s-a stricat compilatorul, cand de fapt fisierul e absurd.
 * Limita e acum o alegere, si se raporteaza ca orice alta greseala de sintaxa.
 */
test("imbricarea patologica da o eroare de parsare, nu stiva plina", () => {
  const cazuri: Array<[string, string]> = [
    ["JSX", `component App { ${"<div>".repeat(5000)}${"</div>".repeat(5000)} }`],
    ["expresii", `component App { const a = derived(() => ${"(".repeat(5000)}1${")".repeat(5000)}) }`],
  ];

  for (const [nume, sursa] of cazuri) {
    assert.throws(
      () => parseModule(sursa, "adanc.raptor"),
      (error: unknown) => {
        assert.ok(!(error instanceof RangeError), `${nume}: nu stiva, ci limita noastra`);
        assert.match((error as Error).message, /imbricat/, nume);
        return true;
      },
      nume,
    );
  }

  // Iar imbricarea obisnuita ramane neatinsa.
  const normal = parseModule(`component App { ${"<div>".repeat(20)}x${"</div>".repeat(20)} }`, "ok.raptor");
  assert.equal(normal.components.length, 1);
});

/**
 * Regresie pentru runda 3 de audit (U3): `derived(() => n++)` se compila tacut.
 *
 * Scrierile sunt emise separat de codegen (`writeToJs`), deci intr-o pozitie de
 * citire `exprToJs` le ignora - si incrementul disparea din codul emis fara ca
 * nimeni sa spuna nimic. Un `derived` e o valoare citita, nu o actiune.
 */
test("un derived care scrie e refuzat la parsare, nu compilat tacut", () => {
  for (const scriere of ["n++", "n += 1", "n = 2"]) {
    assert.throws(
      () => parseModule(`component App { const n = state(1)\n const d = derived(() => ${scriere})\n <div>{d}</div> }`, "x.raptor"),
      (error: unknown) => {
        assert.match((error as Error).message, /nu poate scrie/, scriere);
        return true;
      },
      scriere,
    );
  }

  // Un handler are voie sa scrie - acolo e locul pentru asta.
  assert.doesNotThrow(() =>
    parseModule(`component App { const n = state(1)\n <button on:click={n++}>+</button> }`, "x.raptor"),
  );
});
