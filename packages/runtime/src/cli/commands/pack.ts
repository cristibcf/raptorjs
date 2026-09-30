/**
 * `raptor-runtime pack` (spec section 4): emits a reproducible application unit,
 * with a lockfile.
 *
 * Reproducible means concretely: the same source code produces byte-for-byte the
 * same output files. That is why we never write timestamps, never rely on the
 * filesystem's traversal order and sort everything. The lockfile keeps the
 * integrity and origin of every entry (spec section 8), so that supply-chain
 * auditing is possible without rebuilding anything.
 */
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MANIFEST_FILENAME, RUNTIME_VERSION, buildStaticGraph, integrityOf, loadProject, stableStringify } from "@raptor/runtime";
import type { CommandInput, CommandResult } from "../shared.ts";
import { fail, ok, table } from "../shared.ts";

export const LOCKFILE_NAME = "raptor.lock.json";
export const BUNDLE_NAME = "raptor.bundle.json";

export async function packCommand(input: CommandInput): Promise<CommandResult> {
  const project = await loadProject(input.cwd);
  const manifest = project.manifest;
  const outputDirectory = join(project.projectRoot, typeof input.flags["out"] === "string" ? input.flags["out"] : "./dist");

  const graph = await buildStaticGraph(project.projectRoot, manifest.entry);

  const blocking = graph.unresolved.filter((problem) => !problem.specifier.startsWith("import("));
  if (blocking.length > 0) {
    return fail(
      1,
      ["cannot package: unresolved imports", ...blocking.map((p) => `  ${p.from}: ${p.specifier} - ${p.reason}`)].join("\n"),
      { unresolved: graph.unresolved },
    );
  }
  if (graph.externalImports.length > 0) {
    return fail(
      1,
      [
        "cannot package: external packages unresolved in this phase",
        ...graph.externalImports.map((name) => `  ${name} - requires the bridge to the npm registry (phase 3)`),
      ].join("\n"),
      { externalImports: graph.externalImports },
    );
  }

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(join(outputDirectory, "app"), { recursive: true });

  for (const module of graph.modules) {
    const destination = join(outputDirectory, "app", module.path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(module.absolutePath, destination);
  }

  await copyFile(join(project.projectRoot, MANIFEST_FILENAME), join(outputDirectory, MANIFEST_FILENAME));

  const lockfile = {
    lockfileVersion: 1,
    project: { name: manifest.name, version: manifest.version },
    entry: graph.entry,
    modules: graph.modules.map((module) => ({
      path: module.path,
      integrity: module.integrity,
      byteLength: module.byteLength,
      imports: module.imports,
      origin: "project",
    })),
    dependencies: manifest.dependencies.map((dependency) => ({
      name: dependency.name,
      range: dependency.range,
      integrity: dependency.integrity ?? null,
      origin: dependency.origin ?? null,
    })),
    hostModules: graph.hostImports,
  };
  const lockfileText = stableStringify(lockfile) + "\n";

  const bundle = {
    bundleVersion: 1,
    name: manifest.name,
    version: manifest.version,
    entry: `./app/${graph.entry.replace(/^\.\//, "")}`,
    policy: manifest.policy,
    engines: { raptorRuntime: manifest.engines.raptorRuntime },
    capabilities: manifest.capabilities,
    tasks: manifest.tasks,
    // The content fingerprint: depends only on the modules' paths and hashes.
    contentIntegrity: integrityOf(graph.modules.map((module) => `${module.path}${String.fromCharCode(0)}${module.integrity}`).join("\n")),
    lockfile: `./${LOCKFILE_NAME}`,
    builtWith: `raptor-runtime@${RUNTIME_VERSION}`,
  };
  const bundleText = stableStringify(bundle) + "\n";

  await writeFile(join(outputDirectory, LOCKFILE_NAME), lockfileText, "utf8");
  await writeFile(join(outputDirectory, BUNDLE_NAME), bundleText, "utf8");

  const totalBytes = graph.modules.reduce((sum, module) => sum + module.byteLength, 0);
  const out = [
    `unit packaged in ${outputDirectory}`,
    table([
      ["modules", String(graph.modules.length)],
      ["bytes", String(totalBytes)],
      ["entry", bundle.entry],
      ["host modules", graph.hostImports.join(", ") || "(none)"],
      ["integrity", bundle.contentIntegrity],
      ["lockfile", LOCKFILE_NAME],
    ]),
    ...(graph.unresolved.length > 0
      ? ["", "  warning: dynamic imports not statically resolvable:", ...graph.unresolved.map((p) => `    ${p.from}: ${p.reason}`)]
      : []),
  ].join("\n");

  return ok(out, { outputDirectory, bundle, lockfile, warnings: graph.unresolved });
}
