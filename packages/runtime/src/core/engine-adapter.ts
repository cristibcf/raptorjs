/**
 * The engine adapter (spec section 5).
 *
 * The JavaScript engine sits behind this interface precisely so that replacing
 * it later (V8 through a narrow adapter, in the native Rust host) does not change
 * any application API. In bootstrap we use the engine already present on the
 * development machine, but application code never sees it directly.
 *
 * The implementation covers the spike's requirements: it loads a local
 * TypeScript module with no separate compile step, exposes the `raptor:`
 * namespace as real modules, and records the module graph for diagnostics.
 *
 * Isolation: each adapter receives an isolate identifier, carried as a query
 * parameter on the module URLs. Two runtimes in the same process share neither
 * host objects nor module state - exactly the property the spec requires ("each
 * host object is bound to an isolate and to a granted capability").
 */
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { RaptorError } from "./errors.ts";
import { normalizePath } from "./paths.ts";

export interface ModuleGraphNode {
  readonly specifier: string;
  readonly url: string;
  readonly kind: "raptor" | "local" | "node" | "external";
  readonly importedBy: readonly string[];
}

export interface EvaluationResult {
  readonly namespace: Record<string, unknown>;
  readonly durationMs: number;
}

export interface EngineAdapter {
  readonly name: string;
  readonly version: string;
  readonly isolateId: string;
  /** Publishes the `raptor:` modules for the current isolate. */
  install(modules: ReadonlyMap<string, unknown>): void;
  evaluate(entryPath: string): Promise<EvaluationResult>;
  graph(): readonly ModuleGraphNode[];
  /** Translates any engine error into a stable Raptor error. */
  mapError(error: unknown): RaptorError;
  dispose(): void;
}

const RAPTOR_SCHEME = "raptor:";
const ISOLATE_PARAM = "__raptor_isolate";
const REGISTRY_KEY = "raptor.runtime.isolates";
const REGISTRY = Symbol.for(REGISTRY_KEY);

type IsolateTable = Map<string, Map<string, unknown>>;

function isolates(): IsolateTable {
  const global = globalThis as unknown as Record<symbol, IsolateTable | undefined>;
  let table = global[REGISTRY];
  if (!table) {
    table = new Map<string, Map<string, unknown>>();
    global[REGISTRY] = table;
  }
  return table;
}

