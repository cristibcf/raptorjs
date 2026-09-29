/**
 * Bundler: porneste din entry, transforma fiecare modul (transform.ts), descopera
 * dependentele din `require("spec")`-urile emise, le rezolva (resolve.ts) si le
 * rescrie la ID-uri numerice interne, apoi emite un singur fisier cu un registru
 * de module cu `require` lazy. Graful @raptor/* e ESM inchis si zero-dep, deci
 * impachetarea e deterministca si completa.
 */
import { readFileSync } from "node:fs";
import { transpile, type TranspileOptions } from "./transform.ts";
import { resolveSpecifier } from "./resolve.ts";
import { treeshake } from "./treeshake.ts";
import { blankRanges } from "./esm-graph.ts";

// TS emite require-uri cu string literal: `require("spec")`. Le rescriem selectiv,
// doar cand `spec` se rezolva la un fisier bundle-abil (altfel il lasam extern).
const REQUIRE_RE = /require\(\s*(['"])(.*?)\1\s*\)/g;

export interface BundleOptions extends TranspileOptions {
  /**
   * Elimina re-exporturile nefolosite inainte de transpilare, ca modulele lor
   * sa nu mai intre in graf. Implicit `true`. Vezi `treeshake.ts` pentru ce
   * face si ce nu face.
   */
  treeshake?: boolean;
}

export interface BundleResult {
  /** Codul final, un singur IIFE cu registru de module. */
  code: string;
  /** Fisierele incluse, in ordinea descoperirii (entry primul). */
  files: string[];
  /** Cate re-exporturi au fost taiate de tree-shaking. */
  shaken: number;
}

/** Impacheteaza `entryFile` (cale absoluta) intr-un singur bundle browser. */
export function bundleApp(entryFile: string, options: BundleOptions = {}): BundleResult {
  const ids = new Map<string, number>(); // cale absoluta -> ID numeric
  const bodies = new Map<number, string>(); // ID -> corp de modul rescris
  const files: string[] = [];

  const idFor = (abs: string): number => {
    let id = ids.get(abs);
    if (id === undefined) {
      id = ids.size;
      ids.set(abs, id);
    }
    return id;
  };

  // Analiza ESM ruleaza INAINTE de transpilare: dupa emisia CommonJS,
  // `export * from "x"` devine un `require` dinamic, imposibil de analizat.
  const shake =
    options.treeshake === false ? null : treeshake(entryFile);

  const seen = new Set<string>();
  const queue: string[] = [entryFile];
  idFor(entryFile); // entry devine ID 0

  while (queue.length > 0) {
    const abs = queue.shift()!;
    if (seen.has(abs)) continue;
    seen.add(abs);

    const raw = readFileSync(abs, "utf8");
    // Taierea inlocuieste caracterele cu spatii, pastrand liniile: numerele din
    // source map raman valabile pentru fisierul original.
    const source = shake ? blankRanges(raw, shake.pruned.get(abs) ?? []) : raw;
    const emitted = transpile(source, abs, options);

    const rewritten = emitted.replace(REQUIRE_RE, (match, _q, spec) => {
      const target = resolveSpecifier(String(spec), abs);
      if (!target) return match; // builtin / extern -> lasat neatins
      if (!seen.has(target)) queue.push(target);
      return `require(${idFor(target)})`;
    });

    bodies.set(idFor(abs), rewritten);
    files.push(abs);
  }

  const entryId = ids.get(entryFile)!;
  const parts: string[] = [];
  parts.push("(function(){");
  parts.push("var modules = {}, cache = {};");
  parts.push(
    "function require(id){var c=cache[id];if(c)return c.exports;" +
      "var m=cache[id]={exports:{}};modules[id].call(m.exports,m,m.exports,require);return m.exports;}",
  );
  for (const [id, body] of [...bodies.entries()].sort((a, b) => a[0] - b[0])) {
    parts.push(`modules[${id}] = function(module, exports, require){`);
    parts.push(body);
    parts.push("};");
  }
  parts.push(`require(${entryId});`);
  parts.push("})();");
  return { code: parts.join("\n") + "\n", files, shaken: shake?.prunedEdges ?? 0 };
}
