/**
 * Suita de contract RaptorRuntime - lista de acceptanta a spike-ului
 * (spec sectiunea 14), rulata impotriva exemplului real din depozit.
 *
 * Spec-ul cere ca aceste cinci verificari sa devina suita de baza. Ele nu
 * testeaza detalii de implementare, ci comportamentul observabil al produsului:
 * ce vede cineva care instaleaza runtime-ul si ii da un proiect.
 *
 * O limitare onesta: verificarea "lansare autonoma" confirma aici ca launcher-ul
 * porneste ca proces separat si raporteaza structurat. Partea "fara Node.js
 * instalat pe masina" apartine binarului nativ si ramane criteriul de iesire al
 * milestone-ului 0 - nu poate fi demonstrata de un launcher care ruleaza in
 * bootstrap pe motorul deja prezent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { promisify } from "node:util";
import { normalizePath } from "@raptor/runtime";
import { runCli } from "../../src/cli/index.ts";

const run = promisify(execFile);

const PACKAGE_ROOT = normalizePath(join(fileURLToPath(import.meta.url), "..", "..", ".."));
const REPO_ROOT = normalizePath(join(PACKAGE_ROOT, "..", ".."));
const SPIKE_ROOT = join(REPO_ROOT, "examples", "raptor-runtime-spike");
const BINARY = join(PACKAGE_ROOT, "src", "cli", "bin.ts");

async function cli(...argv: string[]) {
  return await runCli(argv, { cwd: SPIKE_ROOT, interactive: false, waitForSignals: false });
}

/** (1) Lansare autonoma: binarul porneste singur si raporteaza structurat. */
test("verificarea 1 - launcher-ul porneste ca proces propriu si raporteaza structurat", async () => {
  const { stdout } = await run(process.execPath, [BINARY, "doctor", "--json", "--cwd", SPIKE_ROOT], {
    cwd: REPO_ROOT,
    timeout: 60_000,
  });
  const report = JSON.parse(stdout) as Record<string, Record<string, unknown>>;

  assert.equal(typeof report["environment"]!["runtimeVersion"], "string");
  assert.equal(typeof report["environment"]!["platform"], "string");
  assert.equal(report["project"]!["name"], "raptor-runtime-spike");
  assert.ok(Array.isArray(report["findings"]), "diagnosticul este structurat, nu text liber");
});

/** (2) Modul TypeScript: un singur modul local se evalueaza si isi raporteaza rezultatul. */
test("verificarea 2 - modulul TypeScript de intrare se evalueaza fara pas de compilare", async () => {
  const result = await cli("run", "--json");
  assert.equal(result.code, 0, result.out);

  const diagnostics = result.data["diagnostics"] as Record<string, Array<Record<string, unknown>>>;
  const modules = diagnostics["modules"]!;
  assert.ok(
    modules.some((module) => String(module["url"]).endsWith("src/main.ts")),
    "punctul de intrare TypeScript apare in graful de module",
  );
  assert.ok(
    modules.some((module) => module["kind"] === "raptor"),
    "modulele raptor: au fost rezolvate ca module reale",
  );
});

test("verificarea 2 - rezultatul este raportat prin diagnostice structurate", async () => {
  const events: Array<Record<string, unknown>> = [];
  const result = await cli("trace", "--json");
  assert.equal(result.code, 0, result.out);
  events.push(...((result.data["requests"] as Array<Record<string, unknown>>) ?? []));

  const spanCount = Number(result.data["spanCount"]);
  assert.ok(spanCount > 0, "rularea a produs span-uri de urmarire");
  assert.match(String(result.data["trace"]), /trace\.json$/);
});

