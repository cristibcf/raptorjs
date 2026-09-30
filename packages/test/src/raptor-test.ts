/**
 * RaptorTest - the orchestrator of the autonomous cycle (whitepaper §4, §28):
 * observe -> infer -> synthesize -> explore -> verify -> replay.
 *
 * Drives the application (AppHarness) over a stateful RaptorTwin, with
 * controllable virtual time and network schedule. Discovers action sequences
 * (coverage-guided BFS), combines them with network scenarios (RaptorChaos),
 * checks invariants (RaptorOracle) and produces minimized deterministic
 * capsules.
 */
import { VirtualClock } from "./clock.ts";
import { EventLog } from "./probe.ts";
import { NetworkController, defaultSchedule } from "./network.ts";
import { type RaptorTwin } from "./twin.ts";
import { BehaviorGraph, stateId } from "./behavior-graph.ts";
import { actionId as idOf } from "./semantic.ts";
import { Coverage } from "./coverage.ts";
import {
  type Invariant,
  type CustomInvariant,
  BUILTIN_INVARIANTS,
  wrapCustom,
  evaluate,
} from "./oracle.ts";
import { chaosSchedules, type RouteInfo } from "./chaos.ts";
import {
  type AppHarness,
  type AppState,
  type Capsule,
  type HarnessContext,
  type NetworkSchedule,
} from "./types.ts";

/** Virtual time elapsed between two consecutive actions (click gap). */
const THINK_TIME = 10;

export interface RaptorTestConfig {
  harness: AppHarness;
  twin: RaptorTwin;
  invariants?: CustomInvariant[];
  maxDepth?: number;
  buildFingerprint?: string;
  seed?: number;
}

export interface ScenarioResult {
  ui: AppState;
  events: EventLog;
  failure: { name: string; detail: string } | null;
  routes: RouteInfo[];
}

export interface Finding {
  capsule: Capsule;
  scheduleLabel: string;
}

export class RaptorTest {
  readonly graph = new BehaviorGraph();
  readonly coverage = new Coverage();
  private readonly harness: AppHarness;
  private readonly twin: RaptorTwin;
  private readonly invariants: Invariant[];
  private readonly initialTwin: unknown;
  private readonly maxDepth: number;
  private readonly buildFingerprint: string;
  private readonly seed: number;
  private capSeq = 0;

  constructor(config: RaptorTestConfig) {
    this.harness = config.harness;
    this.twin = config.twin;
    this.invariants = [...BUILTIN_INVARIANTS, ...(config.invariants ?? []).map(wrapCustom)];
    this.initialTwin = config.twin.snapshot();
    this.maxDepth = config.maxDepth ?? 3;
    this.buildFingerprint = config.buildFingerprint ?? "dev";
    this.seed = config.seed ?? 1;
  }

  /** Run a sequence of actions under a network schedule, from scratch. */
  runScenario(actionLog: string[], schedule: NetworkSchedule): ScenarioResult {
    const clock = new VirtualClock();
    const log = new EventLog(clock);
    this.twin.restore(this.initialTwin);
    this.harness.reset();

    const net = new NetworkController(this.twin, clock, schedule, {
      emit: (kind, method, path, info) => log.append(kind, { method, path, ...info }),
    });
    const ctx: HarnessContext = {
      clock,
      request: (method, path, body, onResponse) => net.request(method, path, body, onResponse),
      emit: (e) => log.append(e.type, e.payload, e.correlation),
    };

    for (const actionId of actionLog) {
      const before = this.harness.currentState();
      const action = before.actions.find((a) => idOf(a) === actionId);
      log.append("action", { actionId });
      this.harness.perform(actionId, ctx);
      // Think-time between actions: does NOT stabilize fully, so we catch races
      // (e.g. an immediate navigation while a request is in flight - RT-184).
      clock.advance(THINK_TIME);
      const after = this.harness.currentState();
      this.coverage.mark("uiStates", `${after.route}|${stateId(after.facts)}`);
      if (action) {
        this.coverage.mark("actions", idOf(action));
        const edge = this.graph.observeTransition(before.facts, action, after.facts, "ok");
        this.coverage.mark("transitions", `${edge.from}->${stateId(after.facts)}`);
      }
    }
    // Stabilize the network at the end (full drain of virtual time).
    clock.runUntilIdle();

    const ui = this.harness.currentState();
    for (const req of log.byType("request")) {
      this.coverage.mark("apiInteractions", `${req.payload["method"]} ${req.payload["path"]}`);
    }
    const failure = evaluate(this.invariants, { events: log, twin: this.twin, ui });
    if (failure) this.coverage.mark("errorStates", failure.name);

    const routes = discoverRoutes(log);
    for (const r of routes) this.coverage.mark("apiInteractions", r.key);
    return { ui, events: log, failure, routes };
  }

