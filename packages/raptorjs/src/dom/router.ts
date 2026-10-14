/**
 * A minimal client router for the fine-grained runtime. It is reactive end to
 * end: the current location is a signal, so a `Router` is just a dynamic region
 * that reads it, and only the matched subtree remounts on navigation.
 *
 * Zero-dep and host-guarded: it reads the History API when one exists (the web),
 * and otherwise keeps the location purely in-memory (tests, SSR, non-web hosts).
 * `matchRoutes` is exported on its own so a static-site build (#1) can enumerate
 * and prerender routes with the same matcher the client uses.
 */
import { state } from "@raptorstack/raptorjs";
import { createElement, applyProps, mountChild, block, type Block, type Child } from "./runtime.ts";

/** Path parameters captured from a route pattern (`/users/:id` -> `{ id }`). */
export interface Params {
  [key: string]: string;
}

/** A single route: a path pattern and the component to render when it matches. */
export interface RouteDef {
  /** `"/"`, `"/about"`, `"/users/:id"`, or `"*"` / `"/files/*"` for a wildcard. */
  path: string;
  component: (params: Params) => Child;
}

export interface RouteMatch {
  route: RouteDef;
  params: Params;
}

export interface RouterProps {
  routes: readonly RouteDef[];
  /** Rendered when no route matches (the 404 branch). */
  fallback?: Child;
}

export interface LinkProps {
  href: string;
  /** Replace the history entry instead of pushing a new one. */
  replace?: boolean;
  children?: Child;
  /** Any other attribute/handler (class, aria-*, onClick, ...) is passed through. */
  [key: string]: unknown;
}

// --- Location signal -------------------------------------------------------
// A single source of truth for the current URL path. Module-level on purpose:
// there is one browser location, and every Router/Link observes it.

function readLocation(): string {
  const loc = (globalThis as { location?: { pathname: string; search: string; hash: string } }).location;
  return loc ? loc.pathname + loc.search + loc.hash : "/";
}

const path = state<string>(readLocation());

let historyBound = false;
/** Subscribes to `popstate` once, lazily, so the module has no import-time effect. */
function ensureHistoryBinding(): void {
  if (historyBound) return;
  historyBound = true;
  const target = (globalThis as { window?: EventTarget }).window;
  if (target && typeof target.addEventListener === "function") {
    target.addEventListener("popstate", () => path.set(readLocation()));
  }
}

/** The full current location (pathname + search + hash) as a reactive read. */
export function location(): string {
  return path();
}

/** The current pathname only (query and hash stripped), as a reactive read. */
export function pathname(): string {
  return path().split(/[?#]/)[0] || "/";
}

/** Navigate to `to`, updating the History API when available. */
export function navigate(to: string, options?: { replace?: boolean }): void {
  const history = (globalThis as { history?: History }).history;
  if (history && typeof history.pushState === "function") {
    if (options?.replace) history.replaceState(null, "", to);
    else history.pushState(null, "", to);
  }
  path.set(to);
}

// --- Matching --------------------------------------------------------------
const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/** Compiles a path pattern into a regex plus the ordered names of its captures. */
function compile(pattern: string): { re: RegExp; keys: string[] } {
  const keys: string[] = [];
  let src = "";
  for (const seg of pattern.split("/")) {
    if (seg.length === 0) continue;
    if (seg === "*") {
      keys.push("wild");
      src += "/(.*)";
    } else if (seg.startsWith(":")) {
      keys.push(seg.slice(1));
      src += "/([^/]+)";
    } else {
      src += "/" + seg.replace(RE_SPECIAL, "\\$&");
    }
  }
  return { re: new RegExp("^" + (src || "/?") + "/?$"), keys };
}

/** First route whose pattern matches `path` (query/hash ignored), or null. */
export function matchRoutes(routes: readonly RouteDef[], path: string): RouteMatch | null {
  const clean = path.split(/[?#]/)[0] || "/";
  for (const route of routes) {
    const { re, keys } = compile(route.path);
    const m = re.exec(clean);
    if (!m) continue;
    const params: Params = {};
    for (let i = 0; i < keys.length; i++) params[keys[i]!] = decodeURIComponent(m[i + 1] ?? "");
    return { route, params };
  }
  return null;
}

// --- Components ------------------------------------------------------------

/**
 * Renders the component of the route matching the current location. It is a
 * dynamic region reading `pathname()`, so navigation remounts only the matched
 * subtree - and a component may itself return a Block (For/Show), now that
 * dynamic regions accept them.
 */
export function Router(props: RouterProps): Block {
  ensureHistoryBinding();
  return block((parent, anchor) => {
    mountChild(
      parent,
      () => {
        const match = matchRoutes(props.routes, pathname());
        return match ? match.route.component(match.params) : (props.fallback ?? null);
      },
      anchor,
    );
  });
}

/**
 * An `<a>` that navigates client-side. Internal links (relative, or root-
 * absolute) are intercepted on a plain left click; external links, new-tab
 * clicks (modifier/middle button) and already-handled events fall through to
 * the browser.
 */
export function Link(props: LinkProps): Child {
  const { href, replace, children, ...rest } = props;
  const a = createElement("a");
  applyProps(a, { ...rest, href });
  if (children != null) mountChild(a, children, null);
  a.addEventListener("click", (event: unknown) => {
    const e = event as {
      defaultPrevented?: boolean;
      button?: number;
      metaKey?: boolean;
      ctrlKey?: boolean;
      shiftKey?: boolean;
      altKey?: boolean;
      preventDefault(): void;
    };
    if (e.defaultPrevented) return;
    if (typeof e.button === "number" && e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    // Leave absolute/external URLs (scheme or protocol-relative) to the browser.
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return;
    e.preventDefault();
    navigate(href, { replace });
  });
  return a;
}
