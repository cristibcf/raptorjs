/**
 * RaptorBuild - orchestration (RaptorEngine whitepaper 6, 13, 16).
 *
 * Pipeline: parse -> optimize (semantic) -> graph -> multi-target codegen ->
 * chunk planning -> manifest -> low-level bundle. The compiler is separate from
 * the bundler; the low-level engine is consumed through an adapter (37).
 */
import {
  parseModule,
  buildGraph,
  type IRModule,
  type IRElement,
  type IRChild,
  type SemanticGraph,
} from "@raptorstack/engine/compiler";
import { optimize, type OptEntry } from "./optimize.ts";
import {
  emitBrowser,
  emitServer,
  emitWireManifest,
  type ServerOutput,
  type WireManifest,
} from "./codegen.ts";
import { resolveConfig, profileStrategy, type RaptorConfig, type UserConfig } from "./config.ts";
import { computeCacheKey } from "./cache.ts";
import { buildManifest, type BuildManifest, type BuildMetrics } from "./manifest.ts";
import { NaiveEngine, type LowLevelEngine } from "./lowlevel.ts";
import { emptyPlanHints, type PlanHints } from "./plan.ts";

export interface Chunk {
  name: string;
  kind: "main" | "realtime";
  components: string[];
}

export interface BuildResult {
  path: string;
  config: RaptorConfig;
  ir: IRModule;
  graph: SemanticGraph;
  browser: string;
  server: ServerOutput;
  wire: WireManifest;
  chunks: Chunk[];
  optimization: OptEntry[];
  manifest: BuildManifest;
  bundleCode: string;
}

function countDomBindings(module: IRModule): number {
  let n = 0;
  const walk = (el: IRElement): void => {
    for (const a of el.attrs) if (a.expr) n++;
    n += el.events.length;
    for (const c of el.children as IRChild[]) {
      if (c.kind === "Element") walk(c);
      else if (c.expr) n++;
    }
  };
  for (const comp of module.components) walk(comp.root);
  return n;
}

/** Semantic + route-aware chunk planning (16). v0.1: profile + PGO hints. */
function planChunks(module: IRModule, config: RaptorConfig, hints: PlanHints): Chunk[] {
  // Profile-guided chunk folding (co-usage, §22/§24): components grouped
  // together go into one chunk; the rest into "main". Eliminates NOTHING.
  if (hints.foldChunks.length > 0) {
    const known = new Set(module.components.map((c) => c.name));
    const grouped = new Set<string>();
    const chunks: Chunk[] = [];
    hints.foldChunks.forEach((group, i) => {
      const members = group.filter((n) => known.has(n));
      if (members.length === 0) return;
      for (const m of members) grouped.add(m);
      chunks.push({ name: `folded${i}`, kind: "main", components: members });
    });
    const rest = module.components.map((c) => c.name).filter((n) => !grouped.has(n));
    if (rest.length > 0) chunks.push({ name: "main", kind: "main", components: rest });
    return chunks;
  }
  const strat = profileStrategy(config.profile);
  if (strat.isolateRealtime) {
    const realtime: string[] = [];
    const main: string[] = [];
    for (const c of module.components) {
      if (c.serverSignals.length > 0) realtime.push(c.name);
      else main.push(c.name);
    }
    const chunks: Chunk[] = [];
    if (main.length > 0) chunks.push({ name: "main", kind: "main", components: main });
    if (realtime.length > 0) chunks.push({ name: "realtime", kind: "realtime", components: realtime });
    return chunks;
  }
  return [{ name: "main", kind: "main", components: module.components.map((c) => c.name) }];
}

export interface BuildOptions {
  config?: UserConfig;
  engine?: LowLevelEngine;
  /** Profile-guided hints (whitepaper 22-24). Influence the strategy, not the semantics. */
  planHints?: PlanHints;
}