/** (3) Refuz de permisiune: o citire in afara domeniului declarat esueaza clar. */
test("verificarea 3 - o citire in afara domeniului declarat este refuzata cu eroare clara", async () => {
  const result = await cli("run", "--json");
  const capabilities = (result.data["diagnostics"] as Record<string, Record<string, unknown>>)["capabilities"]!;
  const usage = capabilities["usage"] as Array<Record<string, unknown>>;

  const denied = usage.filter((entry) => entry["granted"] === false);
  assert.ok(denied.length > 0, "spike-ul incearca deliberat un acces nepermis");
  assert.ok(
    denied.some((entry) => entry["capability"] === "files.read"),
    "refuzul este inregistrat pe capability-ul corect",
  );
  assert.equal(result.code, 0, "aplicatia trateaza refuzul; runtime-ul nu se prabuseste");
});

/** (4) Oprire curata: dupa succes, dupa eroare si dupa anulare. */
test("verificarea 4 - oprirea este curata dupa succes, esec si anulare", async () => {
  const result = await cli("run", "--json");
  const tasks = (result.data["diagnostics"] as Record<string, Record<string, number | boolean>>)["tasks"]!;

  assert.ok(Number(tasks["completed"]) >= 1, "cel putin un task s-a terminat cu bine");
  assert.ok(Number(tasks["failed"]) >= 1, "esecul deliberat a fost inregistrat ca esec");
  assert.ok(Number(tasks["cancelled"]) >= 1, "task-ul in zbor a fost anulat la oprire");
  assert.equal(Number(tasks["active"]), 0, "nimic nu ramane in zbor dupa drenare");
});

test("verificarea 4 - binarul iese cu cod 0 dupa o oprire curata, fara sa atarne", async () => {
  // Daca oprirea ar lasa un handle deschis, apelul ar expira aici.
  const { stdout } = await run(process.execPath, [BINARY, "run", "--cwd", SPIKE_ROOT], { cwd: REPO_ROOT, timeout: 60_000 });
  assert.match(stdout, /raptor-runtime-spike/);
});

/** (5) Teste de contract: lista de acceptanta ruleaza si trece prin `raptor-runtime test`. */
test("verificarea 5 - lista de acceptanta ruleaza prin `raptor-runtime test`", async () => {
  const result = await cli("test", "--json");
  assert.equal(result.code, 0, result.out);

  const summary = result.data["summary"] as Record<string, number>;
  assert.ok(summary["total"]! >= 5, "suita de baza acopera cel putin cele cinci comportamente");
  assert.equal(summary["failed"], 0);

  const cases = result.data["cases"] as Array<Record<string, unknown>>;
  assert.ok(cases.every((item) => typeof item["durationMs"] === "number"), "raportarea este structurata, cu timpi per caz");
});

test("verificarea 5 - filtrul selecteaza un subset si ramane repetabil", async () => {
  const all = await cli("test", "--json");
  const filtered = await cli("test", "--filter", "checks", "--json");
  assert.equal(filtered.code, 0, filtered.out);
  assert.ok(
    (filtered.data["files"] as string[]).length <= (all.data["files"] as string[]).length,
    "filtrul nu poate adauga fisiere",
  );

  const again = await cli("test", "--filter", "checks", "--json");
  assert.deepEqual(
    (again.data["cases"] as Array<Record<string, unknown>>).map((item) => [item["file"], item["name"], item["status"]]),
    (filtered.data["cases"] as Array<Record<string, unknown>>).map((item) => [item["file"], item["name"], item["status"]]),
    "aceeasi suita produce acelasi rezultat la a doua rulare",
  );
});

/** Ambalarea proiectului spike ramane reproductibila (spec sectiunile 8 si 12). */
test("unitatea ambalata a spike-ului este reproductibila si poarta capabilitatile", async () => {
  const first = await cli("pack", "--out", "./.raptor/pack-test", "--json");
  assert.equal(first.code, 0, first.out);
  const second = await cli("pack", "--out", "./.raptor/pack-test", "--json");

  const bundleOf = (result: typeof first): Record<string, unknown> => result.data["bundle"] as Record<string, unknown>;
  assert.equal(bundleOf(first)["contentIntegrity"], bundleOf(second)["contentIntegrity"]);
  assert.deepEqual(bundleOf(first)["capabilities"], bundleOf(second)["capabilities"]);
  assert.equal(bundleOf(first)["policy"], "development");
});
