/**
 * Manifestul `raptor.runtime.json` (spec sectiunile 7 si 8).
 *
 * Schema este proprie Raptor, nu o clona de package.json: capabilitatile sunt
 * declarate explicit, iar dependintele poarta integritate + origine pentru
 * lockfile reproductibil. Parserul nu arunca la prima problema - aduna toate
 * erorile ca sa poata fi raportate intr-un singur diagnostic.
 */
import { RaptorError } from "./errors.ts";

export type PolicyMode = "development" | "production";

export const CAPABILITY_KINDS = [
  "files.read",
  "files.write",
  "net.connect",
  /**
   * A deschide un port de ascultare. Tinta are aceeasi forma ca `net.connect`
   * (`gazda:port`, cu `*` acceptat pe oricare parte), ca `127.0.0.1:*` sa poata
   * insemna "doar local" fara sa fixeze portul.
   *
   * Exista pentru ca `@raptor/host` cerea deja capability pentru exact aceleasi
   * metode (`serve.listen` -> `net.listen` in `packages/host/src/protocol.ts`),
   * in timp ce runtime-ul lega porturi cu manifestul gol.
   */
  "net.listen",
  "env.read",
  "process.spawn",
  "clock.real",
  "crypto.random",
] as const;

export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

/** Capabilitatile cu tinte sunt liste; cele ambientale sunt boolean. */
export type CapabilityDeclarations = {
  [K in CapabilityKind]?: K extends "clock.real" | "crypto.random" ? boolean : string[];
};

export interface ManifestDependency {
  readonly name: string;
  readonly range: string;
  /** `sha256-<base64>`; completat de `pack` daca lipseste la declarare. */
  readonly integrity?: string;
  readonly origin?: string;
}

export interface RuntimeManifest {
  readonly name: string;
  readonly version: string;
  readonly entry: string;
  readonly policy: PolicyMode;
  readonly engines: { readonly raptorRuntime: string };
  readonly capabilities: CapabilityDeclarations;
  readonly dependencies: readonly ManifestDependency[];
  readonly tasks: { readonly maxConcurrent: number; readonly defaultDeadlineMs: number | null };
}

export const MANIFEST_FILENAME = "raptor.runtime.json";

export interface ManifestIssue {
  readonly path: string;
  readonly message: string;
}

export interface ManifestParseResult {
  readonly manifest: RuntimeManifest | null;
  readonly issues: readonly ManifestIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCapabilities(raw: unknown, issues: ManifestIssue[]): CapabilityDeclarations {
  const out: Record<string, unknown> = {};
  if (raw === undefined) return out as CapabilityDeclarations;
  if (!isRecord(raw)) {
    issues.push({ path: "capabilities", message: "trebuie sa fie un obiect" });
    return out as CapabilityDeclarations;
  }

  for (const [key, value] of Object.entries(raw)) {
    if (!(CAPABILITY_KINDS as readonly string[]).includes(key)) {
      issues.push({
        path: `capabilities.${key}`,
        message: `capability necunoscuta (valide: ${CAPABILITY_KINDS.join(", ")})`,
      });
      continue;
    }
    if (key === "clock.real" || key === "crypto.random") {
      if (typeof value !== "boolean") {
        issues.push({ path: `capabilities.${key}`, message: "trebuie sa fie boolean" });
        continue;
      }
      out[key] = value;
      continue;
    }
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
      issues.push({ path: `capabilities.${key}`, message: "trebuie sa fie o lista de siruri" });
      continue;
    }
    out[key] = [...(value as string[])];
  }
  return out as CapabilityDeclarations;
}