interface Prepared {
  config: RaptorConfig;
  engine: LowLevelEngine;
  optimized: IRModule;
  graph: SemanticGraph;
  browser: string;
  server: ServerOutput;
  wire: WireManifest;
  chunks: Chunk[];
  trace: OptEntry[];
  buildMetrics: BuildMetrics;
  hints: PlanHints;
  hintsApplied: boolean;
  inputsHash: string;
  moduleName: string;
}

/** The semantic pipeline (parse -> optimize -> graph -> codegen -> chunks). */
function prepare(source: string, path: string, options: BuildOptions): Prepared {
  const config = resolveConfig(options.config);
  const engine = options.engine ?? NaiveEngine;
  const hints = options.planHints ?? emptyPlanHints();

  const parsed = parseModule(source, path);
  const { module: optimized, trace, metrics } = optimize(parsed, {
    fusion: !config.build.disableFusion,
  });
  const graph = buildGraph(optimized);

  const browser = emitBrowser(optimized);
  const server = emitServer(optimized);
  const wire = emitWireManifest(optimized);
  const chunks = planChunks(optimized, config, hints);

  const buildMetrics: BuildMetrics = {
    eliminated: metrics.eliminated,
    fused: metrics.fused,
    domBindings: countDomBindings(optimized),
    components: optimized.components.length,
    wireAddresses: wire.addresses.length,
  };

  const hintsApplied =
    hints.foldChunks.length > 0 ||
    hints.preloadRoutes.length > 0 ||
    Object.keys(hints.batchSizes).length > 0 ||
    hints.encodingSpecialization.length > 0;
  const inputsHash = computeCacheKey({ source, profile: config.profile, target: config.target });

  return {
    config,
    engine,
    optimized,
    graph,
    browser,
    server,
    wire,
    chunks,
    trace,
    buildMetrics,
    hints,
    hintsApplied,
    inputsHash,
    moduleName: parsed.name,
  };
}

function finalize(path: string, prep: Prepared, bundle: { code: string }): BuildResult {
  const toolchain = prep.engine.describe?.() ?? {
    lowlevel: `${prep.engine.name}@${prep.engine.version}`,
  };
  const manifest = buildManifest({
    profile: prep.config.profile,
    target: prep.config.target,
    inputsHash: prep.inputsHash,
    lowlevel: toolchain["lowlevel"] ?? `${prep.engine.name}@${prep.engine.version}`,
    toolchain,
    outputs: prep.chunks.map((c) => c.name),
    wireSchemas: prep.wire.schemas,
    metrics: prep.buildMetrics,
    preload: prep.hints.preloadRoutes,
    hintsApplied: prep.hintsApplied,
  });

  return {
    path,
    config: prep.config,
    ir: prep.optimized,
    graph: prep.graph,
    browser: prep.browser,
    server: prep.server,
    wire: prep.wire,
    chunks: prep.chunks,
    optimization: prep.trace,
    manifest,
    bundleCode: bundle.code,
  };
}

/** Compiles a .raptor module (synchronous, naive engine or a synchronous injected one). */
export function buildModule(source: string, path: string, options: BuildOptions = {}): BuildResult {
  const prep = prepare(source, path, options);
  const bundle = prep.engine.bundle([{ name: `${prep.moduleName}.browser.js`, code: prep.browser }]);
  return finalize(path, prep, bundle);
}

/**
 * Compiles asynchronously - required for the low-level Rolldown/Oxc engine
 * (async bundling). Uses bundleAsync when available, otherwise synchronous bundle.
 */
export async function buildModuleAsync(
  source: string,
  path: string,
  options: BuildOptions = {},
): Promise<BuildResult> {
  const prep = prepare(source, path, options);
  const modules = [{ name: `${prep.moduleName}.browser.js`, code: prep.browser }];
  const bundle = prep.engine.bundleAsync
    ? await prep.engine.bundleAsync(modules)
    : prep.engine.bundle(modules);
  return finalize(path, prep, bundle);
}
