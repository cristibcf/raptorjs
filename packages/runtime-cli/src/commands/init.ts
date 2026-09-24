/**
 * `raptor-runtime init` (spec sectiunea 4): genereaza un manifest minimal, un
 * fisier sursa si un fisier de politici.
 *
 * Proiectul rezultat trebuie sa ruleze imediat cu `raptor-runtime run`, fara
 * manager global de pachete si fara configuratie de compilator.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MANIFEST_FILENAME, RUNTIME_VERSION, stableStringify } from "@raptor/runtime";
import { POLICY_FILENAME, renderPolicyFile } from "../policy.ts";
import type { CommandInput, CommandResult } from "../shared.ts";
import { fail, ok, table } from "../shared.ts";

const ENTRY_SOURCE = `import { readText } from "raptor:files";
import observe from "raptor:observe";
import { args } from "raptor:process";

/**
 * Punctul de intrare al aplicatiei. Un \`export default\` este apelat de runtime
 * dupa evaluarea modulului si primeste contextul de host.
 */
export default async function main(): Promise<void> {
  const manifest: string = await readText("./${MANIFEST_FILENAME}");
  observe.log("info", "app.started", { manifestBytes: manifest.length, args: [...args] });
}
`;

const GITIGNORE = `.raptor/
dist/
`;

function manifestFor(name: string): string {
  return (
    stableStringify({
      name,
      version: "0.1.0",
      entry: "./src/main.ts",
      policy: "development",
      engines: { raptorRuntime: `>=${RUNTIME_VERSION}` },
      capabilities: {
        "files.read": ["./src", `./${MANIFEST_FILENAME}`],
        "files.write": ["./.raptor", "./dist"],
      },
      tasks: { maxConcurrent: 64, defaultDeadlineMs: null },
    }) + "\n"
  );
}

async function writeNew(path: string, contents: string): Promise<"created" | "exists"> {
  try {
    await writeFile(path, contents, { encoding: "utf8", flag: "wx" });
    return "created";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "exists";
    throw error;
  }
}

export async function initCommand(input: CommandInput): Promise<CommandResult> {
  const target = input.positionals[0] ? join(input.cwd, input.positionals[0]) : input.cwd;
  const name = (input.positionals[0] ?? target.split(/[\\/]/).filter(Boolean).pop() ?? "raptor-app")
    .split(/[\\/]/)
    .filter(Boolean)
    .pop()!;

  await mkdir(join(target, "src"), { recursive: true });

  const written: Array<{ path: string; status: string }> = [
    { path: MANIFEST_FILENAME, status: await writeNew(join(target, MANIFEST_FILENAME), manifestFor(name)) },
    { path: POLICY_FILENAME, status: await writeNew(join(target, POLICY_FILENAME), renderPolicyFile()) },
    { path: "src/main.ts", status: await writeNew(join(target, "src", "main.ts"), ENTRY_SOURCE) },
    { path: ".gitignore", status: await writeNew(join(target, ".gitignore"), GITIGNORE) },
  ];

  const created = written.filter((entry) => entry.status === "created");
  if (created.length === 0) {
    return fail(1, `proiectul exista deja in ${target}; nu am suprascris nimic`, { target, written });
  }

  const out = [
    `proiect RaptorRuntime creat in ${target}`,
    table(written.map((entry) => [entry.path, entry.status === "created" ? "creat" : "exista deja (pastrat)"] as const)),
    "",
    "  ruleaza:  raptor-runtime run",
    "  verifica: raptor-runtime doctor",
  ].join("\n");

  return ok(out, { target, name, written });
}
