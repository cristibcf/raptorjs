/**
 * Profiler - the telemetry collector (whitepaper RaptorEngine 22).
 *
 * Records technical events as a scenario runs on the runtime and computes
 * derived metrics. The derived fan-out is STATIC (from the graph), not from
 * runtime - it identifies hot reactive nodes regardless of traffic (22).
 */
import { GraphNodeKind, type SemanticGraph } from "@raptor/engine/compiler";
import { emptyProfile, PROFILE_VERSION, type RaptorProfile, type WirePayloadStat } from "./profile.ts";

export interface ProfilerThresholds {
  /** Minimum updates for a signal to be considered "hot". */
  hotSignal: number;
  /** Minimum visits for a route to be considered "hot". */
  hotRoute: number;
}

export const DEFAULT_THRESHOLDS: ProfilerThresholds = { hotSignal: 2, hotRoute: 2 };

export class Profiler {
  private readonly signalFreq = new Map<string, number>();
  private readonly routeFreq = new Map<string, number>();
  private readonly coUsage = new Map<string, number>();
  private readonly payload = new Map<string, { samples: number; totalBytes: number }>();
  private readonly derivedFanOut: Record<string, number>;
  private domBursts = { count: 0, maxBatch: 0, totalMutations: 0 };
  private scenarios = 0;
  private session: Set<string> | null = null;

  constructor(graph?: SemanticGraph) {
    this.derivedFanOut = {};
    if (graph) {
      for (const node of graph.nodes.values()) {
        if (node.kind === GraphNodeKind.Derived) {
          this.derivedFanOut[node.id] = graph.consumers(node.id).length;
        }
      }
    }
  }

  beginSession(): void {
    this.session = new Set();
    this.scenarios++;
  }

  endSession(): void {
    if (this.session) {
      const routes = [...this.session].sort();
      for (let i = 0; i < routes.length; i++) {
        for (let j = i + 1; j < routes.length; j++) {
          const key = `${routes[i]}|${routes[j]}`;
          this.coUsage.set(key, (this.coUsage.get(key) ?? 0) + 1);
        }
      }
    }
    this.session = null;
  }

  recordRoute(path: string): void {
    this.routeFreq.set(path, (this.routeFreq.get(path) ?? 0) + 1);
    if (this.session) this.session.add(path);
  }

  recordSignalUpdate(address: string, bytes: number): void {
    this.signalFreq.set(address, (this.signalFreq.get(address) ?? 0) + 1);
    const p = this.payload.get(address) ?? { samples: 0, totalBytes: 0 };
    p.samples++;
    p.totalBytes += bytes;
    this.payload.set(address, p);
  }

  recordBurst(size: number): void {
    this.domBursts.count++;
    this.domBursts.totalMutations += size;
    if (size > this.domBursts.maxBatch) this.domBursts.maxBatch = size;
  }

  /** Materializes the profile, with derived metrics (hot/cold) by thresholds. */
  finish(thresholds: ProfilerThresholds = DEFAULT_THRESHOLDS): RaptorProfile {
    const profile = emptyProfile();
    profile.version = PROFILE_VERSION;
    profile.scenarios = this.scenarios;
    profile.derivedFanOut = { ...this.derivedFanOut };

    for (const [k, v] of this.signalFreq) profile.signalUpdateFrequency[k] = v;
    for (const [k, v] of this.routeFreq) profile.routeFrequency[k] = v;

    profile.routeCoUsage = [...this.coUsage.entries()]
      .map(([key, count]) => {
        const [a, b] = key.split("|");
        return { pair: [a!, b!] as [string, string], count };
      })
      .sort((x, y) => y.count - x.count);

    const wire: WirePayloadStat[] = [];
    for (const [address, p] of this.payload) {
      wire.push({
        address,
        samples: p.samples,
        totalBytes: p.totalBytes,
        avgBytes: p.samples > 0 ? Math.round((p.totalBytes / p.samples) * 100) / 100 : 0,
      });
    }
    profile.wirePayload = wire.sort((a, b) => b.totalBytes - a.totalBytes);
    profile.domBursts = { ...this.domBursts };

    profile.hotSignals = [...this.signalFreq.entries()]
      .filter(([, v]) => v >= thresholds.hotSignal)
      .map(([k]) => k)
      .sort();
    profile.hotRoutes = [...this.routeFreq.entries()]
      .filter(([, v]) => v >= thresholds.hotRoute)
      .map(([k]) => k)
      .sort();

    return profile;
  }
}
