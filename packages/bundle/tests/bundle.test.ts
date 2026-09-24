/**
 * Teste RaptorBundle: transformul JSX -> @raptor/dom, strip de tipuri, rezolvarea
 * specifierelor .ts si impachetarea unui graf real (exemplul counter) intr-un
 * bundle valid, fara Vite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { transpile, resolveSpecifier, bundleApp } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const counterEntry = join(repoRoot, "examples", "counter", "src", "main.tsx");

test("transpile: JSX -> jsx-runtime + strip de tipuri", () => {
  const out = transpile(
    `const x: number = 1;\nfunction C(){ return <button>{x}</button>; }`,
    "m.tsx",
  );
  // JSX devine apel catre runtime-ul automat din @raptor/dom.
  assert.match(out, /@raptor\/dom\/jsx-runtime/);
  assert.match(out, /jsx/);
  // Adnotarea de tip a fost stearsa.
  assert.doesNotMatch(out, /: number/);
});

test("resolveSpecifier: bare + subpath .ts, builtin -> null", () => {
  const dom = resolveSpecifier("@raptor/dom", counterEntry);
  assert.ok(dom && dom.endsWith("index.ts"));
  const jsx = resolveSpecifier("@raptor/dom/jsx-runtime", counterEntry);
  assert.ok(jsx && jsx.endsWith("jsx-runtime.ts"));
  assert.equal(resolveSpecifier("node:fs", counterEntry), null);
});

test("bundleApp: counter -> bundle valid cu registru de module", () => {
  const { code, files } = bundleApp(counterEntry);
  assert.ok(files.length >= 3, "graful include entry + @raptor/dom + @raptor/core");
  assert.match(code, /modules\[0\] =/); // entry e modulul 0
  assert.match(code, /require\(\d+\)/); // specifierele au fost rescrise la ID-uri
  assert.doesNotMatch(code, /require\("@raptor/); // niciun specifier bare ramas
  assert.doesNotMatch(code, /\bimport\s/); // totul e CommonJS impachetat
});
