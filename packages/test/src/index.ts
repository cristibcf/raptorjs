/**
 * @raptor/test - RaptorTest: autonomous behavioral testing + backend digital twin.
 *
 * Pilonul de verificare al ecosistemului Raptor (RaptorJS = executie,
 * RaptorWire = comunicare, RaptorTest = verificare). Vezi whitepaper-ul
 * design/RaptorTest_Autonomous_Behavioral_Testing_Whitepaper_v0.1.pdf.
 */
export { VirtualClock } from "./clock.ts";
export { EventLog } from "./probe.ts";
export {
  semanticId,
  stableKey,
  actionId,
  semanticSimilarity,
  reidentify,
} from "./semantic.ts";
export { VirtualDB, RaptorTwin, type TwinRequest, type TwinResponse, type RouteHandler } from "./twin.ts";
export { NetworkController, defaultSchedule, DEFAULT_TIMING } from "./network.ts";
export { BehaviorGraph, stateId, type StateNode, type ActionEdge, type Transition } from "./behavior-graph.ts";
export { Coverage, type CoverageDimension } from "./coverage.ts";
export { actionScore, pickBest, type ScoreInputs } from "./explorer.ts";
export {
  type Invariant,
  type CustomInvariant,
  type OracleContext,
  type OracleResult,
  BUILTIN_INVARIANTS,
  noExceptions,
  noInfiniteLoading,
  evaluate,
} from "./oracle.ts";
export { chaosSchedules, type RouteInfo } from "./chaos.ts";
export { serializeCapsule, parseCapsule } from "./replay.ts";
export { RaptorTest, type RaptorTestConfig, type ScenarioResult, type Finding } from "./raptor-test.ts";
export {
  type SemanticNode,
  type ProbeEvent,
  type ProbeEventType,
  type AppState,
  type AppHarness,
  type HarnessContext,
  type NetworkSchedule,
  type RouteTiming,
  type ObservedRequest,
  type ObservedResponse,
  type Capsule,
} from "./types.ts";
