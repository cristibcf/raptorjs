import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { analyzeModule, blankRanges } from "../../src/bundle/esm-graph.ts";
import { treeshake, resetSideEffectsCache } from "../../src/bundle/treeshake.ts";
import { bundleApp } from "../../src/bundle/bundle.ts";

/* ---------------------------------------------------------- ESM analysis -- */

test("analyzeModule reads imports, local exports and re-exports", () => {
  const info = analyzeModule(
    `
    import { a, b as c } from "./x.ts";
    import def from "./y.ts";
    import * as ns from "./z.ts";
    import "./side.ts";
    export function f() {}
    export const g = 1, h = 2;
    export class K {}
    export type T = string;
    export { local } from "./re.ts";
    export * from "./star.ts";
    export * as bag from "./bag.ts";
    `,
    "m.ts",
  );

  assert.deepEqual(
    info.imports.map((i) => [i.spec, i.names.join("|"), i.namespace, i.bare]),
    [
      ["./x.ts", "a|b", false, false],
      ["./y.ts", "default", false, false],
      ["./z.ts", "", true, false],
      ["./side.ts", "", false, true],
    ],
  );
  for (const name of ["f", "g", "h", "K", "T", "local", "bag"]) {
    assert.ok(info.localExports.has(name), "missing " + name);
  }
  assert.equal(info.reExports.length, 3);
  assert.equal(info.hasTopLevelStatements, false);
});

test("analyzeModule detects top-level statements", () => {
  assert.equal(analyzeModule("export const a = 1;", "m.ts").hasTopLevelStatements, false);
  assert.equal(analyzeModule("const a = 1;\nconsole.log(a);", "m.ts").hasTopLevelStatements, true);
  assert.equal(analyzeModule("if (globalThis.x) { doStuff(); }", "m.ts").hasTopLevelStatements, true);
  // An IIFE that fills local tables is still a top-level statement.
  assert.equal(analyzeModule("(function(){})();", "m.ts").hasTopLevelStatements, true);
});

test("analyzeModule handles `export { a, b }` without `from`", () => {
  const info = analyzeModule("const a = 1, b = 2;\nexport { a, b };", "m.ts");
  assert.ok(info.localExports.has("a") && info.localExports.has("b"));
  assert.equal(info.reExports.length, 0);
});

test("blankRanges preserves the lines", () => {
  const src = "line1\nline2\nline3";
  const out = blankRanges(src, [[6, 11]]);
  assert.equal(out.split("\n").length, 3, "same number of lines");
  assert.equal(out, "line1\n     \nline3");
  assert.equal(out.length, src.length);
});

/* ----------------------------------------------------- shaking on a fake -- */

/** In-memory mini-project, so we can test the algorithm without disk. */
function fakeProject(files: Record<string, string>) {
  const read = (file: string): string => {
    const found = files[file];
    if (found === undefined) throw new Error("nonexistent file: " + file);
    return found;
  };
  const resolve = (spec: string, importer: string): string | null => {
    void importer;
    return spec in files ? spec : null;
  };
  return { read, resolve };
}

test("barrel: only the star that provides the requested symbol is followed", () => {
  const project = fakeProject({
    "entry.ts": 'import { Button } from "barrel.ts";\nexport const x = Button;',
    "barrel.ts": 'export * from "button.ts";\nexport * from "chart.ts";\nexport * from "table.ts";',
    "button.ts": "export function Button() {}",
    "chart.ts": 'import { helper } from "heavy.ts";\nexport function Chart() { return helper(); }',
    "table.ts": "export function Table() {}",
    "heavy.ts": "export function helper() {}",
  });

  const result = treeshake("entry.ts", project);
  assert.deepEqual([...result.included].sort(), ["barrel.ts", "button.ts", "entry.ts"]);
  assert.equal(result.prunedEdges, 2, "the stars to chart and table were cut");
  assert.ok(!result.included.has("heavy.ts"), "the transitive dependency disappeared too");
});

