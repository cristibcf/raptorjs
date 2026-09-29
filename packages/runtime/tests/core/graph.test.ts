import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStaticGraph, integrityOf, normalizePath, scanImports } from "../../src/core/index.ts";

function fixture(files: Record<string, string>): { root: string; dispose(): void } {
  const root = normalizePath(mkdtempSync(join(tmpdir(), "raptor-graph-")));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents, "utf8");
  }
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test("scanerul gaseste importuri si reexporturi statice, si numara dinamicele", () => {
  const { specifiers, dynamicCount } = scanImports(
    [
      'import a from "./a.ts";',
      'import { b } from "./b.ts";',
      'export { c } from "./c.ts";',
      'const lazy = await import("./d.ts");',
      "const calculat = await import(numeModul);",
    ].join("\n"),
  );
  assert.deepEqual(specifiers.sort(), ["./a.ts", "./b.ts", "./c.ts", "./d.ts"]);
  assert.equal(dynamicCount, 1, "doar importul cu specificator calculat este nerezolvabil");
});

test("integritatea este un sha256 stabil peste acelasi continut", () => {
  assert.equal(integrityOf("raptor"), integrityOf("raptor"));
  assert.notEqual(integrityOf("raptor"), integrityOf("raptor "));
  assert.match(integrityOf("raptor"), /^sha256-[A-Za-z0-9+/]+=*$/);
});

test("graful parcurge tranzitiv si raporteaza cai relative stabile intre platforme", async () => {
  const files = fixture({
    "src/main.ts": 'import "./util.ts";\nimport "./adanc/nested.ts";',
    "src/util.ts": "export const x = 1;",
    "src/adanc/nested.ts": 'import "../util.ts";\nexport const y = 2;',
  });
  try {
    const graph = await buildStaticGraph(files.root, "./src/main.ts");
    assert.equal(graph.entry, "./src/main.ts");
    assert.deepEqual(
      graph.modules.map((module) => module.path),
      ["./src/adanc/nested.ts", "./src/main.ts", "./src/util.ts"],
    );
    assert.ok(graph.modules.every((module) => module.integrity.startsWith("sha256-")));
    assert.ok(graph.modules.every((module) => module.byteLength > 0));
    const nested = graph.modules.find((module) => module.path === "./src/adanc/nested.ts");
    assert.deepEqual(nested?.imports, ["./src/util.ts"], "importurile sunt normalizate fata de radacina");
  } finally {
    files.dispose();
  }
});

test("modulele de host si pachetele externe sunt separate, nu cautate pe disc", async () => {
  const files = fixture({
    "src/main.ts": ['import "raptor:files";', 'import "node:crypto";', 'import "zod";'].join("\n"),
  });
  try {
    const graph = await buildStaticGraph(files.root, "./src/main.ts");
    assert.deepEqual(graph.hostImports, ["node:crypto", "raptor:files"]);
    assert.deepEqual(graph.externalImports, ["zod"]);
    assert.equal(graph.modules.length, 1);
  } finally {
    files.dispose();
  }
});

test("un import care iese din radacina proiectului este raportat, nu inclus tacit", async () => {
  const outside = fixture({ "afara.ts": "export const x = 1;" });
  const files = fixture({ "src/main.ts": 'import "../../afara.ts";' });
  try {
    const graph = await buildStaticGraph(files.root, "./src/main.ts");
    assert.equal(graph.modules.length, 1);
    assert.equal(graph.unresolved.length, 1);
    assert.match(graph.unresolved[0]!.reason, /gasit|radacina/);
  } finally {
    files.dispose();
    outside.dispose();
  }
});

test("importul dinamic cu specificator calculat este raportat ca nerezolvabil", async () => {
  const files = fixture({ "src/main.ts": "const mod = await import(numeModul);" });
  try {
    const graph = await buildStaticGraph(files.root, "./src/main.ts");
    assert.equal(graph.unresolved.length, 1);
    assert.equal(graph.unresolved[0]!.from, "./src/main.ts");
    assert.match(graph.unresolved[0]!.reason, /dinamice/);
  } finally {
    files.dispose();
  }
});

test("ciclurile nu blocheaza parcurgerea", async () => {
  const files = fixture({
    "src/main.ts": 'import "./a.ts";',
    "src/a.ts": 'import "./b.ts";',
    "src/b.ts": 'import "./a.ts";',
  });
  try {
    const graph = await buildStaticGraph(files.root, "./src/main.ts");
    assert.equal(graph.modules.length, 3);
  } finally {
    files.dispose();
  }
});

test("un punct de intrare inexistent este o eroare Raptor, nu un graf gol", async () => {
  const files = fixture({ "src/altceva.ts": "export const x = 1;" });
  try {
    await assert.rejects(
      buildStaticGraph(files.root, "./src/main.ts"),
      (error: unknown) => (error as { code: string }).code === "raptor:module/not-found",
    );
  } finally {
    files.dispose();
  }
});