/** The isolate a module URL belongs to (carried in the query string). */
function isolateOf(url: string | undefined): string | null {
  if (!url) return null;
  const index = url.indexOf(`${ISOLATE_PARAM}=`);
  if (index < 0) return null;
  const rest = url.slice(index + ISOLATE_PARAM.length + 1);
  const end = rest.search(/[&#]/);
  return end < 0 ? rest : rest.slice(0, end);
}

function withIsolate(url: string, isolateId: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${ISOLATE_PARAM}=${isolateId}`;
}

/**
 * Synthetic source for `raptor:<name>`. Methods are bound to the host object so
 * that destructuring in user code does not lose the context.
 */
function synthesize(isolateId: string, name: string, target: unknown): string {
  const keys =
    target && typeof target === "object"
      ? Object.keys(target as Record<string, unknown>).filter((key) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key))
      : [];

  const lookup =
    `globalThis[Symbol.for(${JSON.stringify(REGISTRY_KEY)})].get(${JSON.stringify(isolateId)}).get(${JSON.stringify(name)})`;
  const lines = [`const __mod = ${lookup};`, `export default __mod;`];
  for (const key of keys) {
    const literal = JSON.stringify(key);
    lines.push(
      `export const ${key} = typeof __mod[${literal}] === "function" ? __mod[${literal}].bind(__mod) : __mod[${literal}];`,
    );
  }
  return lines.join("\n");
}

interface GraphEntry {
  readonly specifier: string;
  readonly url: string;
  readonly kind: ModuleGraphNode["kind"];
  readonly importedBy: Set<string>;
}

const graphs = new Map<string, Map<string, GraphEntry>>();
let hooksInstalled = false;

function classify(url: string): ModuleGraphNode["kind"] {
  if (url.startsWith(RAPTOR_SCHEME)) return "raptor";
  if (url.startsWith("node:")) return "node";
  if (url.startsWith("file:")) return url.includes("/node_modules/") ? "external" : "local";
  return "external";
}

/** A URL readable in diagnostics: without the internal isolate parameter. */
function clean(url: string): string {
  return url.replace(new RegExp(`[?&]${ISOLATE_PARAM}=[^&#]*`), "");
}

function record(isolateId: string, specifier: string, url: string, parentURL: string | undefined): void {
  let graph = graphs.get(isolateId);
  if (!graph) {
    graph = new Map<string, GraphEntry>();
    graphs.set(isolateId, graph);
  }
  const key = clean(url);
  const existing = graph.get(key);
  if (existing) {
    if (parentURL) existing.importedBy.add(clean(parentURL));
    return;
  }
  graph.set(key, {
    specifier,
    url: key,
    kind: classify(key),
    importedBy: new Set(parentURL ? [clean(parentURL)] : []),
  });
}

function ensureHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  registerHooks({
    resolve(specifier, context, nextResolve) {
      const isolateId = isolateOf(specifier) ?? isolateOf(context.parentURL);

      if (specifier.startsWith(RAPTOR_SCHEME)) {
        const name = specifier.slice(RAPTOR_SCHEME.length).split("?")[0]!;
        if (!isolateId) {
          throw new RaptorError("raptor:module/not-found", `'${specifier}' can only be imported from code run by RaptorRuntime`, {
            specifier,
          });
        }
        const table = isolates().get(isolateId);
        if (!table || !table.has(name)) {
          throw new RaptorError("raptor:module/not-found", `module '${specifier}' does not exist in this runtime`, {
            specifier,
            available: table ? [...table.keys()].sort() : [],
          });
        }
        record(isolateId, specifier, `${RAPTOR_SCHEME}${name}`, context.parentURL);
        return { url: withIsolate(`${RAPTOR_SCHEME}${name}`, isolateId), format: "module", shortCircuit: true };
      }

      const resolved = nextResolve(specifier, context);
      if (!isolateId) return resolved;

      record(isolateId, specifier, resolved.url, context.parentURL);

      // Only local modules get a per-isolate identity; builtins and external
      // packages stay shared, as in any ESM loader.
      if (!resolved.url.startsWith("file:") || resolved.url.includes("/node_modules/")) return resolved;
      return { ...resolved, url: withIsolate(resolved.url, isolateId), shortCircuit: true };
    },

    load(url, context, nextLoad) {
      if (url.startsWith(RAPTOR_SCHEME)) {
        const isolateId = isolateOf(url);
        const name = url.slice(RAPTOR_SCHEME.length).split("?")[0]!;
        const table = isolateId ? isolates().get(isolateId) : undefined;
        if (!table) {
          throw new RaptorError("raptor:module/not-found", `the isolate of module '${url}' no longer exists`, { url });
        }
        return { format: "module", source: synthesize(isolateId!, name, table.get(name)), shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
}

let isolateCounter = 0;

/**
 * The bootstrap adapter. Runs in the current process.
 *
 * **Here the capability broker is advisory, not a boundary.** Application code
 * can write `import fs from "node:fs"` and reach the disk without the broker
 * being asked. The hooks above *record* `node:` imports (classify them in the
 * graph), but cannot block them without breaking exactly the packages the
 * launcher itself needs.
 *
 * The real boundary belongs to the native host, where `node:*` simply does not
 * exist and the only path to the system is the host functions. Until then, the
 * defense is in the tools, not in the engine: `raptor-runtime doctor` reports
 * every bypass, and `raptor-runtime run` refuses to start under the `production`
 * policy and writes it to the audit log in `development`
 * (`runtime-cli/src/bypass.ts`).
 *
 * The distinction matters: "isolation belongs to the native host" and "here it
 * can be bypassed" are not the same thing, and the second is the one whoever
 * chooses their threat model needs to know.
 */
export function createBootstrapAdapter(isolateId = `iso${++isolateCounter}`): EngineAdapter {
  return {
    name: "bootstrap",
    version: process.versions.v8 ?? "unknown",
    isolateId,

    install(modules: ReadonlyMap<string, unknown>): void {
      ensureHooks();
      const table = new Map<string, unknown>(modules);
      isolates().set(isolateId, table);
    },

    async evaluate(entryPath: string): Promise<EvaluationResult> {
      const url = withIsolate(pathToFileURL(normalizePath(entryPath)).href, isolateId);
      const started = performance.now();
      try {
        const namespace = (await import(url)) as Record<string, unknown>;
        return { namespace, durationMs: performance.now() - started };
      } catch (error) {
        throw this.mapError(error);
      }
    },

    graph(): readonly ModuleGraphNode[] {
      const graph = graphs.get(isolateId);
      if (!graph) return [];
      return [...graph.values()]
        .map((node) => ({
          specifier: node.specifier,
          url: node.url,
          kind: node.kind,
          importedBy: [...node.importedBy].sort(),
        }))
        .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
    },

    mapError(error: unknown): RaptorError {
      if (error instanceof RaptorError) return error;
      const cause = error instanceof Error ? error : new Error(String(error));
      const mapped = new RaptorError("raptor:engine/evaluation", cause.message, {
        origin: cause.name,
        stack: cause.stack ?? null,
      });
      mapped.stack = cause.stack ?? mapped.stack;
      return mapped;
    },

    dispose(): void {
      // Host objects disappear together with the isolate; the graph remains for
      // post-shutdown diagnostics.
      isolates().delete(isolateId);
    },
  };
}

/** Clears the recorded graphs (contract tests). */
export function resetModuleGraph(): void {
  graphs.clear();
}
