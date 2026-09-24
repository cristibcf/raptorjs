/**
 * @raptor/host - contractul comun al host-urilor native.
 *
 * Roadmap sectiunea 4 aseaza host-ul nativ ca strat separat: fereastra, WebView,
 * lifecycle, semnare si distributie. Pachetul acesta este contractul acelui
 * strat, nu o implementare de platforma. Adaptoarele (`@raptor/desktop`,
 * `@raptor/mobile`) il concretizeaza, iar binarul nativ il implementeaza de
 * cealalta parte a transportului - fara sa schimbe nimic in aplicatie.
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
