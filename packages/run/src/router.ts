/**
 * Routing minimal (whitepaper RaptorEngine 20). Un route manifest leaga cai la
 * componente; suporta segmente dinamice `[param]`. Chunking-ul route-aware si
 * preload graph-ul sunt in RaptorBuild (16); aici doar dispatch-ul la runtime.
 */
export interface RouteDef {
  path: string;
  component: string;
}

export interface RouteMatch {
  route: RouteDef;
  params: Record<string, string>;
}

function normalize(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

/** Potriveste o cale la un route, extragand parametrii `[id]`. */
export function matchRoute(routes: RouteDef[], path: string): RouteMatch | null {
  const segs = normalize(path);
  for (const route of routes) {
    const pat = normalize(route.path);
    if (pat.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pat.length; i++) {
      const p = pat[i]!;
      const s = segs[i]!;
      if (p.startsWith("[") && p.endsWith("]")) {
        params[p.slice(1, -1)] = decodeURIComponent(s);
      } else if (p !== s) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}
