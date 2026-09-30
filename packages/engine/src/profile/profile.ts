/**
 * RaptorProfile - the telemetry artifact (whitepaper RaptorEngine 22).
 *
 * Measures TECHNICAL behaviors (update frequency, fan-out, routes, co-usage,
 * wire payload, DOM bursts), not personal data (22: "the goal is to measure
 * technical behaviors"). It is an OPTIONAL input for the build planner;
 * correctness does not depend on it (24).
 */
import { canonicalize } from "@raptor/engine/compiler";

export interface WirePayloadStat {
  address: string;
  samples: number;
  totalBytes: number;
  avgBytes: number;
}

export interface RouteCoUsage {
  pair: [string, string];
  count: number;
}

export interface RaptorProfile {
  version: string;
  scenarios: number;
  /** address -> number of updates (signal update frequency, 22). */
  signalUpdateFrequency: Record<string, number>;
  /** derived nodeId -> number of consumers (static derived fan-out, 22). */
  derivedFanOut: Record<string, number>;
  /** path -> number of visits (route frequency, 22). */
  routeFrequency: Record<string, number>;
  /** pairs of routes visited together (chunk co-usage, 22). */
  routeCoUsage: RouteCoUsage[];
  /** wire payload distribution per address (encoding specialization, 22). */
  wirePayload: WirePayloadStat[];
  /** DOM mutation bursts (batch sizing, 22). */
  domBursts: { count: number; maxBatch: number; totalMutations: number };
  /** derived: signals/routes hot above threshold (hot vs cold paths, 22). */
  hotSignals: string[];
  hotRoutes: string[];
}

export const PROFILE_VERSION = "0.1.0";

export function emptyProfile(): RaptorProfile {
  return {
    version: PROFILE_VERSION,
    scenarios: 0,
    signalUpdateFrequency: {},
    derivedFanOut: {},
    routeFrequency: {},
    routeCoUsage: [],
    wirePayload: [],
    domBursts: { count: 0, maxBatch: 0, totalMutations: 0 },
    hotSignals: [],
    hotRoutes: [],
  };
}

/** Canonical JSON of the profile (sorted keys) - reproducible artifact (21). */
export function serializeProfile(profile: RaptorProfile): string {
  return JSON.stringify(canonicalize(profile), null, 2);
}
