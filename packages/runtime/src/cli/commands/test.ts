/**
 * `raptor-runtime test` (spec sectiunea 4): descopera `*.test.ts` si le executa
 * cu ceasuri izolate si raportare structurata.
 *
 * Contractul unui fisier de test este minimal si propriu Raptor: modulul exporta
 * `tests` (sau un `default`) - un obiect nume -> functie. Fiecare caz primeste
 * contextul de host, deci ruleaza sub aceleasi capabilitati ca aplicatia.
 * Fiecare fisier primeste propriul runtime si propriul ceas, pornit de la zero,
 * ca timpii raportati sa nu depinda de ordinea rularii.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createObserver, createRuntime, loadProject, relativeToRoot } from "@raptor/runtime";
import type { HostContext } from "@raptor/runtime";
import { describeUndeclared, loadPolicyFile, profileFor } from "../policy.ts";
import type { CommandInput, CommandResult } from "../shared.ts";
import { fail, formatMs, fromError, ok } from "../shared.ts";

const SKIP_DIRECTORIES = new Set(["node_modules", ".git", ".raptor", "dist", "output", "tmp"]);

export interface CaseReport {
  readonly file: string;
  readonly name: string;
  readonly status: "passed" | "failed";
  readonly durationMs: number;
  readonly error: { readonly code: string; readonly message: string } | null;
}

export async function discoverTests(root: string, filter: string | null = null): Promise<string[]> {
  const found: string[] = [];

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".test.ts")) continue;
      const relative = relativeToRoot(root, full);
      if (filter && !relative.includes(filter)) continue;
      found.push(relative);
    }
  };

  await walk(root);
  return found.sort();
}

function casesFrom(namespace: Record<string, unknown>): Array<[string, (context: HostContext) => unknown]> {
  const source = (namespace["tests"] ?? namespace["default"]) as Record<string, unknown> | undefined;
  if (!source || typeof source !== "object") return [];
  return Object.entries(source)
    .filter((entry): entry is [string, (context: HostContext) => unknown] => typeof entry[1] === "function")
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

export async function testCommand(input: CommandInput): Promise<CommandResult> {
  try {
    const project = await loadProject(input.cwd);
    const mode = input.policyOverride ?? project.manifest.policy;
    const profile = profileFor(await loadPolicyFile(project.projectRoot), mode);
    const strict = describeUndeclared(profile, input.interactive).strict;

    const filter = typeof input.flags["filter"] === "string" ? input.flags["filter"] : null;
    const files = await discoverTests(project.projectRoot, filter);
    if (files.length === 0) {
      return fail(1, `niciun fisier *.test.ts in ${project.projectRoot}${filter ? ` (filtru: ${filter})` : ""}`, {
        files: [],
        cases: [],
      });
    }

    const reports: CaseReport[] = [];

    for (const file of files) {
      // Ceas izolat per fisier: pornit de la zero, independent de celelalte.
      const origin = performance.now();
      const observer = createObserver({ now: () => performance.now() - origin });
      const host = createRuntime({
        projectRoot: project.projectRoot,
        manifest: { ...project.manifest, entry: file, policy: mode },
        args: input.appArgs,
        observer,
        strict,
      });

      try {
        const started = await host.start();
        const cases = casesFrom(started.namespace);
        if (cases.length === 0) {
          reports.push({
            file,
            name: "(niciun caz exportat)",
            status: "failed",
            durationMs: 0,
            error: { code: "raptor:test/empty", message: "modulul nu exporta `tests` sau `default` cu functii" },
          });
          continue;
        }

        for (const [name, body] of cases) {
          const startedAt = performance.now();
          try {
            await host.tasks.spawn(() => body(host.context), { name: `test:${name}` });
            reports.push({ file, name, status: "passed", durationMs: performance.now() - startedAt, error: null });
          } catch (error) {
            const code = (error as { code?: string }).code ?? "raptor:test/failed";
            reports.push({
              file,
              name,
              status: "failed",
              durationMs: performance.now() - startedAt,
              error: { code, message: error instanceof Error ? error.message : String(error) },
            });
          }
        }
      } catch (error) {
        reports.push({
          file,
          name: "(incarcare modul)",
          status: "failed",
          durationMs: 0,
          error: {
            code: (error as { code?: string }).code ?? "raptor:test/load",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      } finally {
        await host.shutdown("test-complete");
      }
    }

    const failed = reports.filter((report) => report.status === "failed");
    const totalMs = reports.reduce((sum, report) => sum + report.durationMs, 0);

    const lines: string[] = [];
    let currentFile = "";
    for (const report of reports) {
      if (report.file !== currentFile) {
        currentFile = report.file;
        lines.push(`  ${currentFile}`);
      }
      lines.push(
        `    ${report.status === "passed" ? "+" : "x"} ${report.name}  ${formatMs(report.durationMs)}` +
          (report.error ? `\n        ${report.error.code}: ${report.error.message}` : ""),
      );
    }

    const summary = `${reports.length - failed.length}/${reports.length} cazuri trecute in ${formatMs(totalMs)} (${files.length} fisiere)`;
    const out = [`RaptorRuntime test - politica ${mode}${strict ? ", strict" : ""}`, ...lines, "", `  ${summary}`].join("\n");
    const data = { files, cases: reports, summary: { total: reports.length, failed: failed.length, totalMs } };

    return failed.length > 0 ? fail(1, out, data) : ok(out, data);
  } catch (error) {
    return fromError(error);
  }
}