test("named re-export: only the module that has the symbol is included", () => {
  const project = fakeProject({
    "entry.ts": 'import { B } from "barrel.ts";\nexport const x = B;',
    "barrel.ts": 'export { A } from "a.ts";\nexport { B } from "b.ts";',
    "a.ts": "export function A() {}",
    "b.ts": "export function B() {}",
  });
  const result = treeshake("entry.ts", project);
  assert.ok(result.included.has("b.ts"));
  assert.ok(!result.included.has("a.ts"));
  assert.equal(result.prunedEdges, 1);
});

test("renaming at re-export follows the LOCAL name in the target", () => {
  const project = fakeProject({
    "entry.ts": 'import { Public } from "barrel.ts";\nexport const x = Public;',
    "barrel.ts": 'export { internal as Public } from "impl.ts";',
    "impl.ts": "export function internal() {}",
  });
  const result = treeshake("entry.ts", project);
  assert.ok(result.included.has("impl.ts"));
  assert.equal(result.prunedEdges, 0);
});

test("namespace import: we don't know what is used, so everything is taken", () => {
  const project = fakeProject({
    "entry.ts": 'import * as ui from "barrel.ts";\nexport const x = ui;',
    "barrel.ts": 'export * from "a.ts";\nexport * from "b.ts";',
    "a.ts": "export function A() {}",
    "b.ts": "export function B() {}",
  });
  const result = treeshake("entry.ts", project);
  assert.equal(result.included.size, 4);
  assert.equal(result.prunedEdges, 0);
});

test("bare import keeps the module: it is requested precisely for its effects", () => {
  const project = fakeProject({
    "entry.ts": 'import "polyfill.ts";\nexport const x = 1;',
    "polyfill.ts": "globalThis.foo = 1;",
  });
  const result = treeshake("entry.ts", project);
  assert.ok(result.included.has("polyfill.ts"));
});

test("a re-export to a module with side effects is NOT cut", () => {
  resetSideEffectsCache();
  const project = fakeProject({
    "entry.ts": 'import { A } from "barrel.ts";\nexport const x = A;',
    "barrel.ts": 'export * from "a.ts";\nexport * from "impure.ts";',
    "a.ts": "export function A() {}",
    // With no package.json nearby, the heuristic decides: it has statements.
    "impure.ts": 'globalThis.__installed = true;\nexport function B() {}',
  });
  const result = treeshake("entry.ts", project);
  assert.ok(result.included.has("impure.ts"), "the impure module stays in the graph");
  assert.equal(result.prunedEdges, 0);
});

test("chained barrels: the symbol is tracked through several levels", () => {
  const project = fakeProject({
    "entry.ts": 'import { Deep } from "l1.ts";\nexport const x = Deep;',
    "l1.ts": 'export * from "l2.ts";\nexport * from "noise1.ts";',
    "l2.ts": 'export * from "l3.ts";\nexport * from "noise2.ts";',
    "l3.ts": "export function Deep() {}",
    "noise1.ts": "export function N1() {}",
    "noise2.ts": "export function N2() {}",
  });
  const result = treeshake("entry.ts", project);
  assert.deepEqual([...result.included].sort(), ["entry.ts", "l1.ts", "l2.ts", "l3.ts"]);
  assert.equal(result.prunedEdges, 2);
});

test("re-export cycle: it terminates, does not hang", () => {
  const project = fakeProject({
    "entry.ts": 'import { X } from "a.ts";\nexport const y = X;',
    "a.ts": 'export * from "b.ts";\nexport function X() {}',
    "b.ts": 'export * from "a.ts";',
  });
  const result = treeshake("entry.ts", project);
  assert.ok(result.included.has("a.ts"));
});

test("symbol not found: we keep all stars, so we don't break the build", () => {
  const project = fakeProject({
    // `Type` may be a type erased during transpilation, so absent from our analysis.
    "entry.ts": 'import { Necunoscut } from "barrel.ts";\nexport const x = Necunoscut;',
    "barrel.ts": 'export * from "a.ts";\nexport * from "b.ts";',
    "a.ts": "export function A() {}",
    "b.ts": "export function B() {}",
  });
  const result = treeshake("entry.ts", project);
  assert.equal(result.included.size, 4, "conservative fallback");
  assert.equal(result.prunedEdges, 0);
});

/* ------------------------------------------------------ on disk, real -- */

