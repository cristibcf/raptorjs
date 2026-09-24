/**
 * RaptorOracle - verificari fara assertions manuale (whitepaper §16). Un set de
 * invariante universale + derivate din model descopera defecte chiar daca nimeni
 * nu a scris `expect(...)`. Invariantele custom (din DSL) devin first-class.
 */
import { type EventLog } from "./probe.ts";
import { type RaptorTwin } from "./twin.ts";
import { type AppState } from "./types.ts";

export interface OracleContext {
  events: EventLog;
  twin: RaptorTwin;
  ui: AppState;
}

export interface OracleResult {
  ok: boolean;
  detail?: string;
}

export interface Invariant {
  name: string;
  check(ctx: OracleContext): OracleResult;
}

/** Invariant derivat din model: DB twin vs proiectie UI (convergenta). */
export interface CustomInvariant {
  name: string;
  /** true = valid. Primeste twin si starea UI, ca in DSL-ul din §26. */
  check(args: { twin: RaptorTwin; ui: AppState }): boolean;
}

// --- Invariante universale (§16) -------------------------------------------
export const noExceptions: Invariant = {
  name: "no-uncaught-exceptions",
  check({ events }) {
    const errs = [...events.byType("exception"), ...events.byType("console-error")];
    return errs.length === 0
      ? { ok: true }
      : { ok: false, detail: `${errs.length} erori: ${JSON.stringify(errs[0]!.payload)}` };
  },
};

export const noInfiniteLoading: Invariant = {
  name: "no-infinite-loading",
  check({ ui }) {
    return ui.facts["loading"] === true
      ? { ok: false, detail: "UI ramas in stare de loading dupa ce reteaua s-a stabilizat" }
      : { ok: true };
  },
};

export const BUILTIN_INVARIANTS: Invariant[] = [noExceptions, noInfiniteLoading];

export function wrapCustom(inv: CustomInvariant): Invariant {
  return {
    name: inv.name,
    check({ twin, ui }) {
      const ok = inv.check({ twin, ui });
      return ok ? { ok: true } : { ok: false, detail: `invariant "${inv.name}" incalcat` };
    },
  };
}

/** Ruleaza toate invariantele; intoarce prima incalcare (sau null). */
export function evaluate(invariants: Invariant[], ctx: OracleContext): { name: string; detail: string } | null {
  for (const inv of invariants) {
    const res = inv.check(ctx);
    if (!res.ok) return { name: inv.name, detail: res.detail ?? "" };
  }
  return null;
}
