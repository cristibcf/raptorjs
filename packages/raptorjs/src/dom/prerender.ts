/**
 * @raptorstack/raptorjs/dom/prerender - the SSG driver core (report #1, phase 3D).
 * Composes the earlier phases: enumerate routes (P1 `matchRoutes` lives in the
 * same router), render each to a string with its head (3A + 3B), and assemble a
 * full HTML page whose `#app` container holds the prerendered markup and whose
 * module script boots the client - which calls `hydrate()` (3C).
 *
 * Build-time only (writes no files itself): `prerender(options, emit)` yields one
 * page at a time so a 17k-page build can stream writes without holding every page
 * string in memory; `prerenderToArray` is the convenience for small sites/tests.
 * The engine's `raptor-bundle --prerender` is the CLI around this.
 */
import { renderToStringWithHead, renderDocument } from "./server.ts";
import { navigate, Router, type RouteDef } from "./router.ts";

export interface PrerenderOptions {
  routes: readonly RouteDef[];
  /**
   * Returns every concrete path to prerender (e.g. `/posts/:slug` -> the slugs).
   * Defaults to the routes that are fully static (no `:param`, no `*`).
   */
  getStaticPaths?: () => readonly string[];
  /** `src` of the client bundle script written into each page. */
  bundleSrc: string;
  /** Optional stylesheet href (the P0 collected CSS). */
  cssHref?: string;
  /** `lang` on `<html>`. */
  lang?: string;
  /** Id of the container the client hydrates into. Default `"app"`. */
  rootId?: string;
}

export interface PrerenderedPage {
  /** The route path rendered. */
  path: string;
  /** Suggested output file, relative with `/` separators (e.g. `about/index.html`). */
  file: string;
  /** The complete HTML document. */
  html: string;
}

/** The fully-static routes (no params, no wildcard) - the default path set. */
function staticPaths(routes: readonly RouteDef[]): string[] {
  return routes.filter((r) => !r.path.includes(":") && !r.path.includes("*")).map((r) => r.path);
}

/** Maps a route path to a clean-URL output file (`/about` -> `about/index.html`). */
function outputFile(routePath: string): string {
  const clean = routePath.split(/[?#]/)[0] || "/";
  const trimmed = clean.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? "index.html" : `${trimmed}/index.html`;
}

function pageHtml(appHtml: string, head: string, options: PrerenderOptions): string {
  const rootId = options.rootId ?? "app";
  const headParts: string[] = [];
  if (options.cssHref) headParts.push(`<link rel="stylesheet" href="${options.cssHref}">`);
  if (head) headParts.push(head);
  const body =
    `<div id="${rootId}">${appHtml}</div>` +
    `<script type="module" src="${options.bundleSrc}"></script>`;
  return renderDocument({ body, head: headParts.join(""), lang: options.lang });
}

/**
 * Prerenders every path, calling `emit` with each finished page. Streaming by
 * design - `emit` writes the file and nothing accumulates. Returns the count.
 */
export function prerender(options: PrerenderOptions, emit: (page: PrerenderedPage) => void): number {
  const paths = options.getStaticPaths ? options.getStaticPaths() : staticPaths(options.routes);
  let count = 0;
  for (const path of paths) {
    // Point the router at this path before rendering (no history on the server,
    // so navigate just sets the location signal the Router reads).
    navigate(path);
    const { html, head } = renderToStringWithHead(() => Router({ routes: options.routes }));
    emit({ path, file: outputFile(path), html: pageHtml(html, head, options) });
    count++;
  }
  return count;
}

/** Convenience: collect every prerendered page into an array (small sites/tests). */
export function prerenderToArray(options: PrerenderOptions): PrerenderedPage[] {
  const pages: PrerenderedPage[] = [];
  prerender(options, (page) => pages.push(page));
  return pages;
}
