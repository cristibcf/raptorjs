/**
 * Adaptorul de motor (spec sectiunea 5).
 *
 * Motorul JavaScript sta in spatele acestei interfete tocmai ca inlocuirea lui
 * ulterioara (V8 printr-un adaptor ingust, in host-ul nativ Rust) sa nu schimbe
 * niciun API de aplicatie. In bootstrap folosim motorul deja prezent pe masina
 * de dezvoltare, dar codul de aplicatie nu il vede niciodata direct.
 *
 * Implementarea acopera cerintele spike-ului: incarca un modul TypeScript local
 * fara pas de compilare separat, expune spatiul de nume `raptor:` ca module
 * reale si inregistreaza graful de module pentru diagnostic.
 *
 * Izolarea: fiecare adaptor primeste un identificator de izolat, purtat ca
 * parametru de interogare pe URL-urile modulelor. Doua runtime-uri din acelasi
 * proces nu impart nici obiectele de host, nici starea de modul - exact
 * proprietatea ceruta de spec ("fiecare obiect de host este legat de un izolat
 * si de o capability acordata").
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
  /** Publica modulele `raptor:` pentru izolatul curent. */
  install(modules: ReadonlyMap<string, unknown>): void;
  evaluate(entryPath: string): Promise<EvaluationResult>;
  graph(): readonly ModuleGraphNode[];
  /** Traduce orice eroare a motorului intr-o eroare Raptor stabila. */
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

/** Izolatul caruia ii apartine un URL de modul (purtat in query string). */
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
 * Sursa sintetica pentru `raptor:<nume>`. Metodele sunt legate de obiectul
 * host, ca destructurarea din codul utilizatorului sa nu piarda contextul.
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

/** URL lizibil in diagnostice: fara parametrul intern de izolat. */
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
          throw new RaptorError("raptor:module/not-found", `'${specifier}' poate fi importat doar din codul rulat de RaptorRuntime`, {
            specifier,
          });
        }
        const table = isolates().get(isolateId);
        if (!table || !table.has(name)) {
          throw new RaptorError("raptor:module/not-found", `modulul '${specifier}' nu exista in acest runtime`, {
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

      // Doar modulele locale primesc identitate per izolat; builtin-urile si
      // pachetele externe raman partajate, ca in orice incarcator ESM.
      if (!resolved.url.startsWith("file:") || resolved.url.includes("/node_modules/")) return resolved;
      return { ...resolved, url: withIsolate(resolved.url, isolateId), shortCircuit: true };
    },

    load(url, context, nextLoad) {
      if (url.startsWith(RAPTOR_SCHEME)) {
        const isolateId = isolateOf(url);
        const name = url.slice(RAPTOR_SCHEME.length).split("?")[0]!;
        const table = isolateId ? isolates().get(isolateId) : undefined;
        if (!table) {
          throw new RaptorError("raptor:module/not-found", `izolatul modulului '${url}' nu mai exista`, { url });
        }
        return { format: "module", source: synthesize(isolateId!, name, table.get(name)), shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
}

let isolateCounter = 0;

/**
 * Adaptorul de bootstrap. Ruleaza in procesul curent; izolarea la nivel de motor
 * apartine host-ului nativ, iar aceasta implementare respecta acelasi contract.
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
      // Obiectele de host dispar odata cu izolatul; graful ramane pentru
      // diagnosticul de dupa oprire.
      isolates().delete(isolateId);
    },
  };
}

/** Golire a grafurilor inregistrate (teste de contract). */
export function resetModuleGraph(): void {
  graphs.clear();
}
