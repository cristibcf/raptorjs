/**
 * Host-ul RaptorRuntime: leaga manifest, capabilitati, task fabric, telemetrie
 * si spatiul de nume `raptor:` intr-un singur obiect cu ciclu de viata explicit.
 *
 * Acesta este contractul pe care il va implementa host-ul nativ; launcher-ul
 * (`@raptor/runtime-cli`) nu stie nimic despre motor, doar despre acest API.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createBroker } from "./capabilities.ts";
import type { CapabilityBroker, CapabilityDiagnostics } from "./capabilities.ts";
import type { HostContext } from "./context.ts";
import { createBootstrapAdapter } from "./engine-adapter.ts";
import type { EngineAdapter, ModuleGraphNode } from "./engine-adapter.ts";
import { RaptorError } from "./errors.ts";
import { MANIFEST_FILENAME, requireManifest } from "./manifest.ts";
import type { RuntimeManifest } from "./manifest.ts";
import { createFiles } from "./modules/files.ts";
import { createKv } from "./modules/kv.ts";
import { createNet } from "./modules/net.ts";
import { createProcess } from "./modules/process.ts";
import { createServe } from "./modules/serve.ts";
import { createObserver } from "./observe.ts";
import type { Observer, RuntimeEvent } from "./observe.ts";
import { containsPath, normalizePath, resolvePath } from "./paths.ts";
import { createTaskFabric } from "./tasks.ts";
import type { TaskFabric, TaskStats } from "./tasks.ts";

export const RUNTIME_VERSION = "0.1.0";

export interface RuntimeOptions {
  readonly projectRoot: string;
  readonly manifest: RuntimeManifest;
  readonly args?: readonly string[];
  readonly observer?: Observer;
  readonly adapter?: EngineAdapter;
  /** Mediul din care `raptor:process` poate citi variabile permise. */
  readonly env?: NodeJS.ProcessEnv;
  /** Forteaza regimul strict de capabilitati, indiferent de politica din manifest. */
  readonly strict?: boolean;
}

export interface RuntimeDiagnostics {
  readonly runtimeVersion: string;
  readonly engine: { readonly name: string; readonly version: string };
  readonly project: { readonly name: string; readonly version: string; readonly root: string; readonly entry: string };
  readonly capabilities: CapabilityDiagnostics;
  readonly tasks: TaskStats;
  readonly modules: readonly ModuleGraphNode[];
}

export interface StartResult {
  readonly namespace: Record<string, unknown>;
  readonly startupMs: number;
  readonly evaluationMs: number;
}

export interface RaptorRuntimeHost {
  readonly context: HostContext;
  readonly broker: CapabilityBroker;
  readonly tasks: TaskFabric;
  readonly observer: Observer;
  start(): Promise<StartResult>;
  shutdown(reason?: string): Promise<void>;
  /**
   * Se rezolva dupa ce oprirea s-a incheiat, indiferent cine a cerut-o.
   * Aplicatia poate cere oprirea singura (`raptor:process.requestExit`), deci
   * launcher-ul are nevoie de un semnal, nu doar de propriul apel `shutdown`.
   */
  whenStopped(): Promise<void>;
  diagnostics(): RuntimeDiagnostics;
  events(): readonly RuntimeEvent[];
}

/** Modulele publicate sub `raptor:`; numele urmeaza spec sectiunea 6. */
function buildModules(host: HostContext, env: NodeJS.ProcessEnv): Map<string, unknown> {
  return new Map<string, unknown>([
    ["files", createFiles(host)],
    ["net", createNet(host)],
    ["process", createProcess(host, env)],
    ["kv", createKv(host)],
    ["serve", createServe(host)],
    ["tasks", host.tasks],
    ["observe", host.observer],
    ["capabilities", host.broker],
  ]);
}