  /** Coverage-guided BFS exploration: reachable action sequences. */
  discover(): string[][] {
    const sequences: string[][] = [];
    const expanded = new Set<string>();
    let frontier: string[][] = [[]];

    for (let depth = 0; depth <= this.maxDepth; depth++) {
      const next: string[][] = [];
      for (const seq of frontier) {
        const { ui } = this.runScenario(seq, defaultSchedule());
        if (seq.length > 0) sequences.push(seq);
        const key = `${ui.route}|${stateId(ui.facts)}`;
        if (expanded.has(key)) continue;
        expanded.add(key);
        for (const action of ui.actions) next.push([...seq, idOf(action)]);
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    return sequences;
  }

  /** The full cycle: discover sequences, apply chaos, verify, capsule. */
  explore(): Finding[] {
    const sequences = this.discover();

    // Routes observed across all sequences (for context-aware chaos).
    const routeMap = new Map<string, RouteInfo>();
    for (const seq of sequences) {
      const { routes } = this.runScenario(seq, defaultSchedule());
      for (const r of routes) routeMap.set(r.key, r);
    }
    const schedules = chaosSchedules([...routeMap.values()]);
    for (const s of schedules) this.coverage.mark("networkConditions", s.label);

    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const seq of sequences) {
      for (const { label, schedule } of schedules) {
        const { failure } = this.runScenario(seq, schedule);
        if (!failure) continue;
        const sig = `${failure.name}|${label}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        const capsule: Capsule = {
          id: `RT-${++this.capSeq}`,
          buildFingerprint: this.buildFingerprint,
          actionLog: seq,
          networkSchedule: schedule,
          seed: this.seed,
          failedOracle: failure.name,
          detail: failure.detail,
        };
        findings.push({ capsule: this.minimize(capsule), scheduleLabel: label });
      }
    }
    return findings;
  }

  /** Reproduce a capsule; returns whether the same oracle fails identically. */
  replay(capsule: Capsule): { reproduced: boolean; ui: AppState; detail: string } {
    const { failure, ui } = this.runScenario(capsule.actionLog, capsule.networkSchedule);
    const reproduced = failure !== null && failure.name === capsule.failedOracle;
    return { reproduced, ui, detail: failure?.detail ?? "" };
  }

  /** Delta debugging: the shortest sequence that preserves the same failure. */
  minimize(capsule: Capsule): Capsule {
    let actions = capsule.actionLog.slice();
    let changed = true;
    while (changed && actions.length > 0) {
      changed = false;
      for (let i = 0; i < actions.length; i++) {
        const candidate = actions.slice(0, i).concat(actions.slice(i + 1));
        const { failure } = this.runScenario(candidate, capsule.networkSchedule);
        if (failure && failure.name === capsule.failedOracle) {
          actions = candidate;
          changed = true;
          break;
        }
      }
    }
    return { ...capsule, actionLog: actions };
  }
}

function discoverRoutes(log: EventLog): RouteInfo[] {
  const map = new Map<string, RouteInfo>();
  for (const req of log.byType("request")) {
    const method = String(req.payload["method"]);
    const path = String(req.payload["path"]);
    const key = `${method} ${path}`;
    map.set(key, { key, mutating: method !== "GET" });
  }
  return [...map.values()];
}
