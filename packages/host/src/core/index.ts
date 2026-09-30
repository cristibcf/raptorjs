/**
 * @raptorstack/host - the shared contract of the native hosts.
 *
 * Roadmap section 4 places the native host as a separate layer: window, WebView,
 * lifecycle, signing and distribution. This package is the contract of that
 * layer, not a platform implementation. The adapters (`@raptorstack/desktop`,
 * `@raptorstack/mobile`) make it concrete, and the native binary implements it on the
 * other side of the transport - without changing anything in the app.
 */
export { HOST_ERROR_CODES, HostError, isHostError, isHostErrorCode } from "./errors.ts";
export type { HostErrorCode } from "./errors.ts";

export {
  HOST_CAPABILITIES,
  HOST_TARGETS,
  availabilityOn,
  capabilitiesFor,
  decideCapability,
  hostCapability,
  requireCapability,
} from "./capabilities.ts";
export type { Availability, CapabilityVerdict, HostCapabilityDefinition, HostTarget } from "./capabilities.ts";

export {
  HOST_MANIFEST_FILENAME,
  parseHostManifest,
  requireHostManifest,
} from "./manifest.ts";
export type {
  HostManifest,
  HostManifestIssue,
  HostManifestParseResult,
  SigningIdentity,
  UpdateChannel,
  WindowDefaults,
} from "./manifest.ts";

export {
  METHODS,
  METHOD_CAPABILITY,
  PROTOCOL_VERSION,
  capabilityForMethod,
  decodeFrame,
  encodeFrame,
} from "./protocol.ts";
export type { CallFrame, EventFrame, FailureFrame, Frame, ResultFrame } from "./protocol.ts";

export { createMemoryChannel } from "./transport.ts";
export type { HostTransport } from "./transport.ts";

export { LIFECYCLE_STATES, canTransition, createLifecycle, pathTo } from "./lifecycle.ts";
export type { LifecycleMachine, LifecycleState } from "./lifecycle.ts";

export { createBridge } from "./bridge.ts";
export type { BridgeOptions, HostBridge, HostDescription } from "./bridge.ts";

export { serveHost } from "./host-server.ts";
export type { AuditEntry, HostServer, HostServerOptions, MethodHandler } from "./host-server.ts";

export { artifactName, planPackages } from "./packaging.ts";
export type { Artifact, InstallerFormat, PackagePlan, PlanOptions, SigningRequirement } from "./packaging.ts";
