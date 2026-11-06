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
 *  - **Bare specifiers** (`@raptorstack/raptorjs/dom`, `firebase/firestore`) are
 *    resolved against the package's own `exports` map, with the **conditions the
 *    caller asks for** - by default the browser ones, because `bundleApp` emits a
 *    browser bundle.
 *
 * Why this file no longer just calls `createRequire().resolve()` (v0.2.1): that
 * is Node's CJS resolver, and it applies the `node` and `require` conditions
 * unconditionally - there is no API to tell it otherwise. For any dependency
 * that ships a `node` branch, the bundler therefore picked the Node build and
 * packed it into a browser bundle. `@firebase/firestore` is the case that
 * surfaced it: the `node` branch pulls in `@grpc/grpc-js` and `protobufjs`,
 * whose `require("net")` / `require("http2")` / `require("tls")` reach the
 * browser as `modules["net"]`, which is `undefined`, and the page dies in the
 * loader with "Cannot read properties of undefined (reading 'call')" - no file,
 * no specifier, no clue. The build itself reported success.
 *
 * So resolution of a bare specifier is done here: find the package directory,
 * read its `package.json`, walk `exports` with the requested conditions, and
 * fall back to the legacy `browser` field and then `module`/`main`. A Node
 * builtin reached from a browser graph is now reported as `node-builtin` rather
 * than quietly left external, so the bundler can name the importer.
 *
 * A `.css` target (from either kind) is classified as `css` so the bundler can
 * collect it into a stylesheet instead of trying to execute it as a module.
 */
import { createRequire, builtinModules } from "node:module";
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";

const BUNDLEABLE = /\.(tsx?|jsx?|mjs|cjs)$/;
const CSS = /\.css$/;

/** Extensions probed for an extensionless path, in priority order. */
const TRY_EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
/** Index files probed when a path points at a directory. */
const TRY_INDEX = ["/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs", "/index.cjs"];

/** Node builtins, with and without the `node:` prefix. */
const BUILTINS = new Set<string>(builtinModules.flatMap((m) => [m, `node:${m}`]));

/**
 * The conditions a browser bundle asks for, in priority order. `browser` first
 * so a dual-published package gives us its browser build; `import` before
 * `require` so we get ESM, which the transpiler and the tree-shaker understand.
 */
export const BROWSER_CONDITIONS: readonly string[] = ["browser", "module", "import", "default"];

/** What Node itself would apply - for a bundle that really is for Node. */
export const NODE_CONDITIONS: readonly string[] = ["node", "import", "require", "default"];

export interface ResolveOptions {
  /**
   * Export conditions, in priority order. Defaults to {@link BROWSER_CONDITIONS}.
   * `raptor-bundle --platform node` passes {@link NODE_CONDITIONS}.
   */
  conditions?: readonly string[];
}

/** Classification of a specifier for the bundler. */
export type Resolution =
  /** A bundleable JS/TS source to pull into the graph. */
  | { kind: "module"; path: string }
  /** A stylesheet to collect into the bundle's CSS. */
  | { kind: "css"; path: string }
  /** Bare specifier that does not map to a source: left untouched. */
  | { kind: "external" }
  /**
   * A Node builtin reached from a graph that does not have `node` in its
   * conditions. Not external: there is no such thing in a browser, so emitting
   * `require("net")` produces a bundle that throws on load.
   */
  | { kind: "node-builtin"; spec: string }
  /** A relative/absolute import that points at no file: a hard error. */
  | { kind: "unresolved" };

