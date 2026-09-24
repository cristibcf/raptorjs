/**
 * @raptor/runtime - contractele de host RaptorRuntime.
 *
 * Pachetul nu contine CLI si nu porneste nimic de la sine: expune manifestul,
 * capability broker-ul, task fabric-ul, telemetria, adaptorul de motor si
 * modulele `raptor:`. Launcher-ul si, mai tarziu, host-ul nativ consuma exact
 * aceste tipuri (spec sectiunea 9: spatiu de lucru separat, aditiv).
 */
export { RaptorError, CapabilityError, isRaptorError } from "./errors.ts";
export type { RaptorErrorCode } from "./errors.ts";

export {
  CAPABILITY_KINDS,
  MANIFEST_FILENAME,
  parseManifest,
  requireManifest,
  stableStringify,
} from "./manifest.ts";
export type {
  CapabilityDeclarations,
  CapabilityKind,
  ManifestDependency,
  ManifestIssue,
  ManifestParseResult,
  PolicyMode,
  RuntimeManifest,
} from "./manifest.ts";

export { AMBIENT_KINDS, createBroker } from "./capabilities.ts";
export type { BrokerOptions, CapabilityBroker, CapabilityDecision, CapabilityDiagnostics, CapabilityUsage } from "./capabilities.ts";

export { containsPath, containsPathReal, normalizePath, realPath, relativeToRoot, resolvePath } from "./paths.ts";

export { createObserver, silentObserver } from "./observe.ts";
export type { Observer, ObserverOptions, RuntimeEvent, Severity, Span } from "./observe.ts";

export { createTaskFabric } from "./tasks.ts";
export type { SpawnOptions, TaskContext, TaskFabric, TaskFabricOptions, TaskStats } from "./tasks.ts";

export { buildStaticGraph, integrityOf, scanImports } from "./graph.ts";
export type { StaticGraph, StaticModule, UnresolvedImport } from "./graph.ts";

export { createBootstrapAdapter, resetModuleGraph } from "./engine-adapter.ts";
export type { EngineAdapter, EvaluationResult, ModuleGraphNode } from "./engine-adapter.ts";

export { RUNTIME_VERSION, createRuntime, loadProject } from "./host.ts";
export type { LoadedProject, RaptorRuntimeHost, RuntimeDiagnostics, RuntimeOptions, StartResult } from "./host.ts";

export type { HostContext } from "./context.ts";

export { createFiles } from "./modules/files.ts";
export type { FileEntry, FileInfo, RaptorFiles } from "./modules/files.ts";
export { createNet, destinationOf } from "./modules/net.ts";
export type { FetchOptions, RaptorNet } from "./modules/net.ts";
export { createProcess } from "./modules/process.ts";
export type { RaptorProcess, SpawnChildOptions, SpawnResult } from "./modules/process.ts";
export { createKv, createMemoryBacking } from "./modules/kv.ts";
export type { KvEntry, KvStore, RaptorKv } from "./modules/kv.ts";
export { createServe } from "./modules/serve.ts";
export type { Handler, RaptorServe, RequestInfoContext, RouteDefinition, RunningServer, ServeOptions } from "./modules/serve.ts";
