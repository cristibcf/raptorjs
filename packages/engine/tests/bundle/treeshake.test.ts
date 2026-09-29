import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { analyzeModule, blankRanges } from "../../src/bundle/esm-graph.ts";
import { treeshake, resetSideEffectsCache } from "../../src/bundle/treeshake.ts";
import { bundleApp } from "../../src/bundle/bundle.ts";

/* ---------------------------------------------------------- analiza ESM -- */

test("analyzeModule citește importuri, exporturi locale și re-exporturi", () => {
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
    assert.ok(info.localExports.has(name), "lipsește " + name);
  }
  assert.equal(info.reExports.length, 3);
  assert.equal(info.hasTopLevelStatements, false);
});

test("analyzeModule detectează instrucțiuni de nivel înalt", () => {
  assert.equal(analyzeModule("export const a = 1;", "m.ts").hasTopLevelStatements, false);
  assert.equal(analyzeModule("const a = 1;\nconsole.log(a);", "m.ts").hasTopLevelStatements, true);
  assert.equal(analyzeModule("if (globalThis.x) { doStuff(); }", "m.ts").hasTopLevelStatements, true);
  // Un IIFE care umple tabele locale e tot o instrucțiune de nivel înalt.
  assert.equal(analyzeModule("(function(){})();", "m.ts").hasTopLevelStatements, true);
});

test("analyzeModule tratează `export { a, b }` fără `from`", () => {
  const info = analyzeModule("const a = 1, b = 2;\nexport { a, b };", "m.ts");
  assert.ok(info.localExports.has("a") && info.localExports.has("b"));
  assert.equal(info.reExports.length, 0);
});

test("blankRanges păstrează liniile", () => {
  const src = "linia1\nlinia2\nlinia3";
  const out = blankRanges(src, [[7, 13]]);
  assert.equal(out.split("\n").length, 3, "același număr de linii");
  assert.equal(out, "linia1\n      \nlinia3");
  assert.equal(out.length, src.length);
});

/* ----------------------------------------------------- shaking pe fals -- */

/** Mini-proiect in memorie, ca sa testam algoritmul fara disc. */
function fakeProject(files: Record<string, string>) {
  const read = (file: string): string => {
    const found = files[file];
    if (found === undefined) throw new Error("fișier inexistent: " + file);
    return found;
  };
  const resolve = (spec: string, importer: string): string | null => {
    void importer;
    return spec in files ? spec : null;
  };
  return { read, resolve };
}

test("barrel: se urmează doar steaua care furnizează simbolul cerut", () => {
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
  assert.equal(result.prunedEdges, 2, "stelele către chart și table s-au tăiat");
  assert.ok(!result.included.has("heavy.ts"), "dependința tranzitivă a dispărut și ea");
});

