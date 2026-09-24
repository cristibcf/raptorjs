/**
 * Regresie pentru auditul din 2026-09-24 (S5).
 *
 * Pe motorul de bootstrap, `import fs from "node:fs"` ajunge la disc fara sa
 * treaca prin capability broker. Regula era stiuta doar de `doctor`: `run`
 * pornea aplicatia in politica `production` cu manifestul gol, raporta
 * "1 capability refuzata" pentru fisierul cerut prin `raptor:files` si nu spunea
 * nicaieri ca acelasi fisier fusese citit pe cealalta cale.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/index.ts";

interface Project {
  readonly root: string;
  dispose(): void;
}

/**
 * Un proiect care cere acelasi fisier pe doua cai: prin `raptor:files` (unde e
 * refuzat) si prin `node:fs` (unde nimeni nu se uita).
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
observe.log("info", "am citit pe langa broker", { octeti: readFileSync(import.meta.filename, "utf8").length });
export const gata = true;
`;

const CURAT = `import observe from "raptor:observe";
observe.log("info", "nimic de ocolit", {});
export const gata = true;
`;

test("S5: in politica production, un import care ocoleste brokerul opreste rularea", async () => {
  const app = project("production", OCOL);
  try {
    const result = await runCli(["run", "--cwd", app.root], { cwd: app.root });
    assert.equal(result.code, 1, `ar fi trebuit sa refuze:\n${result.out}`);
    assert.match(result.out, /node:fs/);
    assert.match(result.out, /ocoleste capability broker-ul/);
    // Refuzul propune drumul corect, nu doar spune "nu".
    assert.match(result.out, /raptor:files/);
    assert.match(result.out, /--policy development/);
  } finally {
    app.dispose();
  }
});

test("S5: refuzul din production ajunge si in jurnalul de audit", async () => {
  const app = project("production", OCOL);
  try {
    await runCli(["run", "--cwd", app.root], { cwd: app.root });
    const auditPath = join(app.root, ".raptor", "audit.jsonl");
    assert.ok(existsSync(auditPath), "politica production cere jurnal de audit");

    const entries = readFileSync(auditPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { name: string; attributes: Record<string, unknown> });
    const bypass = entries.find((entry) => entry.name === "bypass");
    assert.ok(bypass, "jurnalul trebuie sa arate si accesul care a trecut pe langa poarta");
    assert.equal(bypass.attributes["specifier"], "node:fs");
    assert.equal(bypass.attributes["replacement"], "raptor:files");
  } finally {
    app.dispose();
  }
});

test("S5: in development aplicatia ruleaza, dar ocolul e raportat, nu tacut", async () => {
  const app = project("development", OCOL);
  try {
    const result = await runCli(["run", "--cwd", app.root], { cwd: app.root });
    assert.equal(result.code, 0, `development nu blocheaza portarea:\n${result.out}`);
    assert.match(result.out, /ocolesc brokerul/);
    assert.match(result.out, /node:fs/);

    const bypasses = result.data["bypasses"] as Array<{ specifier: string }>;
    assert.deepEqual(bypasses.map((item) => item.specifier), ["node:fs"]);
  } finally {
    app.dispose();
  }
});

test("S5: o aplicatie fara ocoluri nu primeste nici avertisment, nici randul in tabel", async () => {
  const app = project("production", CURAT);
  try {
    const result = await runCli(["run", "--cwd", app.root], { cwd: app.root });
    assert.equal(result.code, 0, result.out);
    assert.doesNotMatch(result.out, /ocolesc brokerul/, "nu speriem pe nimeni degeaba");
    assert.deepEqual(result.data["bypasses"], []);
  } finally {
    app.dispose();
  }
});

test("S5: doctor si run folosesc aceeasi regula", async () => {
  const app = project("production", OCOL);
  try {
    const doctor = await runCli(["doctor", "--cwd", app.root], { cwd: app.root });
    // In production ocolul e eroare si in `doctor`, nu doar avertisment.
    assert.match(doctor.out, /node:fs ocoleste capability broker-ul/);
    assert.equal(doctor.code, 1, "doctor nu poate spune 'ok' la ce run refuza");
  } finally {
    app.dispose();
  }
});