function isPathSpecifier(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/") || isAbsolute(spec);
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** Resolves a relative/absolute specifier to an existing file on disk, or null. */
function resolveOnDisk(spec: string, importerFile: string): string | null {
  const base = resolvePath(dirname(importerFile), spec);
  for (const ext of TRY_EXT) {
    const candidate = base + ext;
    if (isFile(candidate)) return candidate;
  }
  for (const index of TRY_INDEX) {
    const candidate = base + index;
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** Splits `@scope/name/deep/path` into its package name and subpath. */
function splitBare(spec: string): { name: string; subpath: string } {
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  const rest = spec.slice(name.length);
  return { name, subpath: rest === "" ? "." : "." + rest };
}

/** Walks up from `fromDir` looking for `node_modules/<name>/package.json`. */
function findPackageDir(name: string, fromDir: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (isFile(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

type Manifest = Record<string, unknown>;

function readManifest(packageDir: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as Manifest;
  } catch {
    return null;
  }
}

/**
 * Picks a target out of an `exports` value for `conditions`.
 *
 * Deliberately a subset of the full algorithm: no `*` patterns beyond a single
 * trailing wildcard, and no `imports`/`#` specifiers. It covers what real
 * packages use for a subpath, and anything it cannot resolve falls through to
 * the legacy fields rather than guessing.
 */
function pickCondition(value: unknown, conditions: readonly string[]): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const picked = pickCondition(entry, conditions);
      if (picked !== null) return picked;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const map = value as Record<string, unknown>;
  // Ask for our conditions in OUR priority order, not the map's: a package that
  // lists `node` before `browser` must still give us its browser build.
  for (const condition of conditions) {
    if (condition in map) {
      const picked = pickCondition(map[condition], conditions);
      if (picked !== null) return picked;
    }
  }
  return null;
}

/** Resolves `subpath` against an `exports` field. */
function resolveExports(exports: unknown, subpath: string, conditions: readonly string[]): string | null {
  if (exports === null || exports === undefined) return null;

  // Sugar: `"exports": "./x.js"` or a bare condition map means the root only.
  const isSubpathMap =
    typeof exports === "object" &&
    !Array.isArray(exports) &&
    Object.keys(exports as Record<string, unknown>).some((k) => k === "." || k.startsWith("./"));
  if (!isSubpathMap) return subpath === "." ? pickCondition(exports, conditions) : null;

  const map = exports as Record<string, unknown>;
  if (subpath in map) return pickCondition(map[subpath], conditions);

  // A single trailing `*` pattern, longest prefix first.
  const patterns = Object.keys(map)
    .filter((k) => k.includes("*"))
    .sort((a, b) => b.length - a.length);
  for (const pattern of patterns) {
    const star = pattern.indexOf("*");
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const filled = subpath.slice(prefix.length, subpath.length - suffix.length);
    const target = pickCondition(map[pattern], conditions);
    if (target !== null) return target.replace(/\*/g, filled);
  }
  return null;
}

/**
 * The legacy top-level `browser` field: either a replacement for `main`, or a
 * map of paths to replacements. Still the only hint many older packages give,
 * and `@firebase/firestore` sets it alongside its `exports` map.
 */
function resolveBrowserField(manifest: Manifest, target: string | null): string | null {
  const browser = manifest["browser"];
  if (typeof browser === "string") return target === null ? browser : null;
  if (browser === null || typeof browser !== "object") return null;
  if (target === null) return null;
  const map = browser as Record<string, unknown>;
  for (const key of [target, "./" + target.replace(/^\.\//, "")]) {
    const replacement = map[key];
    if (typeof replacement === "string") return replacement;
    // `"./x.js": false` means "stub this out in a browser".
    if (replacement === false) return null;
  }
  return null;
}

/** Probes a resolved target inside a package, allowing an extensionless path. */
function fileInPackage(packageDir: string, target: string): string | null {
  const base = resolvePath(packageDir, target);
  for (const ext of TRY_EXT) {
    if (isFile(base + ext)) return base + ext;
  }
  for (const index of TRY_INDEX) {
    if (isFile(base + index)) return base + index;
  }
  return null;
}

/**
 * Resolves a bare specifier with explicit conditions. Returns the file, or null
 * when the package or the subpath cannot be resolved.
 */
function resolveBare(spec: string, importerFile: string, conditions: readonly string[]): string | null {
  const { name, subpath } = splitBare(spec);
  const packageDir = findPackageDir(name, dirname(importerFile));
  if (packageDir === null) return null;
  const manifest = readManifest(packageDir);
  if (manifest === null) return null;

  let target = resolveExports(manifest["exports"], subpath, conditions);

  const wantsBrowser = conditions.includes("browser");
  if (wantsBrowser) {
    // The legacy field wins over `main`, and may also redirect a target the
    // exports map chose - which is how a package says "not this file, in a
    // browser".
    const redirected = resolveBrowserField(manifest, target);
    if (redirected !== null) target = redirected;
  }

  if (target === null && subpath === ".") {
    for (const field of wantsBrowser ? ["browser", "module", "main"] : ["main", "module"]) {
      const value = manifest[field];
      if (typeof value === "string") {
        target = value;
        break;
      }
    }
  }

  if (target === null) {
    // No exports map and no field: a deep path into a package without one.
    return subpath === "." ? fileInPackage(packageDir, ".") : fileInPackage(packageDir, subpath);
  }
  return fileInPackage(packageDir, target);
}

/**
 * Classifies `spec` imported from `importerFile`. See the module comment for the
 * path-vs-bare distinction, why a path that resolves to nothing is an error, and
 * why bare specifiers are not handed to Node's resolver.
 */
export function classifySpecifier(spec: string, importerFile: string, options: ResolveOptions = {}): Resolution {
  const conditions = options.conditions ?? BROWSER_CONDITIONS;

  if (BUILTINS.has(spec)) {
    // `node` in the conditions means the output really is for Node, and a
    // builtin there is a legitimate external.
    return conditions.includes("node") ? { kind: "external" } : { kind: "node-builtin", spec };
  }

  if (isPathSpecifier(spec)) {
    const onDisk = resolveOnDisk(spec, importerFile);
    if (onDisk === null) return { kind: "unresolved" };
    if (CSS.test(onDisk)) return { kind: "css", path: onDisk };
    if (BUNDLEABLE.test(onDisk)) return { kind: "module", path: onDisk };
    // A relative import of some other asset (.json, .png, ...): not something the
    // bundler packs, but it DID resolve, so it is not an error. Left external.
    return { kind: "external" };
  }

  let resolved = resolveBare(spec, importerFile, conditions);
  if (resolved === null) {
    // Last resort: Node's own resolver, for the layouts ours does not model
    // (a self-reference, a pnpm link outside the walked tree). It applies the
    // `node` conditions, so a browser build only falls back here when our own
    // walk found nothing at all - and anything it returns is still checked
    // below, so a builtin cannot slip in this way.
    try {
      resolved = createRequire(pathToFileURL(importerFile)).resolve(spec);
    } catch {
      // A bare specifier that does not resolve stays external (an importmap/CDN
      // may supply it at runtime). Only *path* imports are hard errors.
      return { kind: "external" };
    }
  }
  if (BUILTINS.has(resolved)) {
    return conditions.includes("node") ? { kind: "external" } : { kind: "node-builtin", spec };
  }
  if (CSS.test(resolved)) return { kind: "css", path: resolved };
  return BUNDLEABLE.test(resolved) ? { kind: "module", path: resolved } : { kind: "external" };
}

/**
 * Resolves `spec` from `importerFile` to a bundleable absolute path, or null.
 * Thin wrapper over {@link classifySpecifier} kept for callers that only care
 * about JS modules (CSS/external/builtin/unresolved all collapse to null).
 */
export function resolveSpecifier(spec: string, importerFile: string, options: ResolveOptions = {}): string | null {
  const r = classifySpecifier(spec, importerFile, options);
  return r.kind === "module" ? r.path : null;
}
