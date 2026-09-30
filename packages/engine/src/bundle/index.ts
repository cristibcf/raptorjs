/**
 * @raptor/bundle - RaptorBundle: an in-house TSX/ESM bundler, zero-dep at runtime.
 *
 * Transforms JSX -> the fine-grained @raptor/dom runtime (jsx-runtime), resolves
 * the module graph (including the exports map to the .ts source of the @raptor/*
 * packages) and emits a single browser bundle with a module registry + lazy
 * require. No Vite/esbuild/Rolldown; the TypeScript compiler is used only as a
 * build-time transform primitive.
 */
export { transpile, DEFAULT_JSX_IMPORT_SOURCE, type TranspileOptions } from "./transform.ts";
export { resolveSpecifier } from "./resolve.ts";
export { bundleApp, type BundleOptions, type BundleResult } from "./bundle.ts";
export { treeshake, resetSideEffectsCache, type ShakeResult, type ShakeOptions } from "./treeshake.ts";
export { analyzeModule, blankRanges, type ModuleInfo } from "./esm-graph.ts";
export { startDevServer, type DevServerOptions } from "./dev-server.ts";
export { rewriteHtml } from "./html.ts";
export { runBundleCli, type BundleCliResult } from "./cli.ts";