function scratchProject(files: Record<string, string>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "raptor-shake-"));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("bundleApp removes the unused modules from a real barrel", () => {
  resetSideEffectsCache();
  const { dir, cleanup } = scratchProject({
    "package.json": JSON.stringify({ name: "scratch", type: "module", sideEffects: false }),
    "entry.ts": 'import { used } from "./barrel.ts";\nexport const out = used();',
    "barrel.ts": 'export * from "./used.ts";\nexport * from "./unused.ts";',
    "used.ts": 'export function used() { return "YES"; }',
    "unused.ts": 'export function unused() { return "MUST-NOT-APPEAR"; }',
  });

  try {
    const shaken = bundleApp(join(dir, "entry.ts"));
    assert.equal(shaken.files.length, 3, "entry + barrel + used");
    assert.ok(!shaken.code.includes("MUST-NOT-APPEAR"), "the unused module disappeared from the output");
    assert.ok(shaken.code.includes("YES"));
    assert.equal(shaken.shaken, 1);

    const whole = bundleApp(join(dir, "entry.ts"), { treeshake: false });
    assert.equal(whole.files.length, 4);
    assert.ok(whole.code.includes("MUST-NOT-APPEAR"), "without shaking, everything is included");
    assert.equal(whole.shaken, 0);
  } finally {
    cleanup();
  }
});

test("the pruned bundle evaluates and gives the same result as the whole one", () => {
  resetSideEffectsCache();
  const { dir, cleanup } = scratchProject({
    "package.json": JSON.stringify({ name: "scratch2", type: "module", sideEffects: false }),
    "entry.ts":
      'import { add } from "./barrel.ts";\n' +
      'globalThis.__rezultat = add(2, 3);\n',
    "barrel.ts": 'export * from "./math.ts";\nexport * from "./greu.ts";',
    "math.ts": "export function add(a: number, b: number): number { return a + b; }",
    "greu.ts": "export const TABEL = new Array(1000).fill('balast');",
  });

  try {
    for (const treeshake of [true, false]) {
      delete (globalThis as any).__rezultat;
      const { code } = bundleApp(join(dir, "entry.ts"), { treeshake });
      new Function(code)();
      assert.equal((globalThis as any).__rezultat, 5, "treeshake=" + treeshake);
    }
    delete (globalThis as any).__rezultat;
  } finally {
    cleanup();
  }
});

test("`sideEffects: false` in package.json allows cutting a module with an IIFE", () => {
  resetSideEffectsCache();
  const { dir, cleanup } = scratchProject({
    "package.json": JSON.stringify({ name: "scratch3", type: "module", sideEffects: false }),
    "entry.ts": 'import { a } from "./barrel.ts";\nexport const x = a;',
    "barrel.ts": 'export * from "./a.ts";\nexport * from "./tabele.ts";',
    "a.ts": "export const a = 1;",
    // Without the declaration in package.json, the heuristic would keep this module.
    "tabele.ts": "const T = new Uint8Array(8);\n(function(){ T[0] = 1; })();\nexport const TABEL = T;",
  });

  try {
    const result = bundleApp(join(dir, "entry.ts"));
    assert.equal(result.shaken, 1);
    assert.ok(!result.files.some((f) => f.endsWith("tabele.ts")));
  } finally {
    cleanup();
  }
});

test("without `sideEffects`, the heuristic keeps the module with an IIFE", () => {
  resetSideEffectsCache();
  const { dir, cleanup } = scratchProject({
    "package.json": JSON.stringify({ name: "scratch4", type: "module" }),
    "entry.ts": 'import { a } from "./barrel.ts";\nexport const x = a;',
    "barrel.ts": 'export * from "./a.ts";\nexport * from "./tabele.ts";',
    "a.ts": "export const a = 1;",
    "tabele.ts": "const T = new Uint8Array(8);\n(function(){ T[0] = 1; })();\nexport const TABEL = T;",
  });

  try {
    const result = bundleApp(join(dir, "entry.ts"));
    assert.equal(result.shaken, 0, "conservative: it doesn't cut what it can't prove is pure");
    assert.ok(result.files.some((f) => f.endsWith("tabele.ts")));
  } finally {
    cleanup();
  }
});
