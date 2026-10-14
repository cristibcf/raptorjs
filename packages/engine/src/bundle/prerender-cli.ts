/**
 * `raptor-bundle build --prerender` glue (SSG 3D). The prerender engine itself
 * lives in @raptorstack/raptorjs/dom/prerender; this orchestrates it: build the
 * client bundle as usual, load the app's routes module, resolve that same app's
 * prerender, and write one HTML file per route.
 *
 * Resolution matters: the routes module and prerender are loaded from the ROUTES
 * module's own context (createRequire), so both share the app's single
 * @raptorstack/raptorjs instance - otherwise the router location the driver sets
 * and the Router the app renders would be different module copies.
 *
 * Constraint (documented, not yet solved here): the routes module must be
 * Node-loadable as-is - a plain `.ts` (type-stripped by Node), no JSX. A `.tsx`
 * routes module needs a transpiling loader, which is a follow-up.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { runBundleCli, type BundleCliResult } from "./cli.ts";

/** One prerendered page, as yielded by @raptorstack/raptorjs/dom/prerender. */
interface PrerenderedPage {
  path: string;
  file: string;
  html: string;
}

/** The prerender function exported by @raptorstack/raptorjs/dom/prerender (duck-typed). */
export type PrerenderFn = (
  options: {
    routes: unknown[];
    getStaticPaths?: () => readonly string[];
    bundleSrc: string;
    cssHref?: string;
    lang?: string;
  },
  emit: (page: PrerenderedPage) => void,
) => number;

export interface WritePrerenderedOptions {
  routes: unknown[];
  getStaticPaths?: () => readonly string[];
  outDir: string;
  bundleSrc: string;
  cssHref?: string;
  lang?: string;
}

/**
 * Drives `prerender` and writes each emitted page under `outDir`. Pure
 * orchestration (prerender is injected), so it is testable without loading a
 * real app. Returns the number of pages written.
 */
export function writePrerendered(prerender: PrerenderFn, options: WritePrerenderedOptions): number {
  return prerender(
    {
      routes: options.routes,
      getStaticPaths: options.getStaticPaths,
      bundleSrc: options.bundleSrc,
      cssHref: options.cssHref,
      lang: options.lang,
    },
    (page) => {
      const file = join(options.outDir, page.file);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, page.html);
    },
  );
}

export interface PrerenderFromModuleOptions {
  routesModule: string;
  outDir: string;
  bundleSrc: string;
  cssHref?: string;
  lang?: string;
}

/** Loads the routes module + the app's prerender, then writes pages. */
export async function prerenderFromModule(options: PrerenderFromModuleOptions): Promise<BundleCliResult> {
  const routesPath = resolve(options.routesModule);

  let mod: { routes?: unknown; getStaticPaths?: unknown };
  try {
    mod = (await import(pathToFileURL(routesPath).href)) as typeof mod;
  } catch (err) {
    return {
      ok: false,
      message:
        `prerender: cannot load routes module ${routesPath}\n  ${(err as Error).message}\n` +
        `  (it must be Node-loadable - a plain .ts without JSX - and import the app's @raptorstack/raptorjs)`,
    };
  }
  if (!Array.isArray(mod.routes)) {
    return { ok: false, message: `prerender: routes module must export \`routes\` (an array of { path, component })` };
  }
  const getStaticPaths = typeof mod.getStaticPaths === "function" ? (mod.getStaticPaths as () => readonly string[]) : undefined;

  let prerender: PrerenderFn;
  try {
    const req = createRequire(pathToFileURL(routesPath));
    const url = pathToFileURL(req.resolve("@raptorstack/raptorjs/dom/prerender")).href;
    prerender = ((await import(url)) as { prerender: PrerenderFn }).prerender;
  } catch (err) {
    return {
      ok: false,
      message: `prerender: cannot resolve @raptorstack/raptorjs/dom/prerender from the app\n  ${(err as Error).message}`,
    };
  }

  const pages = writePrerendered(prerender, {
    routes: mod.routes,
    getStaticPaths,
    outDir: options.outDir,
    bundleSrc: options.bundleSrc,
    cssHref: options.cssHref,
    lang: options.lang,
  });
  return { ok: true, message: `prerendered ${pages} pages → ${options.outDir}` };
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * `raptor-bundle build <entry> --prerender --routes <module> [...]`: runs the
 * normal build (bundle.js + bundle.css) and then prerenders each route to
 * `<outDir>/<path>/index.html`, referencing the built bundle and stylesheet.
 */
export async function runPrerenderBuild(argv: string[]): Promise<BundleCliResult> {
  const build = runBundleCli(argv); // unknown flags (--prerender/--routes/--lang) are ignored by the build
  if (!build.ok) return build;

  const rest = argv.slice(1);
  const routesModule = flag(rest, "--routes");
  if (!routesModule) return { ok: false, message: "--prerender requires --routes <module>" };

  const out = resolve(flag(rest, "--out") ?? "dist/bundle.js");
  const outDir = dirname(out);
  const bundleSrc = "/" + basename(out);
  const cssOut = join(outDir, basename(out).replace(/\.[^.]+$/, "") + ".css");
  const cssHref = existsSync(cssOut) ? "/" + basename(cssOut) : undefined;

  const pre = await prerenderFromModule({ routesModule, outDir, bundleSrc, cssHref, lang: flag(rest, "--lang") });
  if (!pre.ok) return pre;
  return { ok: true, message: `${build.message}\n${pre.message}` };
}
