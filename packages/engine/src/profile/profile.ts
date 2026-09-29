/**
 * RaptorProfile - artefactul de telemetrie (whitepaper RaptorEngine 22).
 *
 * Masoara comportamente TEHNICE (frecventa update-uri, fan-out, routes,
 * co-usage, payload wire, bursts DOM), nu date personale (22: "scopul e sa
 * masoare comportamente tehnice"). E un input OPTIONAL pentru build planner;
 * corectitudinea nu depinde de el (24).
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
  /** address -> numar de update-uri (signal update frequency, 22). */
  signalUpdateFrequency: Record<string, number>;
  /** nodeId derived -> numar de consumatori (derived fan-out static, 22). */
  derivedFanOut: Record<string, number>;
  /** path -> numar de vizite (route frequency, 22). */
  routeFrequency: Record<string, number>;
  /** perechi de routes vizitate impreuna (chunk co-usage, 22). */
  routeCoUsage: RouteCoUsage[];
  /** distributia payload-ului wire per adresa (encoding specialization, 22). */
  wirePayload: WirePayloadStat[];
  /** rafale de mutatii DOM (batch sizing, 22). */
  domBursts: { count: number; maxBatch: number; totalMutations: number };
  /** derivate: semnale/routes fierbinti peste prag (hot vs cold paths, 22). */
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

/** JSON canonic al profilului (chei sortate) - artefact reproductibil (21). */
export function serializeProfile(profile: RaptorProfile): string {
  return JSON.stringify(canonicalize(profile), null, 2);
}
