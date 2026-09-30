/**
 * The `raptor.runtime.json` manifest (spec sections 7 and 8).
 *
 * The schema is Raptor's own, not a package.json clone: capabilities are
 * declared explicitly, and dependencies carry integrity + origin for a
 * reproducible lockfile. The parser does not throw at the first problem - it
 * gathers all errors so they can be reported in a single diagnostic.
 */
import { RaptorError } from "./errors.ts";

export type PolicyMode = "development" | "production";

export const CAPABILITY_KINDS = [
  "files.read",
  "files.write",
  "net.connect",
  /**
   * Opening a listening port. The target has the same shape as `net.connect`
   * (`host:port`, with `*` accepted on either side), so that `127.0.0.1:*` can
   * mean "local only" without pinning the port.
   *
   * It exists because `@raptorstack/host` already required a capability for exactly
   * the same methods (`serve.listen` -> `net.listen` in
   * `packages/host/src/protocol.ts`), while the runtime was binding ports with
   * an empty manifest.
   */
  "net.listen",
  "env.read",
  /**
   * Which environment variables the application can **set** for a child process.
   *
   * Separate from `env.read` because reading and writing are not the same thing:
   * a second audit pass showed that an application with `env.read: ["*"]` could
   * turn `process.spawn: ["git"]` into "any code" via `JAVA_TOOL_OPTIONS`,
   * `NODE_PATH`, `RUBYOPT` and others - any list of forbidden variables always
   * lags behind the inventiveness of ecosystems.
   *
   * Default: **none**. The child receives the environment filtered through
   * `env.read`, and whatever the application wants to add on top of it must be
   * declared here, by name.
   */
  "env.set",
  "process.spawn",
  "clock.real",
  "crypto.random",
] as const;

export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

/** Capabilities with targets are lists; ambient ones are boolean. */
export type CapabilityDeclarations = {
  [K in CapabilityKind]?: K extends "clock.real" | "crypto.random" ? boolean : string[];
};

export interface ManifestDependency {
  readonly name: string;
  readonly range: string;
  /** `sha256-<base64>`; filled in by `pack` if missing at declaration time. */
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
    issues.push({ path: "capabilities", message: "must be an object" });
    return out as CapabilityDeclarations;
  }

  for (const [key, value] of Object.entries(raw)) {
    if (!(CAPABILITY_KINDS as readonly string[]).includes(key)) {
      issues.push({
        path: `capabilities.${key}`,
        message: `unknown capability (valid: ${CAPABILITY_KINDS.join(", ")})`,
      });
      continue;
    }
    if (key === "clock.real" || key === "crypto.random") {
      if (typeof value !== "boolean") {
        issues.push({ path: `capabilities.${key}`, message: "must be a boolean" });
        continue;
      }
      out[key] = value;
      continue;
    }
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
      issues.push({ path: `capabilities.${key}`, message: "must be a list of strings" });
      continue;
    }
    out[key] = [...(value as string[])];
  }
  return out as CapabilityDeclarations;
}

function readDependencies(raw: unknown, issues: ManifestIssue[]): ManifestDependency[] {
  if (raw === undefined) return [];
  if (!isRecord(raw)) {
    issues.push({ path: "dependencies", message: "must be a name -> specifier object" });
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
        message: "requires a version string or { range, integrity?, origin? }",
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
    return { manifest: null, issues: [{ path: "", message: `invalid JSON: ${(error as Error).message}` }] };
  }

  if (!isRecord(raw)) {
    return { manifest: null, issues: [{ path: "", message: "the manifest must be a JSON object" }] };
  }

  const name = typeof raw["name"] === "string" ? raw["name"] : null;
  if (!name) issues.push({ path: "name", message: "required field (string)" });

  const version = typeof raw["version"] === "string" ? raw["version"] : "0.0.0";
  if (raw["version"] !== undefined && typeof raw["version"] !== "string") {
    issues.push({ path: "version", message: "must be a string" });
  }

  const entry = typeof raw["entry"] === "string" ? raw["entry"] : null;
  if (!entry) issues.push({ path: "entry", message: "required field: the startup module" });

  let policy: PolicyMode = "development";
  if (raw["policy"] !== undefined) {
    if (raw["policy"] === "development" || raw["policy"] === "production") {
      policy = raw["policy"];
    } else {
      issues.push({ path: "policy", message: "must be 'development' or 'production'" });
    }
  }

  let raptorRuntime = "*";
  const engines = raw["engines"];
  if (engines !== undefined) {
    if (!isRecord(engines)) {
      issues.push({ path: "engines", message: "must be an object" });
    } else if (engines["raptorRuntime"] !== undefined) {
      if (typeof engines["raptorRuntime"] === "string") raptorRuntime = engines["raptorRuntime"];
      else issues.push({ path: "engines.raptorRuntime", message: "must be a version string" });
    }
  }

  const capabilities = readCapabilities(raw["capabilities"], issues);
  const dependencies = readDependencies(raw["dependencies"], issues);

  let maxConcurrent = 64;
  let defaultDeadlineMs: number | null = null;
  const tasks = raw["tasks"];
  if (tasks !== undefined) {
    if (!isRecord(tasks)) {
      issues.push({ path: "tasks", message: "must be an object" });
    } else {
      const concurrent = tasks["maxConcurrent"];
      if (concurrent !== undefined) {
        if (typeof concurrent === "number" && Number.isInteger(concurrent) && concurrent > 0) {
          maxConcurrent = concurrent;
        } else {
          issues.push({ path: "tasks.maxConcurrent", message: "must be a positive integer" });
        }
      }
      const deadline = tasks["defaultDeadlineMs"];
      if (deadline !== undefined && deadline !== null) {
        if (typeof deadline === "number" && deadline > 0) defaultDeadlineMs = deadline;
        else issues.push({ path: "tasks.defaultDeadlineMs", message: "must be a positive number or null" });
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

/** The throwing variant; used by the launcher after it has reported the diagnostics. */
export function requireManifest(source: string): RuntimeManifest {
  const result = parseManifest(source);
  if (!result.manifest) {
    throw new RaptorError("raptor:manifest/invalid", `${MANIFEST_FILENAME} is invalid`, {
      issues: result.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)),
    });
  }
  return result.manifest;
}

/** Deterministic serialization (sorted keys) for manifest and lockfile. */
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
