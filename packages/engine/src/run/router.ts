/**
 * Minimal routing (whitepaper RaptorEngine 20). A route manifest maps paths to
 * components; supports dynamic segments `[param]`. Route-aware chunking and the
 * preload graph live in RaptorBuild (16); here it's just runtime dispatch.
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

/** Matches a path against a route, extracting `[id]` parameters. */
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
