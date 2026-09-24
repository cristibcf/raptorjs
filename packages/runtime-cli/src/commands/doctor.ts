/**
 * `raptor-runtime doctor` (spec sectiunea 4): raporteaza versiunea binarului,
 * platforma tinta, starea proiectului si problemele de capabilitati.
 *
 * `doctor` nu executa niciodata codul aplicatiei: raspunde doar din manifest,
 * politici si graful static. Asta il face sigur de rulat pe un proiect strain.
 */
import { MANIFEST_FILENAME, RUNTIME_VERSION, buildStaticGraph, loadProject, parseManifest } from "@raptor/runtime";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { POLICY_FILENAME, describeUndeclared, loadPolicyFile, profileFor } from "../policy.ts";
import type { CommandInput, CommandResult } from "../shared.ts";
import { fail, ok, table } from "../shared.ts";

interface Finding {
  readonly level: "ok" | "warn" | "error";
  readonly message: string;
}

/** Modulele publicate de acest runtime; orice altceva este nesuportat. */
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
    findings.push({ level: "ok", message: `manifest gasit: ${project.manifestPath}` });
  } catch {
    // Diagnostic mai util decat "nu am gasit": spune daca fisierul exista dar e invalid.
    try {
      const source = await readFile(join(input.cwd, MANIFEST_FILENAME), "utf8");
      for (const issue of parseManifest(source).issues) {
        findings.push({ level: "error", message: `${MANIFEST_FILENAME}: ${issue.path ? issue.path + ": " : ""}${issue.message}` });
      }
    } catch {
      findings.push({ level: "error", message: `niciun ${MANIFEST_FILENAME} in ${input.cwd} sau in directoarele parinte` });
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
        message: "nicio capability declarata; in regim strict aplicatia nu va putea citi nimic",
      });
    }
    if (manifest.capabilities["process.spawn"] && manifest.capabilities["process.spawn"]!.length > 0) {
      findings.push({
        level: "warn",
        message: `process.spawn este declarata pentru: ${manifest.capabilities["process.spawn"]!.join(", ")}`,
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
      findings.push({ level: "ok", message: `graf static: ${graph.modules.length} module din ${graph.entry}` });

      for (const specifier of graph.hostImports) {
        if (specifier.startsWith("raptor:") && !KNOWN_HOST_MODULES.has(specifier)) {
          findings.push({ level: "error", message: `modul de host necunoscut: ${specifier}` });
        }
        if (specifier.startsWith("node:")) {
          // Spec sectiunea 8: ce depinde de interne se raporteaza ca nesuportat,
          // nu se emuleaza la nesfarsit.
          findings.push({
            level: "warn",
            message: `${specifier} ocoleste capability broker-ul si nu va exista in host-ul nativ; foloseste echivalentul raptor:`,
          });
        }
      }
      for (const external of graph.externalImports) {
        findings.push({ level: "warn", message: `pachet extern '${external}': cere puntea npm (faza 3)` });
      }
      for (const problem of graph.unresolved) {
        findings.push({ level: "error", message: `${problem.from}: ${problem.specifier} - ${problem.reason}` });
      }
    } catch (error) {
      findings.push({ level: "error", message: `graful static nu a putut fi construit: ${(error as Error).message}` });
    }
  }

  const errors = findings.filter((finding) => finding.level === "error");
  const warnings = findings.filter((finding) => finding.level === "warn");

  const icons: Record<Finding["level"], string> = { ok: "ok  ", warn: "warn", error: "eroare" };
  const out = [
    `RaptorRuntime ${environment.runtimeVersion} (${environment.channel}) - ${environment.platform}`,
    table([
      ["binar", environment.binary],
      ["motor", environment.engine],
      ["proiect", project ? `${project.manifest.name}@${project.manifest.version}` : "(negasit)"],
      ["politica", String((payload["project"] as Record<string, unknown> | undefined)?.["policy"] ?? "-")],
    ]),
    "",
    ...findings.map((finding) => `  [${icons[finding.level]}] ${finding.message}`),
    "",
    `  ${errors.length} erori, ${warnings.length} avertismente`,
  ].join("\n");

  return errors.length > 0 ? fail(1, out, payload) : ok(out, payload);
}