export function createRuntime(options: RuntimeOptions): RaptorRuntimeHost {
  const startedAt = performance.now();
  const projectRoot = normalizePath(options.projectRoot);
  const manifest = options.manifest;
  const observer = options.observer ?? createObserver();
  const adapter = options.adapter ?? createBootstrapAdapter();

  const broker = createBroker({
    declarations: manifest.capabilities,
    projectRoot,
    policy: manifest.policy,
    strict: options.strict ?? manifest.policy === "production",
    observer: observer.child("capability"),
  });

  const tasks = createTaskFabric({
    maxConcurrent: manifest.tasks.maxConcurrent,
    defaultDeadlineMs: manifest.tasks.defaultDeadlineMs,
    observer: observer.child("tasks"),
  });

  const context: HostContext = {
    projectRoot,
    manifest,
    broker,
    observer,
    tasks,
    args: [...(options.args ?? [])],
  };

  const modules = buildModules(context, options.env ?? process.env);
  const processModule = modules.get("process") as ReturnType<typeof createProcess>;
  let started = false;
  let shuttingDown: Promise<void> | null = null;
  let markStopped: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    markStopped = resolve;
  });

  const host: RaptorRuntimeHost = {
    context,
    broker,
    tasks,
    observer,

    async start(): Promise<StartResult> {
      if (started) throw new RaptorError("raptor:engine/evaluation", "runtime-ul a fost deja pornit", {});
      started = true;

      const entryPath = resolvePath(projectRoot, manifest.entry);
      if (!containsPath(projectRoot, entryPath)) {
        throw new RaptorError("raptor:module/not-found", "punctul de intrare trebuie sa fie in radacina proiectului", {
          entry: manifest.entry,
          projectRoot,
        });
      }

      observer.log("info", "runtime.start", {
        project: manifest.name,
        version: manifest.version,
        entry: manifest.entry,
        policy: manifest.policy,
        runtimeVersion: RUNTIME_VERSION,
      });

      adapter.install(modules);
      processModule.onExitRequest((code) => {
        void host.shutdown(`exit(${code})`);
      });

      const result = await adapter.evaluate(entryPath);
      const startupMs = performance.now() - startedAt;
      observer.metric("runtime.startupMs", startupMs);
      observer.metric("runtime.evaluationMs", result.durationMs);

      // Un `export default` functie este punctul de intrare al aplicatiei.
      const main = result.namespace["default"];
      if (typeof main === "function") {
        await tasks.spawn(() => (main as (ctx: HostContext) => unknown)(context), { name: "main" });
      }

      return { namespace: result.namespace, startupMs, evaluationMs: result.durationMs };
    },

    async shutdown(reason = "request"): Promise<void> {
      if (shuttingDown) return shuttingDown;
      shuttingDown = (async () => {
        observer.log("info", "runtime.shutdown", { reason });
        await tasks.shutdown(reason);
        adapter.dispose();
        markStopped();
      })();
      return shuttingDown;
    },

    whenStopped(): Promise<void> {
      return stopped;
    },

    diagnostics(): RuntimeDiagnostics {
      return {
        runtimeVersion: RUNTIME_VERSION,
        engine: { name: adapter.name, version: adapter.version },
        project: { name: manifest.name, version: manifest.version, root: projectRoot, entry: manifest.entry },
        capabilities: broker.diagnostics(),
        tasks: tasks.stats(),
        modules: adapter.graph(),
      };
    },

    events(): readonly RuntimeEvent[] {
      return observer.events();
    },
  };

  return host;
}

export interface LoadedProject {
  readonly projectRoot: string;
  readonly manifestPath: string;
  readonly manifest: RuntimeManifest;
}

/** Cauta `raptor.runtime.json` in sus, de la `from` pana la radacina discului. */
export async function loadProject(from: string): Promise<LoadedProject> {
  let current = normalizePath(from);
  for (;;) {
    const candidate = join(current, MANIFEST_FILENAME);
    try {
      const source = await readFile(candidate, "utf8");
      return { projectRoot: current, manifestPath: normalizePath(candidate), manifest: requireManifest(source) };
    } catch (error) {
      if (error instanceof RaptorError) throw error;
      const parent = normalizePath(dirname(current));
      if (parent === current) {
        throw new RaptorError("raptor:manifest/missing", `nu am gasit ${MANIFEST_FILENAME} pornind de la ${from}`, { from });
      }
      current = parent;
    }
  }
}
