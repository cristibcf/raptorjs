/**
 * MODULE-level tree-shaking, driven by the requested exports.
 *
 * The problem it solves: a barrel (`export * from "./a.ts"` × 35) drags in the
 * whole library even if you use a single `Button`. We start from the entry,
 * track which names are actually requested and follow only the re-exports that
 * provide them. Unused re-exports are cut from the source before transpilation,
 * so their modules never reach the graph.
 *
 * **What it does NOT do:** remove unused declarations FROM INSIDE a module.
 * If you import a single chart type from a file that contains eleven, all eleven
 * stay. That would require a dependency graph between declarations; module
 * granularity covers the barrel case, which is the one that hurts.
 *
 * **Safety:** a re-export is cut only if the target module is side-effect free.
 * The source of truth is `"sideEffects": false` from the nearest package.json;
 * without it, we fall back to a conservative heuristic (any top-level statement
 * that is not a declaration means "may have effects").
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, parse as parsePath } from "node:path";
import { analyzeModule, type ModuleInfo } from "./esm-graph.ts";
import { resolveSpecifier } from "./resolve.ts";

/** Key separator: NUL cannot appear in a path nor in an identifier. */
const KEY_SEP = String.fromCharCode(0);

export interface ShakeResult {
  /** The modules that must be included in the bundle. */
  included: Set<string>;
  /** Ranges to cut from each module's source (unused re-exports). */
  pruned: Map<string, Array<[number, number]>>;
  /** How many re-exports were removed (for reporting). */
  prunedEdges: number;
}

interface Analysis {
  info: ModuleInfo;
  source: string;
}

/** `sideEffects` cache, keyed per package directory. */
const sideEffectsCache = new Map<string, boolean | null>();

/** Reads `"sideEffects"` from the nearest package.json. `null` = undeclared. */
function declaredSideEffects(file: string): boolean | null {
  let dir = dirname(file);
  const root = parsePath(dir).root;
  const chain: string[] = [];

  for (;;) {
    const cached = sideEffectsCache.get(dir);
    if (cached !== undefined) {
      for (const d of chain) sideEffectsCache.set(d, cached);
      return cached;
    }
    chain.push(dir);

    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      let value: boolean | null = null;
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { sideEffects?: unknown };
        // `false` = pure package. An array of globs we treat as "has effects",
        // so we don't pretend to understand patterns we don't evaluate.
        if (pkg.sideEffects === false) value = false;
        else if (pkg.sideEffects !== undefined) value = true;
      } catch {
        value = null; // broken package.json: assume nothing
      }
      for (const d of chain) sideEffectsCache.set(d, value);
      return value;
    }

    const parent = dirname(dir);
    if (parent === dir || dir === root) {
      for (const d of chain) sideEffectsCache.set(d, null);
      return null;
    }
    dir = parent;
  }
}

/** Clears the package.json cache (dev server: files can change). */
export function resetSideEffectsCache(): void {
  sideEffectsCache.clear();
}

export interface ShakeOptions {
  /** File reading; injectable for tests. */
  read?: (file: string) => string;
  resolve?: (spec: string, importer: string) => string | null;
}

