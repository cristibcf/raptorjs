/**
 * @raptor/profile - RaptorProfile: runtime telemetry + behavior-guided build
 * planning (whitepaper RaptorEngine 22-24). Produces strategy plan hints
 * (chunk folding, preload, batch, encoding), consumed by @raptor/engine via
 * `buildModule({ planHints })`. Never changes correctness (24).
 */
export {
  PROFILE_VERSION,
  emptyProfile,
  serializeProfile,
  type RaptorProfile,
  type WirePayloadStat,
  type RouteCoUsage,
} from "./profile.ts";

export {
  Profiler,
  DEFAULT_THRESHOLDS,
  type ProfilerThresholds,
} from "./collector.ts";

export {
  runScenario,
  wireByteSize,
  type Scenario,
  type ScenarioStep,
} from "./scenario.ts";

export {
  planFromProfile,
  DEFAULT_PLAN_OPTIONS,
  type PlanResult,
  type PlanContext,
  type PlanOptions,
} from "./planner.ts";

export { runProfileCli, type ProfileCliResult, type ProfileCliIO } from "./cli.ts";