function readDependencies(raw: unknown, issues: ManifestIssue[]): ManifestDependency[] {
  if (raw === undefined) return [];
  if (!isRecord(raw)) {
    issues.push({ path: "dependencies", message: "trebuie sa fie un obiect nume -> specificatie" });
    return [];
  }
  const out: ManifestDependency[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      out.push({ name, range: value });
      continue;
    }
    if (!isRecord(value) || typeof value["range"] !== "string") {
      issues.push({
        path: `dependencies.${name}`,
        message: "cere un sir de versiune sau { range, integrity?, origin? }",
      });
      continue;
    }
    const dep: { name: string; range: string; integrity?: string; origin?: string } = {
      name,
      range: value["range"],
    };
    if (typeof value["integrity"] === "string") dep.integrity = value["integrity"];
    if (typeof value["origin"] === "string") dep.origin = value["origin"];
    out.push(dep);
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function parseManifest(source: string): ManifestParseResult {
  const issues: ManifestIssue[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    return { manifest: null, issues: [{ path: "", message: `JSON invalid: ${(error as Error).message}` }] };
  }

  if (!isRecord(raw)) {
    return { manifest: null, issues: [{ path: "", message: "manifestul trebuie sa fie un obiect JSON" }] };
  }

  const name = typeof raw["name"] === "string" ? raw["name"] : null;
  if (!name) issues.push({ path: "name", message: "camp obligatoriu (sir)" });

  const version = typeof raw["version"] === "string" ? raw["version"] : "0.0.0";
  if (raw["version"] !== undefined && typeof raw["version"] !== "string") {
    issues.push({ path: "version", message: "trebuie sa fie un sir" });
  }

  const entry = typeof raw["entry"] === "string" ? raw["entry"] : null;
  if (!entry) issues.push({ path: "entry", message: "camp obligatoriu: modulul de pornire" });

  let policy: PolicyMode = "development";
  if (raw["policy"] !== undefined) {
    if (raw["policy"] === "development" || raw["policy"] === "production") {
      policy = raw["policy"];
    } else {
      issues.push({ path: "policy", message: "trebuie sa fie 'development' sau 'production'" });
    }
  }

  let raptorRuntime = "*";
  const engines = raw["engines"];
  if (engines !== undefined) {
    if (!isRecord(engines)) {
      issues.push({ path: "engines", message: "trebuie sa fie un obiect" });
    } else if (engines["raptorRuntime"] !== undefined) {
      if (typeof engines["raptorRuntime"] === "string") raptorRuntime = engines["raptorRuntime"];
      else issues.push({ path: "engines.raptorRuntime", message: "trebuie sa fie un sir de versiune" });
    }
  }

  const capabilities = readCapabilities(raw["capabilities"], issues);
  const dependencies = readDependencies(raw["dependencies"], issues);

  let maxConcurrent = 64;
  let defaultDeadlineMs: number | null = null;
  const tasks = raw["tasks"];
  if (tasks !== undefined) {
    if (!isRecord(tasks)) {
      issues.push({ path: "tasks", message: "trebuie sa fie un obiect" });
    } else {
      const concurrent = tasks["maxConcurrent"];
      if (concurrent !== undefined) {
        if (typeof concurrent === "number" && Number.isInteger(concurrent) && concurrent > 0) {
          maxConcurrent = concurrent;
        } else {
          issues.push({ path: "tasks.maxConcurrent", message: "trebuie sa fie un intreg pozitiv" });
        }
      }
      const deadline = tasks["defaultDeadlineMs"];
      if (deadline !== undefined && deadline !== null) {
        if (typeof deadline === "number" && deadline > 0) defaultDeadlineMs = deadline;
        else issues.push({ path: "tasks.defaultDeadlineMs", message: "trebuie sa fie un numar pozitiv sau null" });
      }
    }
  }

  if (issues.length > 0 || !name || !entry) return { manifest: null, issues };

  return {
    manifest: {
      name,
      version,
      entry,
      policy,
      engines: { raptorRuntime },
      capabilities,
      dependencies,
      tasks: { maxConcurrent, defaultDeadlineMs },
    },
    issues: [],
  };
}

/** Varianta care arunca; folosita de launcher dupa ce a raportat diagnosticele. */
export function requireManifest(source: string): RuntimeManifest {
  const result = parseManifest(source);
  if (!result.manifest) {
    throw new RaptorError("raptor:manifest/invalid", `${MANIFEST_FILENAME} este invalid`, {
      issues: result.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)),
    });
  }
  return result.manifest;
}

/** Serializare determinista (chei sortate) pentru manifest si lockfile. */
export function stableStringify(value: unknown, indent = 2): string {
  return JSON.stringify(sortValue(value), null, indent);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}