export function treeshake(entryFile: string, options: ShakeOptions = {}): ShakeResult {
  const read = options.read ?? ((file: string) => readFileSync(file, "utf8"));
  const resolve = options.resolve ?? resolveSpecifier;

  const analyses = new Map<string, Analysis>();
  const analyze = (file: string): Analysis => {
    let found = analyses.get(file);
    if (!found) {
      const source = read(file);
      found = { info: analyzeModule(source, file), source };
      analyses.set(file, found);
    }
    return found;
  };

  const isPure = (file: string): boolean => {
    const declared = declaredSideEffects(file);
    if (declared !== null) return declared === false;
    return !analyze(file).info.hasTopLevelStatements;
  };

  /* --------------------------------------------------------- `provides` -- */

  const providesCache = new Map<string, boolean>();

  /** `true` if `file` exports `symbol`, directly or through a re-export. */
  const provides = (file: string, symbol: string, guard = new Set<string>()): boolean => {
    const key = file + KEY_SEP + symbol;
    const cached = providesCache.get(key);
    if (cached !== undefined) return cached;
    if (guard.has(key)) return false; // re-export cycle
    guard.add(key);

    const { info } = analyze(file);
    let result = info.localExports.has(symbol);

    if (!result) {
      for (const edge of info.reExports) {
        if (edge.names !== null) {
          if (edge.names.some((n) => n.exported === symbol)) {
            result = true;
            break;
          }
          continue;
        }
        if (edge.namespaceAs !== null) continue; // already in localExports
        const target = resolve(edge.spec, file);
        if (target && provides(target, symbol, guard)) {
          result = true;
          break;
        }
      }
    }

    providesCache.set(key, result);
    return result;
  };

  /* ------------------------------------------------------- propagation -- */

  const included = new Set<string>();
  /** The kept re-exports: `file -> set of indices into info.reExports`. */
  const keptEdges = new Map<string, Set<number>>();
  const requested = new Set<string>(); // `file\0symbol` already processed
  const wholeModules = new Set<string>(); // requested wholesale (namespace/bare)

  const keepEdge = (file: string, index: number): void => {
    let set = keptEdges.get(file);
    if (!set) {
      set = new Set();
      keptEdges.set(file, set);
    }
    set.add(index);
  };

  const includeModule = (file: string): void => {
    if (included.has(file)) return;
    included.add(file);
    // The module is included whole (no internal DCE), so all of its IMPORTS
    // must be satisfied. Re-exports, by contrast, are followed on demand.
    for (const edge of analyze(file).info.imports) {
      const target = resolve(edge.spec, file);
      if (!target) continue;
      if (edge.namespace || edge.bare) needAll(target);
      else for (const name of edge.names) need(target, name);
    }
  };

  const needAll = (file: string): void => {
    if (wholeModules.has(file)) return;
    wholeModules.add(file);
    includeModule(file);
    // Namespace or bare import: we don't know what is used, so we keep all
    // re-exports and include their targets.
    const { info } = analyze(file);
    info.reExports.forEach((edge, index) => {
      keepEdge(file, index);
      const target = resolve(edge.spec, file);
      if (target) needAll(target);
    });
  };

  const need = (file: string, symbol: string): void => {
    const key = file + KEY_SEP + symbol;
    if (requested.has(key)) return;
    requested.add(key);
    includeModule(file);

    const { info } = analyze(file);
    if (info.localExports.has(symbol)) {
      // Declared locally. If it comes from an `export { x } from "y"`, that
      // edge must be kept and its target requested.
      info.reExports.forEach((edge, index) => {
        if (edge.namespaceAs === symbol) {
          keepEdge(file, index);
          const target = resolve(edge.spec, file);
          if (target) needAll(target);
          return;
        }
        const match = edge.names?.find((n) => n.exported === symbol);
        if (!match) return;
        keepEdge(file, index);
        const target = resolve(edge.spec, file);
        if (target) need(target, match.local);
      });
      return;
    }

    // Not local: we look for it through `export * from ...`, following ONLY the
    // star that actually provides the symbol. This is the cut that removes the barrel.
    let found = false;
    info.reExports.forEach((edge, index) => {
      if (found || edge.names !== null || edge.namespaceAs !== null) return;
      const target = resolve(edge.spec, file);
      if (!target || !provides(target, symbol)) return;
      found = true;
      keepEdge(file, index);
      need(target, symbol);
    });

    if (!found) {
      // Symbol not found (a type erased during transpilation, or a wrong import).
      // So as not to break the build, we keep all of the module's stars.
      info.reExports.forEach((edge, index) => {
        if (edge.names !== null) return;
        keepEdge(file, index);
        const target = resolve(edge.spec, file);
        if (target) needAll(target);
      });
    }
  };

  needAll(entryFile);

  /* ----------------------------------------------------------- pruning -- */

  // First we stabilize: a re-export to a module with possible side effects
  // CANNOT be cut, and keeping it may bring new modules into the graph, which
  // in turn may have the same problem. We repeat until nothing changes.
  let changed = true;
  while (changed) {
    changed = false;
    for (const file of [...included]) {
      const { info } = analyze(file);
      const kept = keptEdges.get(file);
      info.reExports.forEach((edge, index) => {
        if (kept?.has(index)) return;
        const target = resolve(edge.spec, file);
        if (!target) return; // external: the statement stays untouched
        if (isPure(target)) return;
        keepEdge(file, index);
        needAll(target);
        changed = true;
      });
    }
  }

  const pruned = new Map<string, Array<[number, number]>>();
  let prunedEdges = 0;

  for (const file of included) {
    const { info } = analyze(file);
    const kept = keptEdges.get(file);
    const ranges: Array<[number, number]> = [];

    info.reExports.forEach((edge, index) => {
      if (kept?.has(index)) return;
      if (!resolve(edge.spec, file)) return;
      ranges.push([edge.start, edge.end]);
      prunedEdges++;
    });

    if (ranges.length > 0) pruned.set(file, ranges);
  }

  return { included, pruned, prunedEdges };
}
