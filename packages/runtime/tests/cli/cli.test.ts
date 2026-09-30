import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIME_VERSION } from "@raptorstack/runtime";
import { parseArgs, runCli } from "../../src/cli/index.ts";

function workspace(): { root: string; dispose(): void } {
  const root = mkdtempSync(join(tmpdir(), "raptor-cli-"));
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

/** A project created exactly as a user would: through `init`, not written by hand. */
async function initialized(root: string, name = "app"): Promise<string> {
  const result = await runCli(["init", name], { cwd: root });
  assert.equal(result.code, 0, result.out);
  return join(root, name);
}

test("the parser separates the command, the flags and the application arguments", () => {
  const parsed = parseArgs(["run", "--policy", "production", "--json", "--", "--port", "8080"]);
  assert.equal(parsed.command, "run");
  assert.equal(parsed.flags["policy"], "production");
  assert.equal(parsed.flags["json"], true);
  assert.deepEqual(parsed.appArgs, ["--port", "8080"], "what comes after '--' belongs to the application");
  assert.deepEqual(parsed.positionals, []);

  assert.equal(parseArgs(["init", "--cwd=/loc"]).flags["cwd"], "/loc", "the --flag=value form");
  assert.equal(parseArgs(["run", "--policy"]).flags["policy"], true, "a value flag without a value stays boolean");
});

test("--version and --help answer without touching any project", async () => {
  const version = await runCli(["--version"], { cwd: tmpdir() });
  assert.equal(version.code, 0);
  assert.equal(version.out, RUNTIME_VERSION);

  const help = await runCli([], { cwd: tmpdir() });
  assert.equal(help.code, 0);
  assert.match(help.out, /raptor-runtime init/);
  // The list may grow; what must not disappear are the core commands.
  const commands = help.data["commands"] as string[];
  for (const command of ["init", "run", "doctor", "test"]) {
    assert.ok(commands.includes(command), `'${command}' is missing from the command list`);
  }
});

test("an unknown command and an invalid flag exit with a usage code, not with 1", async () => {
  const command = await runCli(["zboara"], { cwd: tmpdir() });
  assert.equal(command.code, 2);
  assert.match(command.out, /unknown command/);

  const flag = await runCli(["doctor", "--policy", "staging"], { cwd: tmpdir() });
  assert.equal(flag.code, 2);
  assert.match(flag.out, /development or production/);
});

test("init creates a project that runs immediately, and overwrites nothing on a second run", async () => {
  const space = workspace();
  try {
    const root = await initialized(space.root);
    const manifest = JSON.parse(readFileSync(join(root, "raptor.runtime.json"), "utf8")) as Record<string, unknown>;
    assert.equal(manifest["name"], "app");
    assert.equal(manifest["entry"], "./src/main.ts");
    assert.ok(readFileSync(join(root, "raptor.policy.json"), "utf8").includes("production"));

    const run = await runCli(["run"], { cwd: root });
    assert.equal(run.code, 0, run.out);
    assert.match(run.out, /ran \(policy development\)/);

    const again = await runCli(["init", "app"], { cwd: space.root });
    assert.equal(again.code, 1);
    assert.match(again.out, /nothing was overwritten/);
  } finally {
    space.dispose();
  }
});

test("run passes the arguments after '--' to the application and reports the diagnostics", async () => {
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

test("run reports an application error with a non-zero exit code", async () => {
  const space = workspace();
  try {
    const root = await initialized(space.root);
    writeFileSync(join(root, "src", "main.ts"), 'throw new Error("crashes at startup");', "utf8");
    const result = await runCli(["run"], { cwd: root });
    assert.equal(result.code, 1);
    assert.match(result.out, /raptor:engine\/evaluation/);
  } finally {
    space.dispose();
  }
});

test("--policy production forces strict mode over the manifest", async () => {
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

    // The generated manifest declares only ./src and ./raptor.runtime.json for reading.
    const permisiv = await runCli(["run"], { cwd: root });
    assert.equal(permisiv.code, 1, "not even in development does an undeclared read pass");

    const strict = await runCli(["run", "--policy", "production"], { cwd: root });
    assert.equal(strict.code, 1);
    assert.match(strict.out, /raptor:capability\//);
  } finally {
    space.dispose();
  }
});

test("doctor reports a healthy project without executing the application's code", async () => {
  const space = workspace();
  try {
    const root = await initialized(space.root);
    writeFileSync(
      join(root, "src", "main.ts"),
      ["export default function main() {", '  throw new Error("doctor must not run me");', "}"].join("\n"),
      "utf8",
    );

    const result = await runCli(["doctor"], { cwd: root });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /0 errors/);
    const environment = result.data["environment"] as { runtimeVersion: string; platform: string };
    assert.equal(environment.runtimeVersion, RUNTIME_VERSION);
    assert.ok(environment.platform.includes("-"));
  } finally {
    space.dispose();
  }
});

test("doctor flags unknown host modules and the broker bypass through node:", async () => {
  const space = workspace();
  try {
    const root = await initialized(space.root);
    writeFileSync(
      join(root, "src", "main.ts"),
      ['import "raptor:teleport";', 'import "node:fs";', 'import "zod";', "export default () => undefined;"].join("\n"),
      "utf8",
    );

    const result = await runCli(["doctor"], { cwd: root });
    assert.equal(result.code, 1, "a nonexistent host module is an error, not a warning");
    const findings = result.data["findings"] as Array<{ level: string; message: string }>;
    assert.ok(findings.some((finding) => finding.level === "error" && finding.message.includes("raptor:teleport")));
    assert.ok(findings.some((finding) => finding.level === "warn" && finding.message.includes("node:fs")));
    assert.ok(findings.some((finding) => finding.level === "warn" && finding.message.includes("zod")));
  } finally {
    space.dispose();
  }
});

test("doctor explains an invalid manifest instead of just saying it is missing", async () => {
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

test("doctor without a project reports the missing manifest, does not throw", async () => {
  const space = workspace();
  try {
    const result = await runCli(["doctor"], { cwd: space.root });
    assert.equal(result.code, 1);
    assert.match(result.out, /raptor\.runtime\.json/);
  } finally {
    space.dispose();
  }
});

test("test discovers the project's files and reports passed and failed cases", async () => {
  const space = workspace();
  try {
    const root = await initialized(space.root);
    mkdirSync(join(root, "src", "parti"), { recursive: true });
    writeFileSync(
      join(root, "src", "bun.test.ts"),
      [
        "export const tests = {",
        "  aduna() {",
        '    if (1 + 1 !== 2) throw new Error("arithmetic");',
        "  },",
        "};",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(root, "src", "parti", "rau.test.ts"),
      ["export const tests = {", "  pica() {", '    throw new Error("intentional");', "  },", "};"].join("\n"),
      "utf8",
    );

    const all = await runCli(["test"], { cwd: root });
    assert.equal(all.code, 1, "a failed case means a non-zero exit");
    const summary = all.data["summary"] as { total: number; failed: number };
    assert.equal(summary.total, 2);
    assert.equal(summary.failed, 1);

    const filtered = await runCli(["test", "--filter", "bun"], { cwd: root });
    assert.equal(filtered.code, 0, filtered.out);
    assert.deepEqual(filtered.data["files"], ["./src/bun.test.ts"]);

    const empty = await runCli(["test", "--filter", "nothing-here"], { cwd: root });
    assert.equal(empty.code, 1);
    assert.match(empty.out, /no \*\.test\.ts file/);
  } finally {
    space.dispose();
  }
});

test("the project's tests run under the same capabilities as the application", async () => {
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

test("--cwd moves the command to another project without changing the process directory", async () => {
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
