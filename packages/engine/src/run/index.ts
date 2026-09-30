/**
 * @raptor/run - RaptorRun: server runtime (whitepaper RaptorEngine 19-21).
 *
 * Wires serverSignal -> reactive store -> RaptorWire -> client from the same
 * semantic graph produced by RaptorEngine, plus routing, SSR/resume, sessions,
 * observability and Node/memory targets.
 */
export {
  RaptorRuntime,
  type RunConfig,
  type ServerSignalDef,
  type RuntimeMetrics,
  type RuntimeEvent,
  type HttpResult,
  type Channel,
} from "./runtime.ts";

export { matchRoute, type RouteDef, type RouteMatch } from "./router.ts";

export {
  renderComponent,
  renderDocument,
  type SsrResult,
  type ResumePayload,
  type ResumeSignal,
  type SsrOptions,
} from "./ssr.ts";

export { evalExpr, type Env } from "./eval.ts";

export { createNodeServer, listen, closeServer } from "./node.ts";

export {
  RaptorDevServer,
  readFirstSseEvent,
  type DevServerOptions,
} from "./dev-server.ts";

export { runRunCli, type RunCliResult } from "./cli.ts";
