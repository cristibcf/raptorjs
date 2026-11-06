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
import {
  classifySpecifier,
  describeBadTarget,
  BROWSER_CONDITIONS,
  NODE_CONDITIONS,
  type ResolveOptions,
} from "./resolve.ts";
import { treeshake } from "./treeshake.ts";
import { blankRanges, maskCommentsAndStrings } from "./esm-graph.ts";

// TS emits requires with a string literal: `require("spec")`. We rewrite them selectively,
// only when `spec` resolves to a bundleable file (otherwise we leave it external).
const REQUIRE_RE = /require\(\s*(['"])(.*?)\1\s*\)/g;
// Non-global twin, to read the specifier back out of one match (REQUIRE_RE is
// stateful, so it cannot be re-run inside the scan loop).
const SPEC_OF_REQUIRE = /require\(\s*(['"])([\s\S]*?)\1\s*\)/;

export interface BundleOptions extends TranspileOptions, ResolveOptions {
  /**
   * Removes unused re-exports before transpilation, so their modules no longer
   * enter the graph. Defaults to `true`. See `treeshake.ts` for what it does and
   * does not do.
   */
  treeshake?: boolean;
  /**
   * Which export conditions a dependency is resolved with (v0.2.1).
   * `"browser"` (the default) asks for `browser`/`module`/`import`/`default`;
   * `"node"` asks for what Node itself would apply.
   *
   * It defaults to the browser because that is what this function emits. Until
   * 0.2.1 resolution went through Node's own resolver, which applies the `node`
   * condition and cannot be told otherwise, so a dependency with a `node`
   * branch had its Node build packed into the browser bundle.
   */
  platform?: "browser" | "node";
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

  const resolveOptions: ResolveOptions = {
    conditions: options.conditions ?? (options.platform === "node" ? NODE_CONDITIONS : BROWSER_CONDITIONS),
  };

  // ESM analysis runs BEFORE transpilation: after the CommonJS emit,
  // `export * from "x"` becomes a dynamic `require`, impossible to analyze.
  // It resolves with the same conditions, or it would walk a different graph
  // than the one being bundled.
  const shake =
    options.treeshake === false ? null : treeshake(entryFile, { resolveOptions });

  const seen = new Set<string>();
  /**
   * Who first pulled each module in, and under what specifier. A builtin is
   * never imported by the file the developer wrote - it arrives four or five
   * hops down a dependency - so naming only the nearest importer still leaves
   * the real question open. This is what lets the error print the whole chain.
   */
  const importedBy = new Map<string, { importer: string; spec: string }>();
  const queue: string[] = [entryFile];
  idFor(entryFile); // entry becomes ID 0

  /**
   * The import chain from the entry down to `file`, as one indented block.
   * Walks `importedBy` backwards, and stops on a cycle rather than looping.
   */
  const chainOf = (file: string, leaf: string): string => {
    const hops: string[] = [leaf];
    const visited = new Set<string>();
    let at: string | undefined = file;
    while (at !== undefined && !visited.has(at)) {
      visited.add(at);
      hops.unshift(at);
      at = importedBy.get(at)?.importer;
    }
    if (hops.length < 3) return ""; // the nearest importer already said it all
    return `  chain: ${hops.join(" -> ")}\n`;
  };

  while (queue.length > 0) {
    const abs = queue.shift()!;
    if (seen.has(abs)) continue;
    seen.add(abs);

    const raw = readFileSync(abs, "utf8");
    // Pruning replaces the characters with spaces, preserving the lines: the
    // source-map numbers stay valid for the original file.
    const source = shake ? blankRanges(raw, shake.pruned.get(abs) ?? []) : raw;
    const emitted = transpile(source, abs, options);

    // Scan a MASKED copy of the emitted source so a `require(...)` that is only
    // mentioned in a comment or inside a string body is not taken for a
    // dependency - it would otherwise trip the Node-builtin build error below.
    // The real specifier is read back from the untouched text, and a require
    // inside a `${ ... }` interpolation is still live code and is still seen.
    const masked = maskCommentsAndStrings(emitted);
    const rewriteRequire = (specStr: string, match: string): string => {
      const r = classifySpecifier(specStr, abs, resolveOptions);
      switch (r.kind) {
        case "module":
          if (!seen.has(r.path)) {
            if (!importedBy.has(r.path)) importedBy.set(r.path, { importer: abs, spec: specStr });
            queue.push(r.path);
          }
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
        case "node-builtin":
          // Left external until 0.2.1, which emitted `require("net")` into a
          // browser bundle: the loader does `modules[id].call(...)`, so the
          // page died with "Cannot read properties of undefined (reading
          // 'call')" - no file, no specifier. Fail the BUILD instead, and print
          // the whole chain: the nearest importer alone is typically four hops
          // from the file anyone wrote, so it names a symptom rather than a
          // cause.
          throw new Error(
            `[raptor] ${JSON.stringify(r.spec)} is a Node builtin and cannot go into a browser bundle\n` +
              `  imported from ${abs}\n` +
              chainOf(abs, r.spec) +
              `  this usually means a dependency resolved to its Node build; if the bundle really is ` +
              `for Node, pass platform: "node" (raptor-bundle --platform node)`,
          );
        case "bad-target":
          // The exports map named a file that is not there. Reported rather
          // than retried through Node's resolver, which applies the `node`
          // condition and would hand a browser build a Node entry point again.
          throw new Error(`${describeBadTarget(r)}\n  imported from ${abs}\n` + chainOf(abs, specStr));
        case "external":
          return match; // bare external -> left untouched
      }
    };

    REQUIRE_RE.lastIndex = 0;
    let rewritten = "";
    let last = 0;
    for (let m: RegExpExecArray | null; (m = REQUIRE_RE.exec(masked)) !== null; ) {
      const start = m.index;
      const end = start + m[0].length;
      // The match came from `masked`, where the string body is blanked; take the
      // real require (and its specifier) from the original emitted text.
      const slice = emitted.slice(start, end);
      const spec = SPEC_OF_REQUIRE.exec(slice);
      rewritten += emitted.slice(last, start) + rewriteRequire(spec ? spec[2]! : "", slice);
      last = end;
    }
    rewritten += emitted.slice(last);

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
