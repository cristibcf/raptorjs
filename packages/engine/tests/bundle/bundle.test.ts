/**
 * RaptorBundle tests: the JSX -> @raptor/dom transform, type stripping, resolving
 * .ts specifiers and bundling a real graph (the counter example) into a valid
 * bundle, without Vite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { transpile, resolveSpecifier, bundleApp } from "../../src/bundle/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const counterEntry = join(repoRoot, "examples", "counter", "src", "main.tsx");

test("transpile: JSX -> jsx-runtime + type stripping", () => {
  const out = transpile(
    `const x: number = 1;\nfunction C(){ return <button>{x}</button>; }`,
    "m.tsx",
  );
  // JSX becomes a call to the automatic runtime from raptorjs/dom.
  assert.match(out, /raptorjs\/dom\/jsx-runtime/);
  assert.match(out, /jsx/);
  // The type annotation was erased.
  assert.doesNotMatch(out, /: number/);
});

test("resolveSpecifier: bare + subpath .ts, builtin -> null", () => {
  const dom = resolveSpecifier("raptorjs/dom", counterEntry);
  assert.ok(dom && dom.endsWith("index.ts"));
  const jsx = resolveSpecifier("raptorjs/dom/jsx-runtime", counterEntry);
  assert.ok(jsx && jsx.endsWith("jsx-runtime.ts"));
  assert.equal(resolveSpecifier("node:fs", counterEntry), null);
});

test("bundleApp: counter -> valid bundle with a module registry", () => {
  const { code, files } = bundleApp(counterEntry);
  assert.ok(files.length >= 3, "the graph includes entry + raptorjs/dom + raptorjs (core)");
  assert.match(code, /modules\[0\] =/); // entry is module 0
  assert.match(code, /require\(\d+\)/); // the specifiers were rewritten to IDs
  assert.doesNotMatch(code, /require\("(?:@raptor|raptorjs)/); // no bare specifier left
  assert.doesNotMatch(code, /^\s*import[\s{("'*]/m); // no ES import statement left; everything is bundled CommonJS
});
