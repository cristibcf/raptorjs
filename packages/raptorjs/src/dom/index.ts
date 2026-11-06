/**
 * @raptorstack/raptorjs/dom - fine-grained DOM runtime + control flow.
 * Also re-exports the reactive primitives from @raptorstack/raptorjs for ergonomics.
 */
export {
  render,
  hydrate,
  onMount,
  flushMountCallbacks,
  isServer,
  createElement,
  isSvgTag,
  SVG_NS,
  template,
  applyProps,
  mountChild,
  block,
  isBlock,
  disposeDetached,
  type Block,
  type Child,
  type Component,
} from "./runtime.ts";

export { For, Show, type ForProps, type ShowProps } from "./control.ts";

export { VirtualFor, type VirtualForProps } from "./virtual.ts";

export { ErrorBoundary, type ErrorBoundaryProps, type ErrorFallback } from "./error.ts";

export {
  Router,
  Outlet,
  Link,
  lazy,
  navigate,
  location,
  pathname,
  searchParams,
  hash,
  matchRoutes,
  resolveRoute,
  routePatterns,
  type RouteDef,
  type RouteMatch,
  type RouteResolution,
  type RouterProps,
  type LinkProps,
  type LazyModule,
  type GuardResult,
  type Params,
} from "./router.ts";

export { jsx, jsxs, Fragment } from "./jsx-runtime.ts";

export { R, type Hyperscript } from "./hyperscript.ts";

export {
  state,
  derived,
  memo,
  effect,
  batch,
  untracked,
  createRoot,
  onCleanup,
  onError,
  type State,
  type Derived,
  type Accessor,
  type Dispose,
} from "@raptorstack/raptorjs";
