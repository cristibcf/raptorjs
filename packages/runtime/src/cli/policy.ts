/**
 * Politici de rulare (spec sectiunea 7).
 *
 * Manifestul spune *ce* cere aplicatia; fisierul de politici spune *cum* se
 * comporta host-ul cand aplicatia cere ceva nedeclarat, si unde se scrie urma
 * auditabila. Politica de dezvoltare poate fi permisiva si zgomotoasa; cea de
 * productie este neinteractiva si auditabila.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Observer, PolicyMode, RuntimeEvent } from "@raptor/runtime";
import { normalizePath, stableStringify } from "@raptor/runtime";

export const POLICY_FILENAME = "raptor.policy.json";

export type UndeclaredBehavior = "deny" | "prompt";

export interface PolicyProfile {
  /** `prompt` cere confirmare; fara terminal interactiv degradeaza la `deny`. */
  readonly onUndeclared: UndeclaredBehavior;
  /** Cale relativa la proiect pentru jurnalul de decizii, sau `null`. */
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
 * Efectul concret al politicii asupra accesului nedeclarat.
 *
 * Confirmarea interactiva apartine host-ului nativ (are nevoie de un canal de
 * prompt propriu). In launcher, `prompt` fara terminal interactiv se comporta
 * ca `deny` si spune asta explicit, in loc sa permita tacit.
 */
export function describeUndeclared(
  profile: PolicyProfile,
  interactive: boolean,
): { readonly effective: "deny"; readonly strict: boolean; readonly note: string } {
  if (profile.onUndeclared === "deny") {
    return {
      effective: "deny",
      strict: true,
      note: "regim strict: orice acces nedeclarat este refuzat, fara domenii implicite",
    };
  }
  return {
    effective: "deny",
    strict: false,
    note: interactive
      ? "confirmarea interactiva ajunge odata cu host-ul nativ; pana atunci accesul nedeclarat este refuzat, dar radacina proiectului ramane citibila implicit"
      : "fara terminal interactiv, 'prompt' refuza accesul nedeclarat; radacina proiectului ramane citibila implicit",
  };
}

/** Jurnal de audit: o linie JSON per decizie de capability. */
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
