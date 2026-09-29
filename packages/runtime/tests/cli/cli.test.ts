import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIME_VERSION } from "@raptor/runtime";
import { parseArgs, runCli } from "../../src/cli/index.ts";

function workspace(): { root: string; dispose(): void } {
  const root = mkdtempSync(join(tmpdir(), "raptor-cli-"));
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

/** Proiect creat exact ca la utilizator: prin `init`, nu scris de mana. */
async function initialized(root: string, name = "app"): Promise<string> {
  const result = await runCli(["init", name], { cwd: root });
  assert.equal(result.code, 0, result.out);
  return join(root, name);
}

test("parserul separa comanda, flagurile si argumentele aplicatiei", () => {
  const parsed = parseArgs(["run", "--policy", "production", "--json", "--", "--port", "8080"]);
  assert.equal(parsed.command, "run");
  assert.equal(parsed.flags["policy"], "production");
  assert.equal(parsed.flags["json"], true);
  assert.deepEqual(parsed.appArgs, ["--port", "8080"], "ce e dupa '--' apartine aplicatiei");
  assert.deepEqual(parsed.positionals, []);

  assert.equal(parseArgs(["init", "--cwd=/loc"]).flags["cwd"], "/loc", "forma --flag=valoare");
  assert.equal(parseArgs(["run", "--policy"]).flags["policy"], true, "un flag de valoare fara valoare ramane boolean");
});

test("--version si --help raspund fara sa atinga vreun proiect", async () => {
  const version = await runCli(["--version"], { cwd: tmpdir() });
  assert.equal(version.code, 0);
  assert.equal(version.out, RUNTIME_VERSION);

  const help = await runCli([], { cwd: tmpdir() });
  assert.equal(help.code, 0);
  assert.match(help.out, /raptor-runtime init/);
  // Lista poate creste; ce nu are voie sa dispara sunt comenzile de baza.
  const commands = help.data["commands"] as string[];
  for (const command of ["init", "run", "doctor", "test"]) {
    assert.ok(commands.includes(command), `'${command}' lipseste din lista de comenzi`);
  }
});

test("o comanda necunoscuta si un flag invalid ies cu cod de utilizare, nu cu 1", async () => {
  const command = await runCli(["zboara"], { cwd: tmpdir() });
  assert.equal(command.code, 2);
  assert.match(command.out, /comanda necunoscuta/);

  const flag = await runCli(["doctor", "--policy", "staging"], { cwd: tmpdir() });
  assert.equal(flag.code, 2);
  assert.match(flag.out, /development sau production/);
});

test("init creeaza un proiect care ruleaza imediat, si nu suprascrie nimic la a doua rulare", async () => {
  const space = workspace();
  try {
    const root = await initialized(space.root);
    const manifest = JSON.parse(readFileSync(join(root, "raptor.runtime.json"), "utf8")) as Record<string, unknown>;
    assert.equal(manifest["name"], "app");
    assert.equal(manifest["entry"], "./src/main.ts");
    assert.ok(readFileSync(join(root, "raptor.policy.json"), "utf8").includes("production"));

    const run = await runCli(["run"], { cwd: root });
    assert.equal(run.code, 0, run.out);
    assert.match(run.out, /a rulat \(politica development\)/);

    const again = await runCli(["init", "app"], { cwd: space.root });
    assert.equal(again.code, 1);
    assert.match(again.out, /nu am suprascris nimic/);
  } finally {
    space.dispose();
  }
});

test("run trece argumentele de dupa '--' aplicatiei si raporteaza diagnosticul", async () => {
  const space = workspace();
  try {
    const root = await initialized(space.root);
    writeFileSync(
      join(root, "src", "main.ts"),
      [
        'import observe from "raptor:observe";',
        'import { args } from "raptor:process";',
        "export default function main() {",
        '  observe.log("info", "app.args", { args: [...args] });',
        "}",
      ].join("\n"),
      "utf8",
    );

    const result = await runCli(["run", "--", "--port", "8080"], { cwd: root });
    assert.equal(result.code, 0, result.out);
    const diagnostics = result.data["diagnostics"] as { modules: unknown[]; tasks: { completed: number } };
    assert.ok(diagnostics.modules.length > 0);
    assert.equal(diagnostics.tasks.completed >= 1, true);
  } finally {
    space.dispose();
  }
});

test("run raporteaza o eroare a aplicatiei cu cod de iesire diferit de zero", async () => {
  const space = workspace();
  try {
    const root = await initialized(space.root);
    writeFileSync(join(root, "src", "main.ts"), 'throw new Error("crapa la pornire");', "utf8");
    const result = await runCli(["run"], { cwd: root });
    assert.equal(result.code, 1);
    assert.match(result.out, /raptor:engine\/evaluation/);
  } finally {
    space.dispose();
  }
});

test("--policy production forteaza regimul strict peste manifest", async () => {
  const space = workspace();
  try {
    const root = await initialized(space.root);
    writeFileSync(
      join(root, "src", "main.ts"),
      [
        'import { readText } from "raptor:files";',
        "export default async function main() {",
        '  await readText("./raptor.policy.json");',
        "}",
      ].join("\n"),
      "utf8",
    );

    // Manifestul generat declara doar ./src si ./raptor.runtime.json la citire.
    const permisiv = await runCli(["run"], { cwd: root });
    assert.equal(permisiv.code, 1, "nici in development citirea nedeclarata nu trece");

    const strict = await runCli(["run", "--policy", "production"], { cwd: root });
    assert.equal(strict.code, 1);
    assert.match(strict.out, /raptor:capability\//);
  } finally {
    space.dispose();
  }
});

test("doctor raporteaza un proiect sanatos fara sa execute codul aplicatiei", async () => {
  const space = workspace();
  try {
    const root = await initialized(space.root);
    writeFileSync(
      join(root, "src", "main.ts"),
      ["export default function main() {", '  throw new Error("doctor nu trebuie sa ma ruleze");', "}"].join("\n"),
      "utf8",
    );

    const result = await runCli(["doctor"], { cwd: root });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /0 erori/);
    const environment = result.data["environment"] as { runtimeVersion: string; platform: string };
    assert.equal(environment.runtimeVersion, RUNTIME_VERSION);
    assert.ok(environment.platform.includes("-"));
  } finally {
    space.dispose();
  }
});

test("doctor semnaleaza modulele de host necunoscute si ocolirea brokerului prin node:", async () => {
  const space = workspace();
  try {
    const root = await initialized(space.root);
    writeFileSync(
      join(root, "src", "main.ts"),
      ['import "raptor:teleport";', 'import "node:fs";', 'import "zod";', "export default () => undefined;"].join("\n"),
      "utf8",
    );

    const result = await runCli(["doctor"], { cwd: root });
    assert.equal(result.code, 1, "un modul de host inexistent este eroare, nu avertisment");
    const findings = result.data["findings"] as Array<{ level: string; message: string }>;
    assert.ok(findings.some((finding) => finding.level === "error" && finding.message.includes("raptor:teleport")));
    assert.ok(findings.some((finding) => finding.level === "warn" && finding.message.includes("node:fs")));
    assert.ok(findings.some((finding) => finding.level === "warn" && finding.message.includes("zod")));
  } finally {
    space.dispose();
  }
});

test("doctor explica un manifest invalid in loc sa spuna doar ca lipseste", async () => {
  const space = workspace();
  try {
    writeFileSync(join(space.root, "raptor.runtime.json"), '{ "version": 3 }', "utf8");
    const result = await runCli(["doctor"], { cwd: space.root });
    assert.equal(result.code, 1);
    const findings = result.data["findings"] as Array<{ level: string; message: string }>;
    assert.ok(findings.some((finding) => finding.message.includes("entry")));
    assert.ok(findings.some((finding) => finding.message.includes("name")));
  } finally {
    space.dispose();
  }
});

test("doctor fara proiect raporteaza lipsa manifestului, nu arunca", async () => {
  const space = workspace();
  try {
    const result = await runCli(["doctor"], { cwd: space.root });
    assert.equal(result.code, 1);
    assert.match(result.out, /raptor\.runtime\.json/);
  } finally {
    space.dispose();
  }
});

test("test descopera fisierele proiectului si raporteaza cazurile trecute si picate", async () => {
  const space = workspace();
  try {
    const root = await initialized(space.root);
    mkdirSync(join(root, "src", "parti"), { recursive: true });
    writeFileSync(
      join(root, "src", "bun.test.ts"),
      [
        "export const tests = {",
        "  aduna() {",
        '    if (1 + 1 !== 2) throw new Error("aritmetica");',
        "  },",
        "};",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(root, "src", "parti", "rau.test.ts"),
      ["export const tests = {", "  pica() {", '    throw new Error("intentionat");', "  },", "};"].join("\n"),
      "utf8",
    );

    const all = await runCli(["test"], { cwd: root });
    assert.equal(all.code, 1, "un caz picat inseamna iesire diferita de zero");
    const summary = all.data["summary"] as { total: number; failed: number };
    assert.equal(summary.total, 2);
    assert.equal(summary.failed, 1);

    const filtered = await runCli(["test", "--filter", "bun"], { cwd: root });
    assert.equal(filtered.code, 0, filtered.out);
    assert.deepEqual(filtered.data["files"], ["./src/bun.test.ts"]);

    const empty = await runCli(["test", "--filter", "nimic-pe-aici"], { cwd: root });
    assert.equal(empty.code, 1);
    assert.match(empty.out, /niciun fisier/);
  } finally {
    space.dispose();
  }
});

test("testele proiectului ruleaza sub aceleasi capabilitati ca aplicatia", async () => {
  const space = workspace();
  try {
    const root = await initialized(space.root);
    writeFileSync(
      join(root, "src", "capability.test.ts"),
      [
        'import { readText } from "raptor:files";',
        "export const tests = {",
        "  async citesteInAfaraDomeniului() {",
        '    await readText("./raptor.policy.json");',
        "  },",
        "};",
      ].join("\n"),
      "utf8",
    );

    const result = await runCli(["test", "--filter", "capability"], { cwd: root });
    assert.equal(result.code, 1);
    const cases = result.data["cases"] as Array<{ status: string; error: { code: string } | null }>;
    assert.equal(cases[0]?.status, "failed");
    assert.match(cases[0]?.error?.code ?? "", /^raptor:capability\//);
  } finally {
    space.dispose();
  }
});

test("--cwd muta comanda in alt proiect fara sa schimbe directorul procesului", async () => {
  const space = workspace();
  const before = process.cwd();
  try {
    const root = await initialized(space.root, "altundeva");
    const result = await runCli(["doctor", "--cwd", root], { cwd: tmpdir() });
    assert.equal(result.code, 0, result.out);
    assert.equal((result.data["project"] as { name: string }).name, "altundeva");
    assert.equal(process.cwd(), before);
  } finally {
    space.dispose();
  }
});
