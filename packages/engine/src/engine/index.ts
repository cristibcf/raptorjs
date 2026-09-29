/**
 * @raptor/engine - RaptorEngine: build, dev si runtime orchestration (whitepaper
 * RaptorEngine v0.1). Consuma @raptor/compiler pentru nucleul semantic si adauga
 * optimizer, codegen multi-target, HMR, caching, manifest si CLI.
 */
export {
  defineConfig,
  resolveConfig,
  profileStrategy,
  DEFAULT_CONFIG,
  BuildProfile,
  type RaptorConfig,
  type UserConfig,
  type BuildTarget,
  type BuildProfileValue,
  type ProfileStrategy,
} from "./config.ts";

export {
  optimize,
  type OptEntry,
  type OptimizeResult,
} from "./optimize.ts";

export {
  emitBrowser,
  emitServer,
  emitWireManifest,
  type ServerOutput,
  type ServerProducer,
  type WireManifest,
  type WireAddress,
} from "./codegen.ts";

export {
  buildModule,
  buildModuleAsync,
  type BuildResult,
  type BuildOptions,
  type Chunk,
} from "./build.ts";

export { emptyPlanHints, type PlanHints } from "./plan.ts";

export {
  DevEngine,
  formatUpdateLog,
  type DevUpdate,
} from "./dev.ts";

export {
  computeCacheKey,
  SemanticCache,
  ENGINE_VERSION,
  COMPILER_VERSION,
  SCHEMA_COMPAT,
  type CacheKeyInputs,
  type CacheStats,
} from "./cache.ts";

export {
  buildManifest,
  type BuildManifest,
  type BuildMetrics,
} from "./manifest.ts";

export {
  NaiveEngine,
  createRolldownEngine,
  loadLowLevelEngine,
  detectToolchain,
  type LowLevelEngine,
  type LowLevelModule,
  type LowLevelBundle,
  type EngineName,
  type LoadEngineOptions,
  type RolldownOptions,
} from "./lowlevel.ts";

export {
  inspectGraph,
  invalidationTrace,
  formatOptimizationTrace,
  analyzeReport,
  reactiveNodeId,
} from "./inspect.ts";

export { runCli, runCliAsync, type CliResult } from "./cli.ts";
