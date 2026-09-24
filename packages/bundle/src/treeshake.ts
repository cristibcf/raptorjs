/**
 * Tree-shaking la nivel de MODUL, condus de exporturile cerute.
 *
 * Problema pe care o rezolva: un barrel (`export * from "./a.ts"` × 35) trage
 * toata biblioteca chiar daca folosesti un singur `Button`. Pornim din entry,
 * urmarim ce nume sunt chiar cerute si urmam doar re-exporturile care le
 * furnizeaza. Re-exporturile nefolosite sunt taiate din sursa inainte de
 * transpilare, deci modulele lor nu mai ajung niciodata in graf.
 *
 * **Ce NU face:** eliminarea declaratiilor nefolosite DIN interiorul unui modul.
 * Daca imporți un singur tip de grafic dintr-un fisier care contine unsprezece,
 * toate unsprezece raman. Asta ar cere un graf de dependente intre declaratii;
 * granularitatea de modul acopera cazul barrel-ului, care e cel care doare.
 *
 * **Siguranta:** un re-export se taie doar daca modulul tinta e fara efecte
 * secundare. Sursa adevarului e `"sideEffects": false` din cel mai apropiat
 * package.json; fara el, cadem pe o euristica conservatoare (orice instructiune
 * de nivel inalt care nu e declaratie inseamna "poate avea efecte").
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, parse as parsePath } from "node:path";
import { analyzeModule, type ModuleInfo } from "./esm-graph.ts";
import { resolveSpecifier } from "./resolve.ts";

/** Separator de cheie: NUL nu poate aparea nici intr-o cale, nici intr-un identificator. */
const KEY_SEP = String.fromCharCode(0);

export interface ShakeResult {
  /** Modulele care trebuie incluse in bundle. */
  included: Set<string>;
  /** Intervale de taiat din sursa fiecarui modul (re-exporturi nefolosite). */
  pruned: Map<string, Array<[number, number]>>;
  /** Cate re-exporturi au fost eliminate (pentru raportare). */
  prunedEdges: number;
}

interface Analysis {
  info: ModuleInfo;
  source: string;
}

/** Cache de `sideEffects` per director de pachet. */
const sideEffectsCache = new Map<string, boolean | null>();

/** Citeste `"sideEffects"` din cel mai apropiat package.json. `null` = nedeclarat. */
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
        // `false` = pachet pur. Un array de glob-uri il tratam ca "are efecte",
        // ca sa nu pretindem ca intelegem pattern-uri pe care nu le evaluam.
        if (pkg.sideEffects === false) value = false;
        else if (pkg.sideEffects !== undefined) value = true;
      } catch {
        value = null; // package.json stricat: nu presupunem nimic
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

/** Golește cache-ul de package.json (dev server: fisierele se pot schimba). */
export function resetSideEffectsCache(): void {
  sideEffectsCache.clear();
}

export interface ShakeOptions {
  /** Citirea fisierelor; injectabila pentru teste. */
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

  /** `true` daca `file` exporta `symbol`, direct sau prin re-export. */
  const provides = (file: string, symbol: string, guard = new Set<string>()): boolean => {
    const key = file + KEY_SEP + symbol;
    const cached = providesCache.get(key);
    if (cached !== undefined) return cached;
    if (guard.has(key)) return false; // ciclu de re-exporturi
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
        if (edge.namespaceAs !== null) continue; // deja in localExports
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

  /* ------------------------------------------------------- propagarea -- */

  const included = new Set<string>();
  /** Re-exporturile pastrate: `file -> set de indici din info.reExports`. */
  const keptEdges = new Map<string, Set<number>>();
  const requested = new Set<string>(); // `file\0symbol` deja procesate
  const wholeModules = new Set<string>(); // cerute integral (namespace/bare)

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
    // Modulul e inclus intreg (fara DCE intern), deci toate IMPORTURILE lui
    // trebuie satisfacute. Re-exporturile, in schimb, se urmeaza la cerere.
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
    // Namespace sau import bare: nu stim ce se foloseste, deci pastram toate
    // re-exporturile si includem tintele lor.
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
      // Declarat local. Daca vine dintr-un `export { x } from "y"`, edge-ul
      // respectiv trebuie pastrat si tinta ceruta.
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

    // Nu e local: il cautam prin `export * from ...`, urmand DOAR steaua care
    // chiar furnizeaza simbolul. Asta e taietura care elimina barrel-ul.
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
      // Simbol negasit (tip sters la transpilare, sau import gresit). Ca sa nu
      // stricam build-ul, pastram toate stelele modulului.
      info.reExports.forEach((edge, index) => {
        if (edge.names !== null) return;
        keepEdge(file, index);
        const target = resolve(edge.spec, file);
        if (target) needAll(target);
      });
    }
  };

  needAll(entryFile);

  /* ----------------------------------------------------------- taiere -- */

  // Intai stabilizam: un re-export catre un modul cu posibile efecte secundare
  // NU poate fi taiat, iar pastrarea lui poate aduce module noi in graf, care
  // la randul lor pot avea aceeasi problema. Repetam pana nu se mai schimba.
  let changed = true;
  while (changed) {
    changed = false;
    for (const file of [...included]) {
      const { info } = analyze(file);
      const kept = keptEdges.get(file);
      info.reExports.forEach((edge, index) => {
        if (kept?.has(index)) return;
        const target = resolve(edge.spec, file);
        if (!target) return; // extern: instructiunea ramane neatinsa
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
