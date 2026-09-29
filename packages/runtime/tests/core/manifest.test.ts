import test from "node:test";
import assert from "node:assert/strict";
import { CAPABILITY_KINDS, parseManifest, requireManifest, stableStringify } from "../../src/core/index.ts";

const MINIMAL = JSON.stringify({ name: "app", entry: "./src/main.ts" });

test("manifestul minim cere doar nume si punct de intrare", () => {
  const { manifest, issues } = parseManifest(MINIMAL);
  assert.equal(issues.length, 0);
  assert.equal(manifest?.name, "app");
  assert.equal(manifest?.entry, "./src/main.ts");
  assert.equal(manifest?.policy, "development", "politica implicita este cea permisiva de dezvoltare");
  assert.equal(manifest?.tasks.maxConcurrent, 64);
  assert.deepEqual(manifest?.dependencies, []);
});

test("parserul aduna toate problemele intr-un singur raport, nu se opreste la prima", () => {
  const { manifest, issues } = parseManifest(
    JSON.stringify({ version: 7, policy: "staging", capabilities: { "files.teleport": ["/"] } }),
  );
  assert.equal(manifest, null);
  const paths = issues.map((issue) => issue.path).sort();
  assert.deepEqual(paths, ["capabilities.files.teleport", "entry", "name", "policy", "version"]);
});

test("capabilitatile cu tinta sunt liste, cele ambientale sunt boolean", () => {
  const good = parseManifest(
    JSON.stringify({ name: "a", entry: "./m.ts", capabilities: { "files.read": ["./src"], "clock.real": false } }),
  );
  assert.deepEqual(good.manifest?.capabilities["files.read"], ["./src"]);
  assert.equal(good.manifest?.capabilities["clock.real"], false);

  const swapped = parseManifest(
    JSON.stringify({ name: "a", entry: "./m.ts", capabilities: { "files.read": true, "clock.real": ["yes"] } }),
  );
  assert.equal(swapped.manifest, null);
  assert.equal(swapped.issues.length, 2);
});

test("fiecare capability cunoscuta este acceptata de parser", () => {
  for (const kind of CAPABILITY_KINDS) {
    const value = kind === "clock.real" || kind === "crypto.random" ? true : ["x:1"];
    const parsed = parseManifest(JSON.stringify({ name: "a", entry: "./m.ts", capabilities: { [kind]: value } }));
    assert.equal(parsed.issues.length, 0, `${kind} ar trebui sa fie valida`);
  }
});

test("dependintele accepta forma scurta si forma cu integritate, si raman sortate", () => {
  const { manifest } = parseManifest(
    JSON.stringify({
      name: "a",
      entry: "./m.ts",
      dependencies: { zod: "^3.0.0", "@acme/ui": { range: "1.2.3", integrity: "sha256-abc", origin: "https://r.example" } },
    }),
  );
  assert.deepEqual(manifest?.dependencies.map((dependency) => dependency.name), ["@acme/ui", "zod"]);
  assert.equal(manifest?.dependencies[0]?.integrity, "sha256-abc");
  assert.equal(manifest?.dependencies[1]?.integrity, undefined);
});

test("requireManifest arunca o eroare Raptor care poarta toate diagnosticele", () => {
  assert.throws(
    () => requireManifest("{}"),
    (error: unknown) => {
      const raptor = error as { code: string; detail: { issues?: string[] } };
      assert.equal(raptor.code, "raptor:manifest/invalid");
      assert.ok((raptor.detail.issues ?? []).some((issue) => issue.startsWith("entry:")));
      return true;
    },
  );
  assert.match(parseManifest("{ nu e json").issues[0]!.message, /JSON invalid/);
});

test("serializarea este determinista: aceeasi intrare, acelasi text", () => {
  const a = stableStringify({ b: 1, a: { d: [3, 2], c: true } });
  const b = stableStringify({ a: { c: true, d: [3, 2] }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{\n  "a": {\n    "c": true,\n    "d": [\n      3,\n      2\n    ]\n  },\n  "b": 1\n}');
});
