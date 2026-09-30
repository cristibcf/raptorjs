/**
 * Runtime policies (spec section 7).
 *
 * The manifest says *what* the application requires; the policy file says *how*
 * the host behaves when the application requests something undeclared, and where
 * the auditable trail is written. The development policy can be permissive and
 * noisy; the production one is non-interactive and auditable.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Observer, PolicyMode, RuntimeEvent } from "@raptorstack/runtime";
import { normalizePath, stableStringify } from "@raptorstack/runtime";

export const POLICY_FILENAME = "raptor.policy.json";

export type UndeclaredBehavior = "deny" | "prompt";

export interface PolicyProfile {
  /** `prompt` asks for confirmation; without an interactive terminal it degrades to `deny`. */
  readonly onUndeclared: UndeclaredBehavior;
  /** Path relative to the project for the decisions log, or `null`. */
  readonly auditLog: string | null;
}

export interface PolicyFile {
  readonly development: PolicyProfile;
  readonly production: PolicyProfile;
}

export const DEFAULT_POLICY: PolicyFile = {
  development: { onUndeclared: "prompt", auditLog: null },
  production: { onUndeclared: "deny", auditLog: "./.raptor/audit.jsonl" },
};

function readProfile(raw: unknown, fallback: PolicyProfile): PolicyProfile {
  if (typeof raw !== "object" || raw === null) return fallback;
  const record = raw as Record<string, unknown>;
  const onUndeclared = record["onUndeclared"] === "prompt" ? "prompt" : record["onUndeclared"] === "deny" ? "deny" : fallback.onUndeclared;
  const auditLog = typeof record["auditLog"] === "string" ? record["auditLog"] : record["auditLog"] === null ? null : fallback.auditLog;
  return { onUndeclared, auditLog };
}

export async function loadPolicyFile(projectRoot: string): Promise<PolicyFile> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(projectRoot, POLICY_FILENAME), "utf8"));
    if (typeof raw !== "object" || raw === null) return DEFAULT_POLICY;
    const record = raw as Record<string, unknown>;
    return {
      development: readProfile(record["development"], DEFAULT_POLICY.development),
      production: readProfile(record["production"], DEFAULT_POLICY.production),
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

export function profileFor(policy: PolicyFile, mode: PolicyMode): PolicyProfile {
  return mode === "production" ? policy.production : policy.development;
}

export function renderPolicyFile(): string {
  return stableStringify(DEFAULT_POLICY) + "\n";
}

/**
 * The concrete effect of the policy on undeclared access.
 *
 * Interactive confirmation belongs to the native host (it needs its own prompt
 * channel). In the launcher, `prompt` without an interactive terminal behaves
 * like `deny` and says so explicitly, instead of allowing silently.
 */
export function describeUndeclared(
  profile: PolicyProfile,
  interactive: boolean,
): { readonly effective: "deny"; readonly strict: boolean; readonly note: string } {
  if (profile.onUndeclared === "deny") {
    return {
      effective: "deny",
      strict: true,
      note: "strict mode: any undeclared access is denied, with no implicit scopes",
    };
  }
  return {
    effective: "deny",
    strict: false,
    note: interactive
      ? "interactive confirmation arrives with the native host; until then undeclared access is denied, but the project root remains readable by default"
      : "without an interactive terminal, 'prompt' denies undeclared access; the project root remains readable by default",
  };
}

/** Audit log: one JSON line per capability decision. */
export function auditSink(events: RuntimeEvent[]): (event: RuntimeEvent) => void {
  return (event: RuntimeEvent): void => {
    if (event.kind === "capability") events.push(event);
  };
}

export async function writeAudit(observer: Observer, projectRoot: string, auditLog: string | null): Promise<string | null> {
  if (!auditLog) return null;
  const { mkdir, appendFile } = await import("node:fs/promises");
  const target = normalizePath(join(projectRoot, auditLog));
  const lines = observer
    .events()
    .filter((event) => event.kind === "capability")
    .map((event) => JSON.stringify(event))
    .join("\n");
  if (!lines) return target;
  await mkdir(normalizePath(join(target, "..")), { recursive: true });
  await appendFile(target, lines + "\n", "utf8");
  return target;
}
