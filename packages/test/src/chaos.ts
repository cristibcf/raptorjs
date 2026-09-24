/**
 * RaptorChaos - injectare de fault-uri controlate, context-aware (whitepaper
 * §15). Nu testeaza 500 pentru fiecare request; foloseste contractul si graful
 * pentru a alege defecte cu impact probabil: reordonari de raspuns, stale
 * overwrite, timeout-uri, erori pe rutele mutante.
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
 * Genereaza scenarii de retea plauzibile pentru un set de rute observate.
 * Include baseline + stale-read (citire procesata devreme, livrata tarziu, in
 * timp ce scrierea comite normal) + fault pe rutele mutante.
 */
export function chaosSchedules(routes: RouteInfo[]): Array<{ label: string; schedule: NetworkSchedule }> {
  const out: Array<{ label: string; schedule: NetworkSchedule }> = [];
  out.push({ label: "baseline", schedule: base() });

  const reads = routes.filter((r) => !r.mutating);
  const writes = routes.filter((r) => r.mutating);

  // Stale overwrite / response order inversion (§14): un GET e procesat inainte
  // ca un POST sa comita, dar raspunsul lui e livrat mult mai tarziu -> suprascrie
  // starea corecta din UI cu una veche.
  for (const read of reads) {
    const s = base();
    // Citirea: procesata foarte devreme (vede starea veche), livrata foarte tarziu.
    s.routes[read.key] = { processDelay: 5, deliverDelay: 2000 } as RouteTiming;
    // Scrierile: proceseaza + livreaza rapid (UI se actualizeaza corect intai).
    for (const write of writes) s.routes[write.key] = { processDelay: 50, deliverDelay: 20 };
    out.push({ label: `stale-read:${read.key}`, schedule: s });
  }

  // Fault pe rutele mutante.
  for (const write of writes) {
    const s = base();
    s.routes[write.key] = { processDelay: 10, deliverDelay: 10, faultStatus: 500 };
    out.push({ label: `fault:${write.key}`, schedule: s });
  }

  return out;
}
