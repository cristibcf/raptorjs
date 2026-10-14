/**
 * Bundler: starts from the entry, transforms each module (transform.ts), discovers
 * the dependencies from the emitted `require("spec")` calls, resolves them
 * (resolve.ts) and rewrites them to internal numeric IDs, then emits a single file
 * with a module registry using a lazy `require`. The @raptorstack/* graph is a closed,
 * zero-dep ESM, so bundling is deterministic and complete.
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { transpile, type TranspileOptions } from "./transform.ts";
import { classifySpecifier } from "./resolve.ts";
import { treeshake } from "./treeshake.ts";
import { blankRanges } from "./esm-graph.ts";

// TS emits requires with a string literal: `require("spec")`. We rewrite them selectively,
// only when `spec` resolves to a bundleable file (otherwise we leave it external).
const REQUIRE_RE = /require\(\s*(['"])(.*?)\1\s*\)/g;

export interface BundleOptions extends TranspileOptions {
  /**
   * Removes unused re-exports before transpilation, so their modules no longer
   * enter the graph. Defaults to `true`. See `treeshake.ts` for what it does and
   * does not do.
   */
  treeshake?: boolean;
}

export interface BundleResult {
  /** The final code, a single IIFE with a module registry. */
  code: string;
  /** The included files, in discovery order (entry first). */
  files: string[];
  /** How many re-exports were cut by tree-shaking. */
  shaken: number;
  /** The collected stylesheets concatenated in discovery order (empty if none). */
  css: string;
  /** The absolute paths of the collected CSS files, in discovery order. */
  cssFiles: string[];
}

/** Bundles `entryFile` (an absolute path) into a single browser bundle. */
export function bundleApp(entryFile: string, options: BundleOptions = {}): BundleResult {
  const ids = new Map<string, number>(); // absolute path -> numeric ID
  const bodies = new Map<number, string>(); // ID -> rewritten module body
  const files: string[] = [];
  const cssSeen = new Set<string>(); // absolute path -> collected once
  const cssFiles: string[] = []; // CSS paths in discovery order

  const idFor = (abs: string): number => {
    let id = ids.get(abs);
    if (id === undefined) {
      id = ids.size;
      ids.set(abs, id);
    }
    return id;
  };

  // ESM analysis runs BEFORE transpilation: after the CommonJS emit,
  // `export * from "x"` becomes a dynamic `require`, impossible to analyze.
  const shake =
    options.treeshake === false ? null : treeshake(entryFile);

  const seen = new Set<string>();
  const queue: string[] = [entryFile];
  idFor(entryFile); // entry becomes ID 0

  while (queue.length > 0) {
    const abs = queue.shift()!;
    if (seen.has(abs)) continue;
    seen.add(abs);

    const raw = readFileSync(abs, "utf8");
    // Pruning replaces the characters with spaces, preserving the lines: the
    // source-map numbers stay valid for the original file.
    const source = shake ? blankRanges(raw, shake.pruned.get(abs) ?? []) : raw;
    const emitted = transpile(source, abs, options);

    const rewritten = emitted.replace(REQUIRE_RE, (match, _q, spec) => {
      const specStr = String(spec);
      const r = classifySpecifier(specStr, abs);
      switch (r.kind) {
        case "module":
          if (!seen.has(r.path)) queue.push(r.path);
          return `require(${idFor(r.path)})`;
        case "css":
          // `import "./x.css"` is a side-effect import: collect the file and drop
          // the require (CSS Modules - a default export of class names - are not
          // supported, so any binding resolves to an empty object).
          if (!cssSeen.has(r.path)) {
            cssSeen.add(r.path);
            cssFiles.push(r.path);
          }
          return "({})";
        case "unresolved":
          // Previously these were left external and vanished silently, so a
          // bundle could be emitted with a fraction of its real graph. Fail loud.
          throw new Error(
            `[raptor] cannot resolve import ${JSON.stringify(specStr)} from ${abs}\n` +
              `  a relative/absolute import must point at an existing file ` +
              `(tried ${specStr}[.ts|.tsx|.js|.jsx|.mjs|.cjs] and ${specStr}/index.*)`,
          );
        case "external":
          return match; // builtin / bare external -> left untouched
      }
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

  // Concatenate the stylesheets in discovery order, each preceded by a comment
  // naming its source (relative to the entry) so the combined file stays legible.
  const css = cssFiles
    .map((p) => `/* ${relative(process.cwd(), p).replace(/\\/g, "/")} */\n${readFileSync(p, "utf8")}`)
    .join("\n");

  return { code: parts.join("\n") + "\n", files, shaken: shake?.prunedEdges ?? 0, css, cssFiles };
}
