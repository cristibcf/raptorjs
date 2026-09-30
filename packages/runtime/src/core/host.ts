/**
 * The RaptorRuntime host: ties manifest, capabilities, task fabric, telemetry
 * and the `raptor:` namespace into a single object with an explicit lifecycle.
 *
 * This is the contract the native host will implement; the launcher
 * (`@raptorstack/runtime-cli`) knows nothing about the engine, only about this API.
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
  /** The environment from which `raptor:process` can read allowed variables. */
  readonly env?: NodeJS.ProcessEnv;
  /** Forces the strict capability regime, regardless of the manifest's policy. */
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
   * Resolves once shutdown has completed, no matter who requested it.
   * The application can request its own shutdown (`raptor:process.requestExit`),
   * so the launcher needs a signal, not just its own `shutdown` call.
   */
  whenStopped(): Promise<void>;
  diagnostics(): RuntimeDiagnostics;
  events(): readonly RuntimeEvent[];
}

/** The modules published under `raptor:`; the names follow spec section 6. */
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
      if (started) throw new RaptorError("raptor:engine/evaluation", "the runtime has already been started", {});
      started = true;

      const entryPath = resolvePath(projectRoot, manifest.entry);
      if (!containsPath(projectRoot, entryPath)) {
        throw new RaptorError("raptor:module/not-found", "the entry point must be inside the project root", {
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

      // A `export default` function is the application's entry point.
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

/** Searches upward for `raptor.runtime.json`, from `from` to the disk root. */
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
        throw new RaptorError("raptor:manifest/missing", `could not find ${MANIFEST_FILENAME} starting from ${from}`, { from });
      }
      current = parent;
    }
  }
}
