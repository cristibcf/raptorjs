/**
 * A client router for the fine-grained runtime. It is reactive end to end: the
 * current location is a signal, so a `Router` is just a dynamic region that
 * reads it, and only the matched subtree remounts on navigation.
 *
 * Zero-dep and host-guarded: it reads the History API when one exists (the web),
 * and otherwise keeps the location purely in-memory (tests, SSR, non-web hosts).
 * `matchRoutes` is exported on its own so a static-site build (#1) can enumerate
 * and prerender routes with the same matcher the client uses - which is why it
 * stays pure: guards belong to `resolveRoute`, and a prerender must not be
 * redirected by one.
 *
 * v0.2.1 adds what an application with ~30 guarded screens needs, all of it
 * additive - a flat, synchronous route table keeps working unchanged:
 * `beforeEnter` guards (a returned string is a redirect), a `component` that
 * may return a promise plus `lazy()`, nested `children` with `Outlet()`,
 * `searchParams()`/`hash()` as reactive reads, and opt-in scroll restoration.
 */
import { state, derived, effect, getOwner, runWithOwner } from "@raptorstack/raptorjs";
import { createElement, applyProps, mountChild, block, type Block, type Child } from "./runtime.ts";

/** Path parameters captured from a route pattern (`/users/:id` -> `{ id }`). */
export interface Params {
  [key: string]: string;
}

/**
 * What a guard decides: `true` lets the route render, a string redirects there
 * (replacing the history entry), and `false` denies - the match is dropped, so
 * matching continues and ends at the `Router`'s `fallback`. Denying rather
 * than redirecting is what you want for "this exists but not for you".
 */
export type GuardResult = boolean | string;

/** A single route: a path pattern and the component to render when it matches. */
export interface RouteDef {
  /** `"/"`, `"/about"`, `"/users/:id"`, or `"*"` / `"/files/*"` for a wildcard. */
  path: string;
  /**
   * The screen. May return a promise (a code-split module), in which case the
   * `Router`'s `pending` child is shown until it resolves; `lazy()` is the
   * ergonomic wrapper around that.
   */
  component: (params: Params) => Child | Promise<Child>;
  /**
   * Runs before the route renders, every time the match changes. Every guard
   * in the chain runs, outermost first. Synchronous on purpose: a guard
   * decides what to mount, and an awaited one would mean rendering nothing, or
   * the wrong thing, while it thinks. Do the async part (fetch the session)
   * once, into a signal, and read it here.
   */
  beforeEnter?: (params: Params) => GuardResult;
  /**
   * Nested routes. A child path is relative to its parent (`"inbox"`), unless
   * it starts with `/`; `""` is the index child. The parent renders
   * `Outlet()` where the child goes, so a shell is declared once instead of
   * being repeated by every screen under it.
   */
  children?: readonly RouteDef[];
}

export interface RouteMatch {
  /** The matched route - the DEEPEST one when routes are nested. */
  route: RouteDef;
  params: Params;
  /** The matched routes from the outermost to `route`. One entry when flat. */
  chain: readonly RouteDef[];
  /** The full pattern that matched, with the nesting joined (`/app/users/:id`). */
  pattern: string;
  /**
   * The parameter names visible at each depth of `chain`, cumulative - so
   * `/app/users/:id` gives `[[], ["id"]]`. This is how the router decides which
   * nesting level has to re-render: a change to `:id` is the child's business,
   * and the shell above it keeps its region.
   */
  depthParams: readonly (readonly string[])[];
}

/** What `resolveRoute` concluded, guards and redirects included. */
export interface RouteResolution {
  /** The path that should be rendered and shown in the URL. */
  path: string;
  /** `null` when nothing matched, or when a guard denied: render the fallback. */
  match: RouteMatch | null;
  /** True when a guard redirected, so the URL needs replacing with `path`. */
  redirected: boolean;
}

