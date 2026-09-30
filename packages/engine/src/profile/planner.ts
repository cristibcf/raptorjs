/**
 * Profile-guided build planner (whitepaper RaptorEngine 23, 24).
 *
 * Transforms a profile into STRATEGY PlanHints. Respects the red line in §24
 * ("adaptive strategies, not adaptive correctness"):
 *   ALLOWED  : chunk folding by co-usage, preload for frequent routes, batch
 *              size from bursts, wire specialization with fallback.
 *   FORBIDDEN: eliminating unseen code, changing effect order, ignoring rare
 *              routes, incompatible encoding without fallback.
 *
 * Whatever is NOT in the profile is explicitly KEPT (keptDespiteUnseen) - proof
 * that the profile cannot reduce correctness (23: "hint-based").
 */
import { emptyPlanHints, type PlanHints } from "@raptorstack/engine";
import type { RouteDef } from "@raptorstack/engine/run";
import type { RaptorProfile } from "./profile.ts";

export interface PlanContext {
  routes: RouteDef[];
  components: string[];
  serverSignals: string[];
}

export interface PlanOptions {
  /** Minimum co-usage to merge two components into one chunk. */
  foldThreshold: number;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = { foldThreshold: 2 };

export interface PlanResult {
  hints: PlanHints;
  /** §24: routes/signals absent from the profile, KEPT (not eliminated). */
  keptDespiteUnseen: string[];
  /** Strategy + safety notes (explainability, 27). */
  notes: string[];
}

// Minimal union-find for grouping co-used components.
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

  // --- Chunk folding by co-usage (ALLOWED, 24) -----------------------------
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

  // --- Preload for frequent routes (ALLOWED, 24) ---------------------------
  hints.preloadRoutes = [...profile.hotRoutes].sort();
  if (hints.preloadRoutes.length > 0) {
    notes.push(`preload: ${hints.preloadRoutes.join(", ")} (frequent routes)`);
  }

  // --- Batch size from DOM mutation bursts (ALLOWED, 24) -------------------
  if (profile.domBursts.maxBatch > 1) {
    hints.batchSizes["default"] = profile.domBursts.maxBatch;
    notes.push(`batch size suggested ${profile.domBursts.maxBatch} (from DOM bursts)`);
  }

  // --- Wire specialization with fallback (ALLOWED, 24) ---------------------
  hints.encodingSpecialization = [...profile.hotSignals].sort();
  if (hints.encodingSpecialization.length > 0) {
    notes.push(
      `specialized encoding (with compatible fallback): ${hints.encodingSpecialization.join(", ")}`,
    );
  }

  // --- §24 FORBIDDEN: whatever is not in the profile stays in output -------
  const seenRoutes = new Set(Object.keys(profile.routeFrequency));
  const seenSignals = new Set(Object.keys(profile.signalUpdateFrequency));
  const keptRoutes = ctx.routes.map((r) => r.path).filter((p) => !seenRoutes.has(p));
  const keptSignals = ctx.serverSignals.filter((s) => !seenSignals.has(s));
  const keptDespiteUnseen = [
    ...keptRoutes.map((r) => `route:${r}`),
    ...keptSignals.map((s) => `signal:${s}`),
  ].sort();

  notes.push(
    "correctness: do not eliminate unseen code, do not change effect order, do not ignore rare routes, encoding only with fallback (24)",
  );

  return { hints, keptDespiteUnseen, notes };
}
