/**
 * Adapter for the low-level engine (RaptorEngine whitepaper 2, 37).
 *
 * "Progressive ownership": bundling/minify remain swappable primitives behind
 * this interface. RaptorEngine OWNS the semantics; the low-level engine
 * (Rolldown for bundling, Oxc for parse/transform/minify) is an OPTIONAL
 * dependency, detected dynamically at runtime - NOT a workspace dependency (to
 * preserve the zero-dep invariant). If it is missing, fall back to the naive engine.
 *
 * The criteria for fully replacing Rolldown/Oxc are in §37: only when
 * measurements prove they bring a real advantage.
 */

export interface LowLevelModule {
  name: string;
  code: string;
}

export interface LowLevelBundle {
  code: string;
  moduleCount: number;
  minified: boolean;
}

export interface LowLevelEngine {
  readonly name: string;
  readonly version: string;
  /** Synchronous bundle (naive engine). */
  bundle(modules: LowLevelModule[]): LowLevelBundle;
  /** Async bundle (Rolldown/Oxc). Preferred by buildModuleAsync when available. */
  bundleAsync?(modules: LowLevelModule[]): Promise<LowLevelBundle>;
  /** The toolchain versions for the build manifest (21.2). */
  describe?(): Record<string, string>;
}

/**
 * Naive engine v0.1: concatenates the modules into a single bundle. Enough as a
 * demonstrable seam and as a zero-dep fallback when Rolldown/Oxc are missing.
 */
export const NaiveEngine: LowLevelEngine = {
  name: "naive",
  version: "0.1.0",
  bundle(modules: LowLevelModule[]): LowLevelBundle {
    const code = modules.map((m) => `// --- ${m.name} ---\n${m.code}`).join("\n\n");
    return { code, moduleCount: modules.length, minified: false };
  },
  describe(): Record<string, string> {
    return { lowlevel: "naive@0.1.0" };
  },
};

/**
 * A dynamic import that is NOT analyzed by tsc (specifier hidden in a variable),
 * so we do not require the Rolldown types/package at typecheck time. Returns
 * null if the package is not installed.
 *
 * Two-step resolution: first from the engine's location, then from the
 * project's working directory (like a real bundler plugin - Rolldown/Oxc live
 * in the application's node_modules, not the tool's).
 */
async function optionalImport(spec: string): Promise<unknown> {
  const dynamic = spec; // breaks static analysis of the specifier
  try {
    return await import(dynamic);
  } catch {
    /* try resolving from cwd */
  }
  try {
    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    const req = createRequire(pathToFileURL(process.cwd() + "/").href);
    const resolved = req.resolve(dynamic);
    return await import(pathToFileURL(resolved).href);
  } catch {
    return null;
  }
}

/** Externals: runtime dependencies stay external (we do not bundle them in v0.1). */
const RAPTOR_EXTERNALS = ["@raptorstack/raptorjs", "@raptorstack/raptorjs/dom"];

export interface RolldownOptions {
  minify?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Builds a LowLevelEngine based on Rolldown (bundling) + Oxc (minify). Throws
 * if Rolldown is not installed - use loadLowLevelEngine for automatic fallback.
 */
export async function createRolldownEngine(options: RolldownOptions = {}): Promise<LowLevelEngine> {
  const rd = (await optionalImport("rolldown")) as any;
  if (!rd || typeof rd.rolldown !== "function") {
    throw new Error(
      "[raptor:engine] Rolldown not found. Install it for the production build: `npm i -D rolldown` (optional; §37).",
    );
  }
  const oxc = (await optionalImport("oxc-minify")) as any;
  const version = typeof rd.VERSION === "string" ? rd.VERSION : "installed";

  return {
    name: "rolldown",
    version,
    bundle(): LowLevelBundle {
      throw new Error("[raptor:engine] the rolldown engine is async; use buildModuleAsync");
    },
    async bundleAsync(modules: LowLevelModule[]): Promise<LowLevelBundle> {
      // Virtual modules: each input becomes an in-memory module; the entry
      // re-exports them so Rolldown does real tree-shaking + bundling.
      const entryId = "\0raptor:entry";
      const virtual = new Map<string, string>();
      const reexports: string[] = [];
      modules.forEach((m, i) => {
        const id = `\0raptor:mod${i}`;
        virtual.set(id, m.code);
        reexports.push(`export * from ${JSON.stringify(id)};`);
      });
      virtual.set(entryId, reexports.join("\n"));

      const plugin = {
        name: "raptor-virtual",
        resolveId(source: string): string | null {
          return source === entryId || virtual.has(source) ? source : null;
        },
        load(id: string): string | null {
          return virtual.get(id) ?? null;
        },
      };

      const bundle = await rd.rolldown({
        input: entryId,
        plugins: [plugin],
        external: RAPTOR_EXTERNALS,
      });
      const minify = options.minify === true;
      const { output } = await bundle.generate({ format: "esm", minify });
      if (typeof bundle.close === "function") await bundle.close();

      let code = String(output[0]?.code ?? "");
      let minified = minify;
      // Explicit minify via Oxc if Rolldown did not minify but Oxc is present.
      if (!minify && oxc && typeof oxc.minify === "function") {
        const res = oxc.minify("bundle.js", code);
        if (res && typeof res.code === "string") {
          code = res.code;
          minified = true;
        }
      }
      return { code, moduleCount: modules.length, minified };
    },
    describe(): Record<string, string> {
      return {
        lowlevel: `rolldown@${version}`,
        rolldown: version,
        oxc: oxc ? "installed" : "absent",
      };
    },
  };
}

export type EngineName = "naive" | "rolldown" | "auto";

export interface LoadEngineOptions {
  minify?: boolean;
  /** true (default for 'auto'): fall back to naive if Rolldown is missing. */
  fallback?: boolean;
}

function fallbackEngine(reason: unknown): LowLevelEngine {
  const detail = reason instanceof Error ? reason.message : String(reason);
  return {
    name: "naive",
    version: "0.1.0",
    bundle: NaiveEngine.bundle,
    describe(): Record<string, string> {
      return { lowlevel: "naive@0.1.0 (fallback)", reason: detail };
    },
  };
}

/**
 * Resolves a low-level engine by name, with detection + fallback:
 *   'naive'    -> naive engine (zero-dep).
 *   'rolldown' -> Rolldown/Oxc; fall back to naive only if options.fallback.
 *   'auto'     -> Rolldown if installed, otherwise naive.
 */
export async function loadLowLevelEngine(
  name: EngineName,
  options: LoadEngineOptions = {},
): Promise<LowLevelEngine> {
  if (name === "naive") return NaiveEngine;
  const wantFallback = name === "auto" || options.fallback === true;
  try {
    return await createRolldownEngine({ minify: options.minify });
  } catch (err) {
    if (wantFallback) return fallbackEngine(err);
    throw err;
  }
}

/** Reports which low-level toolchain is available (for diagnostics/inspect). */
export async function detectToolchain(): Promise<{ rolldown: string | null; oxc: string | null }> {
  const rd = (await optionalImport("rolldown")) as any;
  const oxc = (await optionalImport("oxc-minify")) as any;
  return {
    rolldown: rd && typeof rd.rolldown === "function" ? (typeof rd.VERSION === "string" ? rd.VERSION : "installed") : null,
    oxc: oxc && typeof oxc.minify === "function" ? "installed" : null,
  };
}
