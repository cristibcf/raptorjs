/**
 * RaptorChaos - controlled, context-aware fault injection (whitepaper §15). It
 * does not test 500 for every request; it uses the contract and the graph to
 * pick defects with likely impact: response reorderings, stale overwrites,
 * timeouts, errors on mutating routes.
 */
import { type NetworkSchedule, type RouteTiming } from "./types.ts";
import { DEFAULT_TIMING } from "./network.ts";

export interface RouteInfo {
  key: string; // "METHOD /path"
  mutating: boolean;
}

function base(): NetworkSchedule {
  return { default: { ...DEFAULT_TIMING }, routes: {} };
}

/**
 * Generates plausible network scenarios for a set of observed routes.
 * Includes baseline + stale-read (a read processed early, delivered late, while
 * the write commits normally) + a fault on the mutating routes.
 */
export function chaosSchedules(routes: RouteInfo[]): Array<{ label: string; schedule: NetworkSchedule }> {
  const out: Array<{ label: string; schedule: NetworkSchedule }> = [];
  out.push({ label: "baseline", schedule: base() });

  const reads = routes.filter((r) => !r.mutating);
  const writes = routes.filter((r) => r.mutating);

  // Stale overwrite / response order inversion (§14): a GET is processed before
  // a POST commits, but its response is delivered much later -> it overwrites
  // the correct UI state with an old one.
  for (const read of reads) {
    const s = base();
    // The read: processed very early (sees the old state), delivered very late.
    s.routes[read.key] = { processDelay: 5, deliverDelay: 2000 } as RouteTiming;
    // The writes: process + deliver quickly (the UI updates correctly first).
    for (const write of writes) s.routes[write.key] = { processDelay: 50, deliverDelay: 20 };
    out.push({ label: `stale-read:${read.key}`, schedule: s });
  }

  // Fault on the mutating routes.
  for (const write of writes) {
    const s = base();
    s.routes[write.key] = { processDelay: 10, deliverDelay: 10, faultStatus: 500 };
    out.push({ label: `fault:${write.key}`, schedule: s });
  }

  return out;
}
