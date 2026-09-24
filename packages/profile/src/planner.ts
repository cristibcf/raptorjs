/**
 * Build planner profile-guided (whitepaper RaptorEngine 23, 24).
 *
 * Transforma un profil in PlanHints de STRATEGIE. Respecta linia rosie din §24
 * ("adaptive strategies, nu adaptive correctness"):
 *   PERMIS  : chunk folding pe co-usage, preload pentru routes frecvente, batch
 *             size din bursts, specializare wire cu fallback.
 *   INTERZIS: eliminarea codului nevazut, schimbarea ordinii effects, ignorarea
 *             routes rare, encoding incompatibil fara fallback.
 *
 * Ce NU e in profil e explicit PASTRAT (keptDespiteUnseen) - dovada ca profilul
 * nu poate reduce corectitudinea (23: "hint-based").
 */
import { emptyPlanHints, type PlanHints } from "@raptor/engine";
import type { RouteDef } from "@raptor/run";
import type { RaptorProfile } from "./profile.ts";

export interface PlanContext {
  routes: RouteDef[];
  components: string[];
  serverSignals: string[];
}

export interface PlanOptions {
  /** Co-usage minim pentru a fuziona doua componente intr-un chunk. */
  foldThreshold: number;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = { foldThreshold: 2 };

export interface PlanResult {
  hints: PlanHints;
  /** §24: routes/signals absente din profil, PASTRATE (nu eliminate). */
  keptDespiteUnseen: string[];
  /** Note de strategie + siguranta (explicabilitate, 27). */
  notes: string[];
}

// Union-find minimal pentru gruparea componentelor co-usate.
class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export function planFromProfile(
  profile: RaptorProfile,
  ctx: PlanContext,
  options: PlanOptions = DEFAULT_PLAN_OPTIONS,
): PlanResult {
  const hints = emptyPlanHints();
  const notes: string[] = [];

  const routeToComponent = new Map<string, string>();
  for (const r of ctx.routes) routeToComponent.set(r.path, r.component);

  // --- Chunk folding pe co-usage (PERMIS, 24) ------------------------------
  const uf = new UnionFind();
  for (const co of profile.routeCoUsage) {
    if (co.count < options.foldThreshold) continue;
    const a = routeToComponent.get(co.pair[0]);
    const b = routeToComponent.get(co.pair[1]);
    if (a && b && a !== b) uf.union(a, b);
  }
  const groups = new Map<string, string[]>();
  for (const comp of ctx.components) {
    const root = uf.find(comp);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(comp);
  }
  for (const members of groups.values()) {
    if (members.length >= 2) hints.foldChunks.push(members.sort());
  }
  if (hints.foldChunks.length > 0) {
    notes.push(`chunk folding: ${hints.foldChunks.map((g) => g.join("+")).join(", ")} (co-usage)`);
  }

  // --- Preload pentru routes frecvente (PERMIS, 24) ------------------------
  hints.preloadRoutes = [...profile.hotRoutes].sort();
  if (hints.preloadRoutes.length > 0) {
    notes.push(`preload: ${hints.preloadRoutes.join(", ")} (routes frecvente)`);
  }

  // --- Batch size din DOM mutation bursts (PERMIS, 24) ---------------------
  if (profile.domBursts.maxBatch > 1) {
    hints.batchSizes["default"] = profile.domBursts.maxBatch;
    notes.push(`batch size sugerat ${profile.domBursts.maxBatch} (din DOM bursts)`);
  }

  // --- Specializare wire cu fallback (PERMIS, 24) --------------------------
  hints.encodingSpecialization = [...profile.hotSignals].sort();
  if (hints.encodingSpecialization.length > 0) {
    notes.push(
      `encoding specializat (cu fallback compatibil): ${hints.encodingSpecialization.join(", ")}`,
    );
  }

  // --- §24 INTERZIS: ce nu e in profil ramane in output --------------------
  const seenRoutes = new Set(Object.keys(profile.routeFrequency));
  const seenSignals = new Set(Object.keys(profile.signalUpdateFrequency));
  const keptRoutes = ctx.routes.map((r) => r.path).filter((p) => !seenRoutes.has(p));
  const keptSignals = ctx.serverSignals.filter((s) => !seenSignals.has(s));
  const keptDespiteUnseen = [
    ...keptRoutes.map((r) => `route:${r}`),
    ...keptSignals.map((s) => `signal:${s}`),
  ].sort();

  notes.push(
    "corectitudine: nu elimin cod nevazut, nu schimb ordinea effects, nu ignor routes rare, encoding doar cu fallback (24)",
  );

  return { hints, keptDespiteUnseen, notes };
}
