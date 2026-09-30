/**
 * The static module graph (spec section 5, the "Module graph" component).
 *
 * `pack` needs to know which files go into the deliverable unit without running
 * the application - otherwise packaging would depend on the code's side effects.
 * The scanner here resolves only what it can resolve with certainty: literal,
 * static specifiers. Dynamic imports with an expression are reported explicitly
 * as unresolved, not guessed.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { RaptorError } from "./errors.ts";
import { containsPath, normalizePath, relativeToRoot, resolvePath } from "./paths.ts";

export interface StaticModule {
  /** Path relative to the project root, with `/` - stable across platforms. */
  readonly path: string;
  readonly absolutePath: string;
  readonly integrity: string;
  readonly byteLength: number;
  readonly imports: readonly string[];
}

export interface UnresolvedImport {
  readonly from: string;
  readonly specifier: string;
  readonly reason: string;
}

export interface StaticGraph {
  readonly entry: string;
  readonly modules: readonly StaticModule[];
  /** `raptor:` and `node:` modules required by the application. */
  readonly hostImports: readonly string[];
  readonly externalImports: readonly string[];
  readonly unresolved: readonly UnresolvedImport[];
}

/**
 * Group 1 catches the `import type` / `export type` form, erased at load time:
 * such a specifier is not a runtime dependency, so it has no place in the graph
 * or in the lockfile. `import { type A, b }` stays a value import, because `b`
 * is actually needed at runtime.
 */
const STATIC_IMPORT =
  /(?:^|[\s;{}()])(?:import|export)\s+(type\s+)?(?:[\w*{}\n\r\t, $]*?\s*from\s*)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

const DYNAMIC_IMPORT = /import\s*\(\s*(?!["'])/g;

/** Extensions tried when the specifier has none (relaxed ESM-compatible). */
const EXTENSIONS = ["", ".ts", ".js", ".mts", ".mjs", "/index.ts", "/index.js"];

export function scanImports(source: string): { specifiers: string[]; dynamicCount: number } {
  const specifiers: string[] = [];
  STATIC_IMPORT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STATIC_IMPORT.exec(source)) !== null) {
    if (match[1]) continue; // `import type` / `export type`: erased at load time
    const specifier = match[2] ?? match[3];
    if (specifier) specifiers.push(specifier);
  }
  DYNAMIC_IMPORT.lastIndex = 0;
  const dynamicCount = source.match(DYNAMIC_IMPORT)?.length ?? 0;
  return { specifiers, dynamicCount };
}

export function integrityOf(bytes: Uint8Array | string): string {
  return "sha256-" + createHash("sha256").update(bytes).digest("base64");
}

async function tryRead(candidate: string): Promise<{ path: string; bytes: Buffer } | null> {
  try {
    return { path: candidate, bytes: await readFile(candidate) };
  } catch {
    return null;
  }
}

/**
 * Walks the graph starting from `entry`. It never leaves the project root: a
 * relative import that escapes the project is a packaging error, not a silently
 * included file.
 */
export async function buildStaticGraph(projectRoot: string, entry: string): Promise<StaticGraph> {
  const root = normalizePath(projectRoot);
  const entryPath = resolvePath(root, entry);
  const modules = new Map<string, StaticModule>();
  const hostImports = new Set<string>();
  const externalImports = new Set<string>();
  const unresolved: UnresolvedImport[] = [];
  const queue: string[] = [entryPath];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (modules.has(current)) continue;

    const loaded = await tryRead(current);
    if (!loaded) {
      throw new RaptorError("raptor:module/not-found", `module does not exist: ${relativeToRoot(root, current)}`, {
        path: current,
      });
    }

    const source = loaded.bytes.toString("utf8");
    const { specifiers, dynamicCount } = scanImports(source);
    const here = relativeToRoot(root, current);

    if (dynamicCount > 0) {
      unresolved.push({
        from: here,
        specifier: "import(<expression>)",
        reason: `${dynamicCount} dynamic import(s) with a computed specifier; they cannot be packaged statically`,
      });
    }

    const resolvedImports: string[] = [];
    for (const specifier of specifiers) {
      if (specifier.startsWith("raptor:") || specifier.startsWith("node:")) {
        hostImports.add(specifier);
        resolvedImports.push(specifier);
        continue;
      }
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
        externalImports.add(specifier);
        resolvedImports.push(specifier);
        continue;
      }

      const base = dirname(current);
      let target: string | null = null;
      for (const extension of EXTENSIONS) {
        const candidate = resolvePath(base, specifier + extension);
        const hit = await tryRead(candidate);
        if (hit) {
          target = candidate;
          break;
        }
      }

      if (!target) {
        unresolved.push({ from: here, specifier, reason: "the file was not found" });
        continue;
      }
      if (!containsPath(root, target)) {
        unresolved.push({ from: here, specifier, reason: "escapes the project root" });
        continue;
      }
      resolvedImports.push(relativeToRoot(root, target));
      queue.push(target);
    }

    modules.set(current, {
      path: here,
      absolutePath: current,
      integrity: integrityOf(loaded.bytes),
      byteLength: loaded.bytes.byteLength,
      imports: resolvedImports.sort(),
    });
  }

  return {
    entry: relativeToRoot(root, entryPath),
    modules: [...modules.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    hostImports: [...hostImports].sort(),
    externalImports: [...externalImports].sort(),
    unresolved: unresolved.sort((a, b) => (a.from + a.specifier < b.from + b.specifier ? -1 : 1)),
  };
}
