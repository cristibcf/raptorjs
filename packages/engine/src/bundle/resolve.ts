/**
 * Specifier resolution. Two kinds of specifier are handled differently:
 *
 *  - **Relative / absolute paths** (`./x`, `../y`, `/z`) are resolved against the
 *    importer's directory, probing extensions (`.ts/.tsx/.js/.jsx/.mjs/.cjs`) and
 *    `/index.*`. Node's own resolver does NOT try these extensions for an
 *    extensionless relative import, which is why `import "./foo"` (pointing at
 *    `foo.ts`) used to fall through and be left external SILENTLY. A path import
 *    that resolves to nothing is now reported as `unresolved` so the bundler can
 *    fail loudly instead of emitting half a graph.
 *
 *  - **Bare specifiers** (`@raptorstack/raptorjs/dom`, `node:fs`) are delegated to
 *    the Node resolver (createRequire), which honours exports maps - including the
 *    `.ts` targets the @raptorstack/* packages expose directly. `node:` builtins and
 *    anything that does not map to a file stay external.
 *
 * A `.css` target (from either kind) is classified as `css` so the bundler can
 * collect it into a stylesheet instead of trying to execute it as a module.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";

const BUNDLEABLE = /\.(tsx?|jsx?|mjs|cjs)$/;
const CSS = /\.css$/;

/** Extensions probed for an extensionless path, in priority order. */
const TRY_EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
/** Index files probed when a path points at a directory. */
const TRY_INDEX = ["/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs", "/index.cjs"];

/** Classification of a specifier for the bundler. */
export type Resolution =
  /** A bundleable JS/TS source to pull into the graph. */
  | { kind: "module"; path: string }
  /** A stylesheet to collect into the bundle's CSS. */
  | { kind: "css"; path: string }
  /** Builtin / bare specifier that does not map to a source: left untouched. */
  | { kind: "external" }
  /** A relative/absolute import that points at no file: a hard error. */
  | { kind: "unresolved" };

function isPathSpecifier(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/") || isAbsolute(spec);
}

/** Resolves a relative/absolute specifier to an existing file on disk, or null. */
function resolveOnDisk(spec: string, importerFile: string): string | null {
  const base = resolvePath(dirname(importerFile), spec);
  for (const ext of TRY_EXT) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  for (const index of TRY_INDEX) {
    const candidate = base + index;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Classifies `spec` imported from `importerFile`. See the module comment for the
 * path-vs-bare distinction and why a path that resolves to nothing is an error.
 */
export function classifySpecifier(spec: string, importerFile: string): Resolution {
  if (spec.startsWith("node:")) return { kind: "external" };

  if (isPathSpecifier(spec)) {
    const onDisk = resolveOnDisk(spec, importerFile);
    if (onDisk === null) return { kind: "unresolved" };
    if (CSS.test(onDisk)) return { kind: "css", path: onDisk };
    if (BUNDLEABLE.test(onDisk)) return { kind: "module", path: onDisk };
    // A relative import of some other asset (.json, .png, ...): not something the
    // bundler packs, but it DID resolve, so it is not an error. Left external.
    return { kind: "external" };
  }

  // Bare specifier: the Node resolver handles exports maps and node_modules.
  try {
    const req = createRequire(pathToFileURL(importerFile));
    const resolved = req.resolve(spec);
    if (CSS.test(resolved)) return { kind: "css", path: resolved };
    return BUNDLEABLE.test(resolved) ? { kind: "module", path: resolved } : { kind: "external" };
  } catch {
    // A bare specifier that does not resolve stays external (an importmap/CDN may
    // supply it at runtime). Only *path* imports are treated as hard errors.
    return { kind: "external" };
  }
}

/**
 * Resolves `spec` from `importerFile` to a bundleable absolute path, or null.
 * Thin wrapper over {@link classifySpecifier} kept for callers that only care
 * about JS modules (CSS/external/unresolved all collapse to null).
 */
export function resolveSpecifier(spec: string, importerFile: string): string | null {
  const r = classifySpecifier(spec, importerFile);
  return r.kind === "module" ? r.path : null;
}
