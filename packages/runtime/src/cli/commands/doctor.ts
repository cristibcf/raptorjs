/**
 * `raptor-runtime doctor` (spec section 4): reports the binary's version, the
 * target platform, the project's state and capability problems.
 *
 * `doctor` never executes the application's code: it answers only from the
 * manifest, policies and static graph. That makes it safe to run on a foreign
 * project.
 */
import { MANIFEST_FILENAME, RUNTIME_VERSION, buildStaticGraph, loadProject, parseManifest } from "@raptor/runtime";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { POLICY_FILENAME, describeUndeclared, loadPolicyFile, profileFor } from "../policy.ts";
import { bypassSeverity, describeBypass, isBypass } from "../bypass.ts";
import type { CommandInput, CommandResult } from "../shared.ts";
import { fail, ok, table } from "../shared.ts";

interface Finding {
  readonly level: "ok" | "warn" | "error";
  readonly message: string;
}

/** The modules published by this runtime; anything else is unsupported. */
const KNOWN_HOST_MODULES = new Set([
  "raptor:files",
  "raptor:net",
  "raptor:process",
  "raptor:kv",
  "raptor:serve",
  "raptor:tasks",
  "raptor:observe",
  "raptor:capabilities",
]);

export async function doctorCommand(input: CommandInput): Promise<CommandResult> {
  const findings: Finding[] = [];
  const environment = {
    runtimeVersion: RUNTIME_VERSION,
    channel: "development",
    binary: "raptor-runtime",
    platform: `${process.platform}-${process.arch}`,
    engine: process.versions.v8 ?? "unknown",
  };

  let project: Awaited<ReturnType<typeof loadProject>> | null = null;
  try {
    project = await loadProject(input.cwd);
    findings.push({ level: "ok", message: `manifest found: ${project.manifestPath}` });
  } catch {
    // More useful diagnostic than "not found": says whether the file exists but is invalid.
    try {
      const source = await readFile(join(input.cwd, MANIFEST_FILENAME), "utf8");
      for (const issue of parseManifest(source).issues) {
        findings.push({ level: "error", message: `${MANIFEST_FILENAME}: ${issue.path ? issue.path + ": " : ""}${issue.message}` });
      }
    } catch {
      findings.push({ level: "error", message: `no ${MANIFEST_FILENAME} in ${input.cwd} or in the parent directories` });
    }
  }

  const payload: Record<string, unknown> = { environment, findings };

  if (project) {
    const manifest = project.manifest;
    const mode = input.policyOverride ?? manifest.policy;
    const policy = await loadPolicyFile(project.projectRoot);
    const profile = profileFor(policy, mode);
    const undeclared = describeUndeclared(profile, input.interactive);

    payload["project"] = {
      name: manifest.name,
      version: manifest.version,
      root: project.projectRoot,
      entry: manifest.entry,
      policy: mode,
    };
    payload["policy"] = { file: POLICY_FILENAME, profile, effectiveUndeclared: undeclared };

    const declared = Object.entries(manifest.capabilities);
    payload["capabilities"] = Object.fromEntries(declared);
    if (declared.length === 0) {
      findings.push({
        level: mode === "production" ? "error" : "warn",
        message: "no capability declared; in strict mode the application will not be able to read anything",
      });
    }
    if (manifest.capabilities["process.spawn"] && manifest.capabilities["process.spawn"]!.length > 0) {
      findings.push({
        level: "warn",
        message: `process.spawn is declared for: ${manifest.capabilities["process.spawn"]!.join(", ")}`,
      });
    }

    try {
      const graph = await buildStaticGraph(project.projectRoot, manifest.entry);
      payload["modules"] = {
        count: graph.modules.length,
        entry: graph.entry,
        hostImports: graph.hostImports,
        externalImports: graph.externalImports,
        unresolved: graph.unresolved,
      };
      findings.push({ level: "ok", message: `static graph: ${graph.modules.length} modules from ${graph.entry}` });

      for (const specifier of graph.hostImports) {
        if (specifier.startsWith("raptor:") && !KNOWN_HOST_MODULES.has(specifier)) {
          findings.push({ level: "error", message: `unknown host module: ${specifier}` });
        }
        if (isBypass(specifier)) {
          // Spec section 8: what depends on internals is reported as unsupported,
          // not emulated forever. `run` applies the same rule - that is why it
          // lives in `bypass.ts`, not here.
          findings.push({ level: bypassSeverity(mode), message: describeBypass(specifier).message });
        }
      }
      for (const external of graph.externalImports) {
        findings.push({ level: "warn", message: `external package '${external}': requires the npm bridge (phase 3)` });
      }
      for (const problem of graph.unresolved) {
        // The same level as a proven bypass: an import we cannot resolve does not
        // prove it does not bypass the broker, only that we cannot know.
        findings.push({
          level: bypassSeverity(mode),
          message: `${problem.from}: ${problem.specifier} - ${problem.reason} (a bypass here would not be visible)`,
        });
      }
    } catch (error) {
      findings.push({ level: "error", message: `the static graph could not be built: ${(error as Error).message}` });
    }
  }

  const errors = findings.filter((finding) => finding.level === "error");
  const warnings = findings.filter((finding) => finding.level === "warn");

  const icons: Record<Finding["level"], string> = { ok: "ok  ", warn: "warn", error: "error" };
  const out = [
    `RaptorRuntime ${environment.runtimeVersion} (${environment.channel}) - ${environment.platform}`,
    table([
      ["binary", environment.binary],
      ["engine", environment.engine],
      ["project", project ? `${project.manifest.name}@${project.manifest.version}` : "(not found)"],
      ["policy", String((payload["project"] as Record<string, unknown> | undefined)?.["policy"] ?? "-")],
    ]),
    "",
    ...findings.map((finding) => `  [${icons[finding.level]}] ${finding.message}`),
    "",
    `  ${errors.length} errors, ${warnings.length} warnings`,
  ].join("\n");

  return errors.length > 0 ? fail(1, out, payload) : ok(out, payload);
}
