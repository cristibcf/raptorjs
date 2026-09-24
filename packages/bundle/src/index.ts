/**
 * @raptor/bundle - RaptorBundle: bundler TSX/ESM propriu, zero-dep la runtime.
 *
 * Transforma JSX -> runtime-ul fine-grained @raptor/dom (jsx-runtime), rezolva
 * graful de module (inclusiv exports map catre sursa .ts a pachetelor @raptor/*)
 * si emite un singur bundle browser cu registru de module + require lazy. Fara
 * Vite/esbuild/Rolldown; compilatorul TypeScript e folosit doar ca primitiva de
 * transform la build-time.
 */
export { transpile, DEFAULT_JSX_IMPORT_SOURCE, type TranspileOptions } from "./transform.ts";
export { resolveSpecifier } from "./resolve.ts";
export { bundleApp, type BundleOptions, type BundleResult } from "./bundle.ts";
export { treeshake, resetSideEffectsCache, type ShakeResult, type ShakeOptions } from "./treeshake.ts";
export { analyzeModule, blankRanges, type ModuleInfo } from "./esm-graph.ts";
export { startDevServer, type DevServerOptions } from "./dev-server.ts";
export { rewriteHtml } from "./html.ts";
export { runBundleCli, type BundleCliResult } from "./cli.ts";
