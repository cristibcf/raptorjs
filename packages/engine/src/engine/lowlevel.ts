/**
 * Adapter pentru engine-ul low-level (whitepaper RaptorEngine 2, 37).
 *
 * "Progressive ownership": bundling/minify raman primitive schimbabile in
 * spatele acestei interfete. RaptorEngine DETINE semantica; engine-ul low-level
 * (Rolldown pentru bundling, Oxc pentru parse/transform/minify) e o dependenta
 * OPTIONALA, detectata dinamic la runtime - NU o dependenta de workspace (ca sa
 * pastram invariantul zero-dep). Daca lipseste, fallback la engine-ul naiv.
 *
 * Criteriile de inlocuire completa a Rolldown/Oxc sunt in §37: doar cand
 * masuratori demonstreaza ca aduc un avantaj real.
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
  /** Bundle sincron (engine naiv). */
  bundle(modules: LowLevelModule[]): LowLevelBundle;
  /** Bundle asincron (Rolldown/Oxc). Preferat de buildModuleAsync cand exista. */
  bundleAsync?(modules: LowLevelModule[]): Promise<LowLevelBundle>;
  /** Versiunile toolchain-ului pentru build manifest (21.2). */
  describe?(): Record<string, string>;
}

/**
 * Engine naiv v0.1: concateneaza modulele intr-un singur bundle. Suficient ca
 * seam demonstrabil si ca fallback zero-dep cand Rolldown/Oxc lipsesc.
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
 * Import dinamic care NU e analizat de tsc (specifier ascuns intr-o variabila),
 * ca sa nu cerem tipurile/pachetul Rolldown la typecheck. Intoarce null daca
 * pachetul nu e instalat.
 *
 * Rezolvare in doi pasi: intai din locatia engine-ului, apoi din directorul de
 * lucru al proiectului (ca un plugin de bundler adevarat - Rolldown/Oxc traiesc
 * in node_modules-ul aplicatiei, nu al tool-ului).
 */
async function optionalImport(spec: string): Promise<unknown> {
  const dynamic = spec; // rupe analiza statica a specifier-ului
  try {
    return await import(dynamic);
  } catch {
    /* incearca rezolvarea din cwd */
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

/** Externii: dependentele runtime raman externe (nu le bundluim in v0.1). */
const RAPTOR_EXTERNALS = ["raptorjs", "raptorjs/dom"];

export interface RolldownOptions {
  minify?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Construieste un LowLevelEngine bazat pe Rolldown (bundling) + Oxc (minify).
 * Arunca daca Rolldown nu e instalat - folositi loadLowLevelEngine pentru
 * fallback automat.
 */
export async function createRolldownEngine(options: RolldownOptions = {}): Promise<LowLevelEngine> {
  const rd = (await optionalImport("rolldown")) as any;
  if (!rd || typeof rd.rolldown !== "function") {
    throw new Error(
      "[raptor:engine] Rolldown negasit. Instaleaza-l pentru build-ul de productie: `npm i -D rolldown` (optional; §37).",
    );
  }
  const oxc = (await optionalImport("oxc-minify")) as any;
  const version = typeof rd.VERSION === "string" ? rd.VERSION : "installed";

  return {
    name: "rolldown",
    version,
    bundle(): LowLevelBundle {
      throw new Error("[raptor:engine] engine-ul rolldown e asincron; foloseste buildModuleAsync");
    },
    async bundleAsync(modules: LowLevelModule[]): Promise<LowLevelBundle> {
      // Module virtuale: fiecare input devine un modul in-memory; entry-ul le
      // re-exporta pentru ca Rolldown sa faca tree-shaking + bundling real.
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
      // Minify explicit prin Oxc daca Rolldown nu a minificat dar Oxc exista.
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
  /** true (default pentru 'auto'): fallback la naiv daca Rolldown lipseste. */
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
 * Rezolva un engine low-level dupa nume, cu detectie + fallback:
 *   'naive'    -> engine naiv (zero-dep).
 *   'rolldown' -> Rolldown/Oxc; fallback la naiv doar daca options.fallback.
 *   'auto'     -> Rolldown daca e instalat, altfel naiv.
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

/** Raporteaza ce toolchain low-level e disponibil (pentru diagnostics/inspect). */
export async function detectToolchain(): Promise<{ rolldown: string | null; oxc: string | null }> {
  const rd = (await optionalImport("rolldown")) as any;
  const oxc = (await optionalImport("oxc-minify")) as any;
  return {
    rolldown: rd && typeof rd.rolldown === "function" ? (typeof rd.VERSION === "string" ? rd.VERSION : "installed") : null,
    oxc: oxc && typeof oxc.minify === "function" ? "installed" : null,
  };
}
