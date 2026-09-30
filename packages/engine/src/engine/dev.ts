/**
 * RaptorDev - incremental engine + Stateful Reactive HMR (whitepaper 10, 11, 12).
 *
 * Optimizes the edit -> feedback time. An edit reparses only the touched module,
 * does a graph diff against the previous compilation and produces a patch plan
 * that preserves compatible state. A no-op edit yields a cache hit (no work).
 * Every update explains itself (12: "a fast but opaque build is hard to debug").
 */
import { parseModule, diffModules, type IRModule, type GraphDiff } from "@raptor/engine/compiler";
import { computeCacheKey } from "./cache.ts";

export interface DevUpdate {
  n: number;
  path: string;
  kind: "load" | "noop" | "patch" | "remount";
  changed: string[];
  preservedSignals: number;
  preservedWire: number;
  regeneratedBindings: number;
  regeneratedRoutes: number;
  regeneratedSchemas: number;
  graphPatchMs: number;
  fallbackReason: string | null;
  diff: GraphDiff | null;
}

interface FileState {
  source: string;
  ir: IRModule;
  cacheKey: string;
}

export class DevEngine {
  private readonly files: Map<string, FileState>;
  private readonly profile: string;
  private readonly target: string;
  private updateCount: number;

  constructor(options: { profile?: string; target?: string } = {}) {
    this.files = new Map();
    this.profile = options.profile ?? "default";
    this.target = options.target ?? "web";
    this.updateCount = 0;
  }

  private key(source: string): string {
    return computeCacheKey({ source, profile: this.profile, target: this.target });
  }

  /** Applies an edit (or the initial load) and returns the update plan. */
  update(path: string, source: string): DevUpdate {
    this.updateCount++;
    const cacheKey = this.key(source);
    const prev = this.files.get(path);

    // No-op: identical source -> cache hit, no work (21, 30 no-op budget).
    if (prev && prev.cacheKey === cacheKey) {
      return this.emptyUpdate(path, "noop");
    }

    const t0 = performance.now();
    const ir = parseModule(source, path);

    if (!prev) {
      this.files.set(path, { source, ir, cacheKey });
      const u = this.emptyUpdate(path, "load");
      u.changed = ir.components.map((c) => c.name);
      u.graphPatchMs = round(performance.now() - t0);
      return u;
    }

    const diff = diffModules(prev.ir, ir);
    const graphPatchMs = round(performance.now() - t0);
    this.files.set(path, { source, ir, cacheKey });

    const remount = diff.patches.some((p) => p.strategy === "remount");
    let preservedSignals = 0;
    let regeneratedBindings = 0;
    let regeneratedSchemas = 0;
    let fallbackReason: string | null = null;
    for (const p of diff.patches) {
      if (p.strategy === "patch") preservedSignals += p.preservedSignals.length;
      regeneratedBindings += p.regeneratedBindings.length;
      regeneratedSchemas += p.wireChanges.filter((w) => w.schemaChanged).length;
      if (p.fallbackReason && !fallbackReason) fallbackReason = p.fallbackReason;
    }

    const kind: DevUpdate["kind"] =
      diff.patches.length === 0 ? "noop" : remount ? "remount" : "patch";

    return {
      n: this.updateCount,
      path,
      kind,
      changed: diff.changedComponents,
      preservedSignals,
      preservedWire: diff.preservedWireSessions,
      regeneratedBindings,
      regeneratedRoutes: 0,
      regeneratedSchemas,
      graphPatchMs,
      fallbackReason,
      diff,
    };
  }

  private emptyUpdate(path: string, kind: DevUpdate["kind"]): DevUpdate {
    return {
      n: this.updateCount,
      path,
      kind,
      changed: [],
      preservedSignals: 0,
      preservedWire: 0,
      regeneratedBindings: 0,
      regeneratedRoutes: 0,
      regeneratedSchemas: 0,
      graphPatchMs: 0,
      fallbackReason: null,
      diff: null,
    };
  }
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}

/** Formats the update in the style of the RaptorDev overlay (whitepaper section 12). */
export function formatUpdateLog(u: DevUpdate): string {
  if (u.kind === "noop") {
    return `RaptorDev update #${u.n}\n  changed: ${u.path}\n  no-op: cache hit (no recompilation)`;
  }
  const lines = [
    `RaptorDev update #${u.n}`,
    `  changed: ${u.path}`,
    `  invalidated: component ${u.changed.join(", ") || "(none)"}`,
    `  preserved: ${u.preservedSignals} signals, ${u.preservedWire} wire session`,
    `  regenerated: ${u.regeneratedBindings} DOM bindings, ${u.regeneratedRoutes} routes, ${u.regeneratedSchemas} schemas`,
    `  graph patch: ${u.graphPatchMs} ms`,
  ];
  if (u.kind === "remount") {
    lines.push(`  fallback: remount (${u.fallbackReason ?? "incompatible boundary"})`);
  }
  return lines.join("\n");
}
