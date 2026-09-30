/**
 * Regression for the 2026-09-24 audit (S5).
 *
 * On the bootstrap engine, `import fs from "node:fs"` reaches the disk without
 * passing through the capability broker. The rule was known only to `doctor`:
 * `run` started the application under the `production` policy with an empty
 * manifest, reported "1 denied capability" for the file requested through
 * `raptor:files` and said nowhere that the same file had been read the other way.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../src/cli/index.ts";

interface Project {
  readonly root: string;
  dispose(): void;
}

/**
 * A project that requests the same file two ways: through `raptor:files` (where
 * it is denied) and through `node:fs` (where nobody looks).
 */
function project(policy: "development" | "production", entry: string): Project {
  const root = mkdtempSync(join(tmpdir(), "raptor-bypass-"));
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "raptor.runtime.json"),
    JSON.stringify(
      { name: "ocol", version: "0.0.1", entry: "./src/main.ts", policy, capabilities: {} },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  writeFileSync(join(root, "src", "main.ts"), entry, "utf8");
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

const OCOL = `import observe from "raptor:observe";
const { readFileSync } = await import("node:fs");
observe.log("info", "read around the broker", { octeti: readFileSync(import.meta.filename, "utf8").length });
export const gata = true;
`;

const CURAT = `import observe from "raptor:observe";
observe.log("info", "nothing to bypass", {});
export const gata = true;
`;

test("S5: under the production policy, an import that bypasses the broker stops the run", async () => {
  const app = project("production", OCOL);
  try {
    const result = await runCli(["run", "--cwd", app.root], { cwd: app.root });
    assert.equal(result.code, 1, `it should have denied:\n${result.out}`);
    assert.match(result.out, /node:fs/);
    assert.match(result.out, /bypasses the capability broker/);
    // The denial proposes the correct path, not just says "no".
    assert.match(result.out, /raptor:files/);
    assert.match(result.out, /--policy development/);
  } finally {
    app.dispose();
  }
});

test("S5: the production denial also reaches the audit log", async () => {
  const app = project("production", OCOL);
  try {
    await runCli(["run", "--cwd", app.root], { cwd: app.root });
    const auditPath = join(app.root, ".raptor", "audit.jsonl");
    assert.ok(existsSync(auditPath), "the production policy requires an audit log");

    const entries = readFileSync(auditPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { name: string; attributes: Record<string, unknown> });
    const bypass = entries.find((entry) => entry.name === "bypass");
    assert.ok(bypass, "the log must also show the access that slipped past the gate");
    assert.equal(bypass.attributes["specifier"], "node:fs");
    assert.equal(bypass.attributes["replacement"], "raptor:files");
  } finally {
    app.dispose();
  }
});

test("S5: in development the application runs, but the bypass is reported, not silent", async () => {
  const app = project("development", OCOL);
  try {
    const result = await runCli(["run", "--cwd", app.root], { cwd: app.root });
    assert.equal(result.code, 0, `development does not block porting:\n${result.out}`);
    assert.match(result.out, /bypass the broker/);
    assert.match(result.out, /node:fs/);

    const bypasses = result.data["bypasses"] as Array<{ specifier: string }>;
    assert.deepEqual(bypasses.map((item) => item.specifier), ["node:fs"]);
  } finally {
    app.dispose();
  }
});

test("S5: an application without bypasses gets neither a warning nor a row in the table", async () => {
  const app = project("production", CURAT);
  try {
    const result = await runCli(["run", "--cwd", app.root], { cwd: app.root });
    assert.equal(result.code, 0, result.out);
    assert.doesNotMatch(result.out, /bypass the broker/, "we do not scare anyone for nothing");
    assert.deepEqual(result.data["bypasses"], []);
  } finally {
    app.dispose();
  }
});

test("S5: doctor and run use the same rule", async () => {
  const app = project("production", OCOL);
  try {
    const doctor = await runCli(["doctor", "--cwd", app.root], { cwd: app.root });
    // In production the bypass is an error in `doctor` too, not just a warning.
    assert.match(doctor.out, /node:fs bypasses the capability broker/);
    assert.equal(doctor.code, 1, "doctor cannot say 'ok' to what run denies");
  } finally {
    app.dispose();
  }
});

/* ------------------------------------------------- runda 2 de audit ------- */

const OCOL_CALCULAT = `import observe from "raptor:observe";
// The specifier is COMPUTED, so the static graph sees no \`node:\`.
const nume = ["node", "fs"].join(":");
const fs = await import(nume);
observe.log("info", "read anyway", { octeti: fs.readFileSync(import.meta.filename, "utf8").length });
export const gata = true;
`;

const IMPORT_LIPSA = `import observe from "raptor:observe";
import "./nu-exista.ts";
observe.log("info", "does not reach here", {});
`;

test("R1: an import() with a computed specifier stops the run in production", async () => {
  // The first fix looked only at `hostImports`, and a computed specifier never
  // reaches there. The application ran in production with an empty manifest and
  // reported "0 denied capabilities" after reading what it wanted.
  const app = project("production", OCOL_CALCULAT);
  try {
    const result = await runCli(["run", "--cwd", app.root], { cwd: app.root });
    assert.equal(result.code, 1, `it should have denied:\n${result.out}`);
    assert.match(result.out, /unverifiable|cannot prove/);
    const unverifiable = result.data["unverifiable"] as Array<{ what: string }>;
    assert.ok(unverifiable.length > 0, "the report says what it could not verify");
  } finally {
    app.dispose();
  }
});

test("R1: in development it runs, but the unverifiable is reported", async () => {
  const app = project("development", OCOL_CALCULAT);
  try {
    const result = await runCli(["run", "--cwd", app.root], { cwd: app.root });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /unverifiable/);
  } finally {
    app.dispose();
  }
});

test("R2: if the graph cannot be built, production denies instead of passing", async () => {
  // `findBypasses(...).catch(() => [])` said "I found nothing" when the truth
  // was "I could not look" - that is, fail-open in exactly the strict regime.
  const app = project("production", IMPORT_LIPSA);
  try {
    const result = await runCli(["run", "--cwd", app.root], { cwd: app.root });
    assert.equal(result.code, 1, `an unbuildable graph is not proof of cleanliness:\n${result.out}`);
    assert.match(result.out, /nu-exista\.ts|static graph/);
  } finally {
    app.dispose();
  }
});

test("R1/R2: a clean application is affected by neither rule", async () => {
  const app = project("production", CURAT);
  try {
    const result = await runCli(["run", "--cwd", app.root], { cwd: app.root });
    assert.equal(result.code, 0, result.out);
    assert.deepEqual(result.data["unverifiable"], []);
    assert.deepEqual(result.data["bypasses"], []);
  } finally {
    app.dispose();
  }
});
