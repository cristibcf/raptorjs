/**
 * Graful de module static (spec sectiunea 5, componenta "Module graph").
 *
 * `pack` are nevoie sa stie ce fisiere intra in unitatea livrabila fara sa
 * execute aplicatia - altfel ambalarea ar depinde de efectele secundare ale
 * codului. Scanerul de aici rezolva doar ce poate rezolva cu certitudine:
 * specificatori literali, statici. Importurile dinamice cu expresie sunt
 * raportate explicit ca nerezolvate, nu ghicite.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { RaptorError } from "./errors.ts";
import { containsPath, normalizePath, relativeToRoot, resolvePath } from "./paths.ts";

export interface StaticModule {
  /** Cale relativa la radacina proiectului, cu `/` - stabila intre platforme. */
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
  /** Module `raptor:` si `node:` cerute de aplicatie. */
  readonly hostImports: readonly string[];
  readonly externalImports: readonly string[];
  readonly unresolved: readonly UnresolvedImport[];
}

/**
 * Grupul 1 prinde forma `import type` / `export type`, stearsa la incarcare:
 * un astfel de specificator nu este o dependinta de rulare, deci nu are ce cauta
 * nici in graf, nici in lockfile. `import { type A, b }` ramane import de
 * valoare, fiindca `b` chiar este necesar la rulare.
 */
const STATIC_IMPORT =
  /(?:^|[\s;{}()])(?:import|export)\s+(type\s+)?(?:[\w*{}\n\r\t, $]*?\s*from\s*)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

const DYNAMIC_IMPORT = /import\s*\(\s*(?!["'])/g;

/** Extensii incercate cand specificatorul nu are una (compatibil ESM relaxat). */
const EXTENSIONS = ["", ".ts", ".js", ".mts", ".mjs", "/index.ts", "/index.js"];

export function scanImports(source: string): { specifiers: string[]; dynamicCount: number } {
  const specifiers: string[] = [];
  STATIC_IMPORT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STATIC_IMPORT.exec(source)) !== null) {
    if (match[1]) continue; // `import type` / `export type`: sters la incarcare
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
 * Parcurge graful pornind de la `entry`. Nu paraseste niciodata radacina
 * proiectului: un import relativ care iese din proiect este o eroare de ambalare,
 * nu un fisier inclus tacit.
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
      throw new RaptorError("raptor:module/not-found", `modulul nu exista: ${relativeToRoot(root, current)}`, {
        path: current,
      });
    }

    const source = loaded.bytes.toString("utf8");
    const { specifiers, dynamicCount } = scanImports(source);
    const here = relativeToRoot(root, current);

    if (dynamicCount > 0) {
      unresolved.push({
        from: here,
        specifier: "import(<expresie>)",
        reason: `${dynamicCount} import(uri) dinamice cu specificator calculat; nu pot fi ambalate static`,
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
        unresolved.push({ from: here, specifier, reason: "fisierul nu a fost gasit" });
        continue;
      }
      if (!containsPath(root, target)) {
        unresolved.push({ from: here, specifier, reason: "iese din radacina proiectului" });
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
