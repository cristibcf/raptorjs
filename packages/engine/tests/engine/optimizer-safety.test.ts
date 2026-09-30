/**
 * Regressions for audit round 3: the optimizer changing the meaning of the program.
 *
 * The context that gives them their severity: the project's thesis (whitepaper
 * §24) is "adaptive strategies, not adaptive correctness". DSE and Fusion are
 * presented as safe transformations — so a case where they change the result,
 * or emit code that throws, is a hole in the very central claim of the
 * compilation pillar.
 *
 * Every test here was first a program that compiled incorrectly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModule, exprToJs, type Expr } from "@raptor/engine/compiler";
import { optimize } from "../../src/engine/optimize.ts";
import { buildModule } from "../../src/engine/index.ts";

/** The expressions of all text bindings in a module, as JS text. */
function textBindings(module: ReturnType<typeof parseModule>): string[] {
  const out: string[] = [];
  const walk = (node: Record<string, unknown>): void => {
    if (node["kind"] === "TextBinding" && node["expr"]) {
      out.push(exprToJs(node["expr"] as Expr, new Set()));
    }
    if (Array.isArray(node["children"])) {
      for (const child of node["children"] as Array<Record<string, unknown>>) walk(child);
    }
  };
  for (const comp of module.components) walk(comp.root as unknown as Record<string, unknown>);
  return out;
}

function names(module: ReturnType<typeof parseModule>): string[] {
  return module.components.flatMap((c) => [
    ...c.signals.map((s) => s.name),
    ...c.deriveds.map((d) => d.name),
  ]);
}

/* ------------------------------------------------ U1: variable capture ------ */

test("U1: fusion does not capture a variable bound at the use site", () => {
  // `a` reads the SIGNAL `x`. At the use site, `x` is the parameter of `map`.
  // The naive substitution produced `items.map(x => x + 1)` - a different
  // program - and on top of that declared `x` as a dependency, so the binding
  // subscribed to a signal that the emitted code no longer even read.
  const module = parseModule(
    `component App {
      const x = state(1)
      const a = derived(() => x + 1)
      const b = derived(() => items.map(x => a))
      <div>{b}</div>
    }`,
    "App.raptor",
  );

  const optimized = optimize(module, { fusion: true });
  const binding = textBindings(optimized.module)[0]!;
  assert.doesNotMatch(binding, /\(x\) => \(x \+ 1\)/, `capture: ${binding}`);
  assert.ok(
    optimized.trace.some((t) => t.action === "blocked" && t.detail.includes("capture")),
    "the refusal must appear in the trace, so `inspect` can say why",
  );
});

/* ------------------------------------------------ U2: duplicating work ------ */

test("U2: fusion does not duplicate work when the consumer uses the value twice", () => {
  // A SINGLE consumer does not mean a single USE. Substituting, the expression
  // would be computed twice and it would delete the very memo that computed it once.
  const module = parseModule(
    `component App {
      const n = state(1)
      const scump = derived(() => n * n * n)
      <div>{scump + scump}</div>
    }`,
    "App.raptor",
  );

  const optimized = optimize(module, { fusion: true });
  assert.ok(names(optimized.module).includes("scump"), "the memo must survive");
  assert.equal(textBindings(optimized.module)[0], "(scump + scump)");
  assert.ok(optimized.trace.some((t) => t.action === "blocked" && t.detail.includes("duplicate")));
});

test("U2: a single use still fuses", () => {
  // The fix must not stop the optimization in the case it exists for.
  const module = parseModule(
    `component App {
      const n = state(1)
      const eticheta = derived(() => "n = " + n)
      <div>{eticheta}</div>
    }`,
    "App.raptor",
  );
  const optimized = optimize(module, { fusion: true });
  assert.ok(!names(optimized.module).includes("eticheta"), "one consumer, one use: it fuses");
});

/* ------------------------------- U4/U5: DSE and event handlers -------------- */

test("U4: a derived read only in a handler is not eliminated", () => {
  // Before: DSE deleted it (handlers were not sinks and had no read edges),
  // and the emitted code was left with a reference to a nonexistent name -
  // `ReferenceError` on the first click, from a build reported as successful.
  const built = buildModule(
    `component App {
      const count = state(0)
      const pas = derived(() => 10)
      <button on:click={count += pas}>+</button>
    }`,
    "App.raptor",
  );
  const browser = built.browser;
  assert.match(browser, /on:click/);
  assert.doesNotMatch(
    browser,
    /\bpas\b(?!\s*=)/,
    "either `pas` is declared, or it was replaced with its value - but not left dangling",
  );
  for (const nume of referintele(browser)) {
    assert.ok(declarat(browser, nume), `the emitted code uses '${nume}' without declaring it`);
  }
});

test("U5: a signal written only in a handler is not eliminated", () => {
  const built = buildModule(
    `component App {
      const vizite = state(0)
      <div><button on:click={vizite++}>numara</button><span>static</span></div>
    }`,
    "App.raptor",
  );
  const browser = built.browser;
  assert.match(browser, /const vizite = state\(0\)/, "the signal written by the handler must exist");
  assert.match(browser, /vizite\.set\(/, "and the handler does write to it");
});

test("U4/U5: a truly dead derived is still eliminated", () => {
  const built = buildModule(
    `component App {
      const n = state(1)
      const mort = derived(() => n * 999)
      <div>{n}</div>
    }`,
    "App.raptor",
  );
  assert.doesNotMatch(built.browser, /mort/, "DSE must remain useful");
});

/* ------------------------------------------------------------- helpers ----- */

/** The identifiers used in the emitted code that should be local. */
function referintele(code: string): string[] {
  const found = new Set<string>();
  for (const m of code.matchAll(/\b([a-z][A-Za-z0-9_]*)\(\)/g)) found.add(m[1]!);
  // The names that come from imports, not from the component.
  for (const nume of ["state", "derived", "effect", "createElement", "applyProps", "mountChild"]) {
    found.delete(nume);
  }
  return [...found];
}

function declarat(code: string, nume: string): boolean {
  return new RegExp(`const ${nume}\\b`).test(code);
}