export interface RouterProps {
  routes: readonly RouteDef[];
  /** Rendered when no route matches, or when a guard denies (the 404 branch). */
  fallback?: Child;
  /** Rendered while a route's component is still loading (lazy routes). */
  pending?: Child;
  /**
   * Scroll to the top on a new navigation and restore the saved offset on back
   * and forward. Off by default, because it takes over the browser's own
   * restoration for the whole document.
   */
  scrollRestoration?: boolean;
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
/**
 * Subscribes to `popstate` once, lazily, so the module has no import-time
 * effect - but on the first READ of the location, not on mounting a `Router`.
 *
 * Until v0.2.1 only `Router` bound it, so an application whose navigation came
 * from its own components got no listener at all: Back changed the address bar
 * and left the view where it was, with nothing logged and nothing thrown. That
 * made "does Back work" a function of which components an app happened to use,
 * which is not a property anyone could predict from the API. Reading the
 * location is the thing that implies you care whether it changes, so that is
 * where the binding belongs.
 */
function ensureHistoryBinding(): void {
  if (historyBound) return;
  historyBound = true;
  const target = (globalThis as { window?: EventTarget }).window;
  if (target && typeof target.addEventListener === "function") {
    target.addEventListener("popstate", (event: unknown) => {
      // The outgoing offset is still readable here: popstate fires before the
      // browser touches the scroll position.
      rememberScroll();
      activeKey = historyKeyOf(event);
      path.set(readLocation());
      restoreScroll();
    });
  }
}

/** The full current location (pathname + search + hash) as a reactive read. */
export function location(): string {
  ensureHistoryBinding();
  return path();
}

/** The current pathname only (query and hash stripped), as a reactive read. */
export function pathname(): string {
  ensureHistoryBinding();
  return path().split(/[?#]/)[0] || "/";
}

/**
 * The query string, memoized, so `searchParams()` only invalidates its readers
 * when the query actually changes - not on every navigation.
 */
const searchString = derived<string>(() => {
  const full = path();
  const q = full.indexOf("?");
  if (q === -1) return "";
  const h = full.indexOf("#", q);
  return h === -1 ? full.slice(q + 1) : full.slice(q + 1, h);
});

/**
 * The query as `URLSearchParams`, as a reactive read - parsing it by hand was
 * left to every caller before.
 *
 * A fresh instance per read, deliberately: `URLSearchParams` is mutable, and a
 * shared one would let a reader corrupt what everybody else sees. Mutating the
 * returned object does not navigate; call `navigate` with the new query.
 */
export function searchParams(): URLSearchParams {
  ensureHistoryBinding();
  return new URLSearchParams(searchString());
}

/** The fragment including `#` (`""` when there is none), as a reactive read. */
export function hash(): string {
  ensureHistoryBinding();
  const full = path();
  const h = full.indexOf("#");
  return h === -1 ? "" : full.slice(h);
}

// --- Scroll restoration ----------------------------------------------------
// Off until a Router asks for it: taking over `history.scrollRestoration` is a
// decision about the whole document, not something a library should assume.

const SCROLL_KEY = "__raptorScroll";
const scrollOffsets = new Map<number, [number, number]>();
let scrollEnabled = false;
let historyKeySeq = 0;
let activeKey = 0;

function historyKeyOf(event: unknown): number {
  const st = (event as { state?: Record<string, unknown> } | null)?.state;
  const key = st?.[SCROLL_KEY];
  return typeof key === "number" ? key : 0;
}

function viewportScroll(): [number, number] {
  const w = globalThis as { scrollX?: number; scrollY?: number };
  return [w.scrollX ?? 0, w.scrollY ?? 0];
}

function scrollViewportTo(x: number, y: number): void {
  const fn = (globalThis as { scrollTo?: (x: number, y: number) => void }).scrollTo;
  if (typeof fn === "function") fn(x, y);
}

function rememberScroll(): void {
  if (scrollEnabled) scrollOffsets.set(activeKey, viewportScroll());
}

function restoreScroll(): void {
  if (!scrollEnabled) return;
  const [x, y] = scrollOffsets.get(activeKey) ?? [0, 0];
  scrollViewportTo(x, y);
}

function enableScrollRestoration(): void {
  if (scrollEnabled) return;
  scrollEnabled = true;
  const history = (globalThis as { history?: History }).history;
  // Otherwise the browser restores its own idea of the offset on top of ours.
  if (history && "scrollRestoration" in history) history.scrollRestoration = "manual";
}

/** Navigate to `to`, updating the History API when available. */
export function navigate(to: string, options?: { replace?: boolean }): void {
  // An app that navigates plainly cares about the location, so this is also a
  // point at which Back has to start working.
  ensureHistoryBinding();
  rememberScroll();
  const replace = options?.replace === true;
  if (!replace) activeKey = ++historyKeySeq;
  const history = (globalThis as { history?: History }).history;
  if (history && typeof history.pushState === "function") {
    const entryState = { [SCROLL_KEY]: activeKey };
    if (replace) history.replaceState(entryState, "", to);
    else history.pushState(entryState, "", to);
  }
  path.set(to);
  // A new entry starts at the top; a replacement stays where it was.
  if (scrollEnabled && !replace) scrollViewportTo(0, 0);
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

/** A leaf of the (possibly nested) route tree, with its ancestors. */
interface Flattened {
  pattern: string;
  chain: readonly RouteDef[];
  re: RegExp;
  keys: string[];
  /** `keys` of every prefix pattern, one entry per depth of `chain`. */
  depthKeys: string[][];
}

/** `("/app", "inbox") -> "/app/inbox"`; a child starting with `/` is absolute. */
function joinPaths(base: string, child: string): string {
  if (child.startsWith("/")) return child;
  if (child === "") return base === "" ? "/" : base;
  const left = base.endsWith("/") ? base.slice(0, -1) : base;
  return left + "/" + child;
}

function flatten(
  routes: readonly RouteDef[],
  base: string,
  ancestors: readonly RouteDef[],
  ancestorKeys: readonly string[][],
  out: Flattened[],
): void {
  for (const route of routes) {
    const pattern = joinPaths(base, route.path);
    const chain = [...ancestors, route];
    const { re, keys } = compile(pattern);
    const depthKeys = [...ancestorKeys, keys];
    // Children first, so an index child (`path: ""`) wins over its parent
    // rendering alone - and so the more specific pattern is tried first,
    // keeping the existing "first match in declaration order" rule.
    if (route.children && route.children.length > 0) {
      flatten(route.children, pattern, chain, depthKeys, out);
    }
    out.push({ pattern, chain, re, keys, depthKeys });
  }
}

/**
 * Compiled route tables, keyed on the array the caller passed. A route table
 * is a constant in practice, and recompiling every pattern on every navigation
 * was pure waste once nesting made the table bigger.
 */
const compiled = new WeakMap<readonly RouteDef[], Flattened[]>();

function tableFor(routes: readonly RouteDef[]): Flattened[] {
  let table = compiled.get(routes);
  if (!table) {
    table = [];
    flatten(routes, "", [], [], table);
    compiled.set(routes, table);
  }
  return table;
}

/**
 * Every full pattern in the table, nesting joined, in match order. A static
 * site build needs this to enumerate nested routes the way the client sees
 * them.
 */
export function routePatterns(routes: readonly RouteDef[]): string[] {
  return tableFor(routes).map((entry) => entry.pattern);
}

/**
 * First route whose pattern matches `path` (query/hash ignored), or null.
 * Pure: guards are NOT run here, so a prerender gets the same answer the
 * client would before anyone is redirected.
 */
export function matchRoutes(routes: readonly RouteDef[], path: string): RouteMatch | null {
  const clean = path.split(/[?#]/)[0] || "/";
  for (const entry of tableFor(routes)) {
    const m = entry.re.exec(clean);
    if (!m) continue;
    const params: Params = {};
    for (let i = 0; i < entry.keys.length; i++) params[entry.keys[i]!] = decodeURIComponent(m[i + 1] ?? "");
    return {
      route: entry.chain[entry.chain.length - 1]!,
      params,
      chain: entry.chain,
      pattern: entry.pattern,
      depthParams: entry.depthKeys,
    };
  }
  return null;
}

const MAX_REDIRECTS = 10;

/**
 * Matches `path` and runs the guards of every route in the chain, outermost
 * first, following redirects (capped, so a guard pair that bounces between two
 * paths warns instead of hanging the tab).
 */
export function resolveRoute(routes: readonly RouteDef[], path: string): RouteResolution {
  let current = path;
  let redirected = false;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const match = matchRoutes(routes, current);
    if (!match) return { path: current, match: null, redirected };
    let verdict: GuardResult = true;
    for (const route of match.chain) {
      if (!route.beforeEnter) continue;
      verdict = route.beforeEnter(match.params);
      if (verdict !== true) break;
    }
    if (verdict === true) return { path: current, match, redirected };
    // Denied: drop the match and let the fallback render it.
    if (verdict === false) return { path: current, match: null, redirected };
    // A guard redirecting to the path it is already on would loop forever.
    if (verdict === current) return { path: current, match, redirected };
    current = verdict;
    redirected = true;
  }
  console.warn(`[raptor] router: more than ${MAX_REDIRECTS} redirects from "${path}"; giving up`);
  return { path: current, match: null, redirected };
}

// --- Components ------------------------------------------------------------

const NO_PARAMS: Params = {};

/**
 * Compares only the parameters a given level owns. Comparing the whole merged
 * set would make a change to `:id` deep in the tree rebuild the shell above
 * it, which is the thing nesting exists to avoid.
 */
function sameParamsAt(keys: readonly string[] | undefined, a: Params, b: Params): boolean {
  if (!keys) return true;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

function isPromise(value: Child | Promise<Child>): value is Promise<Child> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

/**
 * The level currently rendering, so `Outlet()` knows which route comes next.
 * Set only for the synchronous duration of a component call - components run
 * inside their level's dynamic region, so this is never read across a tick.
 */
interface LevelContext {
  resolution: () => RouteResolution;
  depth: number;
  pending: Child | undefined;
}
let activeLevel: LevelContext | null = null;

/** Mounts `pending` and swaps in the real child when the promise resolves. */
function awaited(produced: Promise<Child>, pending: Child | undefined): Block {
  const slot = state<Child>(pending ?? null);
  produced.then(
    (child) => slot.set(child),
    (err: unknown) => {
      // Fail visible, not blank: the fallback stays and the reason is reported.
      console.warn("[raptor] router: a route component failed to load:", err);
    },
  );
  return block((parent, anchor) => mountChild(parent, () => slot(), anchor));
}

function renderLevel(resolution: () => RouteResolution, match: RouteMatch, depth: number, pending: Child | undefined): Child {
  const route = match.chain[depth];
  if (!route) return null;
  const previous = activeLevel;
  activeLevel = { resolution, depth, pending };
  try {
    const produced = route.component(match.params);
    return isPromise(produced) ? awaited(produced, pending) : produced;
  } finally {
    activeLevel = previous;
  }
}

/**
 * One dynamic region per nesting level, keyed on THAT level's route and params.
 * This is what makes nesting worth having: moving between two screens under a
 * shell leaves the shell's own region untouched, so the shell is not rebuilt
 * and keeps its state.
 */
function levelBlock(
  resolution: () => RouteResolution,
  depth: number,
  pending: Child | undefined,
  fallback: Child | undefined,
): Block {
  const slot = derived<{ route: RouteDef | null; match: RouteMatch | null }>(
    () => {
      const current = resolution();
      return { route: current.match?.chain[depth] ?? null, match: current.match };
    },
    {
      // The comparator also sees the first computation, where there is no
      // previous value yet - that one must always count as a change.
      equal: (a, b) =>
        a !== undefined &&
        b !== undefined &&
        a.route === b.route &&
        sameParamsAt(
          b.match?.depthParams[depth],
          a.match?.params ?? NO_PARAMS,
          b.match?.params ?? NO_PARAMS,
        ),
    },
  );
  return block((parent, anchor) => {
    mountChild(
      parent,
      () => {
        const current = slot();
        if (!current.match) return depth === 0 ? (fallback ?? null) : null;
        if (!current.route) return null;
        return renderLevel(resolution, current.match, depth, pending);
      },
      anchor,
    );
  });
}

/**
 * Renders the component of the route matching the current location. It is a
 * dynamic region reading `pathname()`, so navigation remounts only the matched
 * subtree - and a component may itself return a Block (For/Show), now that
 * dynamic regions accept them.
 */
export function Router(props: RouterProps): Block {
  ensureHistoryBinding();
  if (props.scrollRestoration) enableScrollRestoration();

  const resolution = derived(() => resolveRoute(props.routes, pathname()));
  // A guard's redirect has to land in the URL too, or Back would return to the
  // path that was never rendered. Done in an effect, not inside the matcher:
  // re-resolving converges, because the second pass is already on `path`.
  effect(() => {
    const current = resolution();
    if (current.redirected && current.path !== pathname()) navigate(current.path, { replace: true });
  });

  return levelBlock(() => resolution(), 0, props.pending, props.fallback);
}

/**
 * Where a nested route renders inside its parent. Returns nothing when the
 * parent is the deepest matched route, so a shell renders fine on its own
 * index path.
 */
export function Outlet(): Child {
  const ctx = activeLevel;
  if (!ctx) {
    console.warn("[raptor] router: Outlet() was called outside a routed component");
    return null;
  }
  return levelBlock(ctx.resolution, ctx.depth + 1, ctx.pending, undefined);
}

/** What a lazily loaded module may export as its screen. */
export type LazyModule = { default: (params: Params) => Child } | ((params: Params) => Child);

/**
 * Wraps a dynamic import as a route component, so a code-split screen needs no
 * hand-written loader-and-swap wrapper:
 *
 * ```ts
 * { path: "/settings", component: lazy(() => import("./Settings.ts")) }
 * ```
 *
 * The module is fetched once and cached, and every later match renders it
 * synchronously - which matters for SSR and for a prerender, where there is no
 * frame in which to show a fallback.
 */
export function lazy(load: () => Promise<LazyModule>, options: { pending?: Child } = {}): (params: Params) => Child {
  let screen: ((params: Params) => Child) | null = null;
  let inFlight: Promise<void> | null = null;

  return (params: Params): Child => {
    if (screen) return screen(params);
    const slot = state<Child>(options.pending ?? null);
    // The component runs after an await, so it must be given back the owner it
    // would have had: otherwise its effects belong to nobody and outlive the
    // route.
    const owner = getOwner();
    inFlight ??= load().then((mod) => {
      screen = typeof mod === "function" ? mod : mod.default;
    });
    inFlight.then(
      () => {
        if (screen) runWithOwner(owner, () => slot.set(screen!(params)));
      },
      (err: unknown) => {
        console.warn("[raptor] router: a lazy route failed to load:", err);
      },
    );
    return block((parent, anchor) => mountChild(parent, () => slot(), anchor));
  };
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