test("re-export cu nume: doar modulul care are simbolul intră", () => {
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

test("redenumirea la re-export urmărește numele LOCAL din țintă", () => {
  const project = fakeProject({
    "entry.ts": 'import { Public } from "barrel.ts";\nexport const x = Public;',
    "barrel.ts": 'export { internal as Public } from "impl.ts";',
    "impl.ts": "export function internal() {}",
  });
  const result = treeshake("entry.ts", project);
  assert.ok(result.included.has("impl.ts"));
  assert.equal(result.prunedEdges, 0);
});

test("import namespace: nu știm ce se folosește, deci se ia tot", () => {
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

test("import bare păstrează modulul: e cerut tocmai pentru efecte", () => {
  const project = fakeProject({
    "entry.ts": 'import "polyfill.ts";\nexport const x = 1;',
    "polyfill.ts": "globalThis.foo = 1;",
  });
  const result = treeshake("entry.ts", project);
  assert.ok(result.included.has("polyfill.ts"));
});

test("un re-export către un modul cu efecte secundare NU se taie", () => {
  resetSideEffectsCache();
  const project = fakeProject({
    "entry.ts": 'import { A } from "barrel.ts";\nexport const x = A;',
    "barrel.ts": 'export * from "a.ts";\nexport * from "impure.ts";',
    "a.ts": "export function A() {}",
    // Fără package.json prin preajmă, euristica decide: are instrucțiuni.
    "impure.ts": 'globalThis.__installed = true;\nexport function B() {}',
  });
  const result = treeshake("entry.ts", project);
  assert.ok(result.included.has("impure.ts"), "modulul impur rămâne în graf");
  assert.equal(result.prunedEdges, 0);
});

test("barrel-uri înlănțuite: simbolul e urmărit prin mai multe niveluri", () => {
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

test("ciclu de re-exporturi: se termină, nu se blochează", () => {
  const project = fakeProject({
    "entry.ts": 'import { X } from "a.ts";\nexport const y = X;',
    "a.ts": 'export * from "b.ts";\nexport function X() {}',
    "b.ts": 'export * from "a.ts";',
  });
  const result = treeshake("entry.ts", project);
  assert.ok(result.included.has("a.ts"));
});

test("simbol negăsit: păstrăm toate stelele, ca să nu stricăm build-ul", () => {
  const project = fakeProject({
    // `Type` poate fi un tip șters la transpilare, deci absent din analiza noastră.
    "entry.ts": 'import { Necunoscut } from "barrel.ts";\nexport const x = Necunoscut;',
    "barrel.ts": 'export * from "a.ts";\nexport * from "b.ts";',
    "a.ts": "export function A() {}",
    "b.ts": "export function B() {}",
  });
  const result = treeshake("entry.ts", project);
  assert.equal(result.included.size, 4, "fallback conservator");
  assert.equal(result.prunedEdges, 0);
});

/* ------------------------------------------------------ pe disc, real -- */

function scratchProject(files: Record<string, string>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "raptor-shake-"));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("bundleApp elimină modulele nefolosite dintr-un barrel real", () => {
  resetSideEffectsCache();
  const { dir, cleanup } = scratchProject({
    "package.json": JSON.stringify({ name: "scratch", type: "module", sideEffects: false }),
    "entry.ts": 'import { used } from "./barrel.ts";\nexport const out = used();',
    "barrel.ts": 'export * from "./used.ts";\nexport * from "./unused.ts";',
    "used.ts": 'export function used() { return "DA"; }',
    "unused.ts": 'export function unused() { return "NU-TREBUIE-SA-APARA"; }',
  });

  try {
    const shaken = bundleApp(join(dir, "entry.ts"));
    assert.equal(shaken.files.length, 3, "entry + barrel + used");
    assert.ok(!shaken.code.includes("NU-TREBUIE-SA-APARA"), "modulul nefolosit a dispărut din output");
    assert.ok(shaken.code.includes("DA"));
    assert.equal(shaken.shaken, 1);

    const whole = bundleApp(join(dir, "entry.ts"), { treeshake: false });
    assert.equal(whole.files.length, 4);
    assert.ok(whole.code.includes("NU-TREBUIE-SA-APARA"), "fără shaking, intră tot");
    assert.equal(whole.shaken, 0);
  } finally {
    cleanup();
  }
});

test("bundle-ul tăiat se evaluează și dă același rezultat ca cel întreg", () => {
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

test("`sideEffects: false` din package.json permite tăierea unui modul cu IIFE", () => {
  resetSideEffectsCache();
  const { dir, cleanup } = scratchProject({
    "package.json": JSON.stringify({ name: "scratch3", type: "module", sideEffects: false }),
    "entry.ts": 'import { a } from "./barrel.ts";\nexport const x = a;',
    "barrel.ts": 'export * from "./a.ts";\nexport * from "./tabele.ts";',
    "a.ts": "export const a = 1;",
    // Fără declarația din package.json, euristica ar păstra acest modul.
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

test("fără `sideEffects`, euristica păstrează modulul cu IIFE", () => {
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
    assert.equal(result.shaken, 0, "conservator: nu taie ce nu poate dovedi că e pur");
    assert.ok(result.files.some((f) => f.endsWith("tabele.ts")));
  } finally {
    cleanup();
  }
});
