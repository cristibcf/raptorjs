/**
 * RaptorOracle - checks without manual assertions (whitepaper §16). A set of
 * universal + model-derived invariants finds defects even if no one wrote
 * `expect(...)`. Custom invariants (from the DSL) become first-class.
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

/** Model-derived invariant: DB twin vs UI projection (convergence). */
export interface CustomInvariant {
  name: string;
  /** true = valid. Receives the twin and the UI state, as in the §26 DSL. */
  check(args: { twin: RaptorTwin; ui: AppState }): boolean;
}

// --- Universal invariants (§16) --------------------------------------------
export const noExceptions: Invariant = {
  name: "no-uncaught-exceptions",
  check({ events }) {
    const errs = [...events.byType("exception"), ...events.byType("console-error")];
    return errs.length === 0
      ? { ok: true }
      : { ok: false, detail: `${errs.length} errors: ${JSON.stringify(errs[0]!.payload)}` };
  },
};

export const noInfiniteLoading: Invariant = {
  name: "no-infinite-loading",
  check({ ui }) {
    return ui.facts["loading"] === true
      ? { ok: false, detail: "UI left in a loading state after the network stabilized" }
      : { ok: true };
  },
};

export const BUILTIN_INVARIANTS: Invariant[] = [noExceptions, noInfiniteLoading];

export function wrapCustom(inv: CustomInvariant): Invariant {
  return {
    name: inv.name,
    check({ twin, ui }) {
      const ok = inv.check({ twin, ui });
      return ok ? { ok: true } : { ok: false, detail: `invariant "${inv.name}" violated` };
    },
  };
}

/** Run all invariants; return the first violation (or null). */
export function evaluate(invariants: Invariant[], ctx: OracleContext): { name: string; detail: string } | null {
  for (const inv of invariants) {
    const res = inv.check(ctx);
    if (!res.ok) return { name: inv.name, detail: res.detail ?? "" };
  }
  return null;
}
