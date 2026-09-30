/**
 * Plan hints - the profile-guided input into RaptorBuild (RaptorEngine
 * whitepaper 22-24). These are STRATEGY hints, not correctness hints (§24:
 * "profiles may influence strategy, not semantics"). The type lives in the
 * engine because the build consumes it; @raptorstack/profile PRODUCES it from a
 * profile + graph (no cycle).
 *
 * The golden rule: a hint may reorganize chunks/preload/batch/encoding, but it
 * may NOT eliminate code, may not change the semantic order of effects and may
 * not ignore rare routes. Elimination remains the DSE's job (static analysis, 14.1).
 */

export interface PlanHints {
  /** Groups of components placed together in one chunk (chunk folding, 16). */
  foldChunks: string[][];
  /** Routes to preload (aggressive preload for frequent ones, 16/24). */
  preloadRoutes: string[];
  /** Suggested batch size per component (from DOM mutation bursts, 22). */
  batchSizes: Record<string, number>;
  /** Wire addresses that are candidates for specialized encoding with fallback (15/24). */
  encodingSpecialization: string[];
}

export function emptyPlanHints(): PlanHints {
  return { foldChunks: [], preloadRoutes: [], batchSizes: {}, encodingSpecialization: [] };
}
