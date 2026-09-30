/**
 * Diagnostics, inspect and analyze (RaptorEngine whitepaper 12, 27, 5).
 *
 * A fast but opaque build is hard to debug. These functions answer concrete
 * questions: what depends on a signal, why editing one node recompiles others
 * (invalidation trace), what was eliminated/fused (optimization trace).
 */
import { GraphNodeKind, type SemanticGraph } from "@raptor/engine/compiler";
import type { OptEntry } from "./optimize.ts";
import type { BuildResult } from "./build.ts";

/** Forward reachability over flow edges: the "blast radius" of a change. */
export function invalidationTrace(graph: SemanticGraph, startId: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const queue = [startId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const c of graph.consumers(id)) {
      if (!seen.has(c)) {
        seen.add(c);
        order.push(c);
        queue.push(c);
      }
    }
  }
  return order;
}

/** Readable dump of the semantic graph (`raptor inspect graph`). */
export function inspectGraph(graph: SemanticGraph): string {
  const lines: string[] = [
    `Semantic Application Graph (${graph.nodes.size} nodes, ${graph.edges.length} edges)`,
  ];
  for (const node of graph.nodes.values()) {
    const consumers = graph.consumers(node.id);
    const arrow = consumers.length > 0 ? `  ->  ${consumers.join(", ")}` : "";
    lines.push(`  [${node.kind}] ${node.id} "${node.label}"${node.sink ? " (sink)" : ""}${arrow}`);
  }
  return lines.join("\n");
}

/** The optimization trace (`raptor inspect` / report). */
export function formatOptimizationTrace(trace: OptEntry[]): string {
  if (trace.length === 0) return "Optimization trace: (no optimization applied)";
  const lines = ["Optimization trace:"];
  for (const e of trace) lines.push(`  [${e.pass}] ${e.action} ${e.target} - ${e.detail}`);
  return lines.join("\n");
}

/** `raptor analyze` summary: bundle, signals, wire, costs (5). */
export function analyzeReport(result: BuildResult): string {
  const m = result.manifest.metrics;
  const reactiveCount = result.ir.components.reduce(
    (n, c) => n + c.signals.length + c.deriveds.length + c.serverSignals.length,
    0,
  );
  const addresses = result.wire.addresses.map((a) => `${a.logical}=${a.ras}[slot ${a.decoderSlot}]`);
  return [
    `raptor analyze - ${result.path}`,
    `  profile: ${result.config.profile} | target: ${result.config.target}`,
    `  components: ${m.components}`,
    `  reactive nodes (post-optim): ${reactiveCount}`,
    `  DOM bindings: ${m.domBindings}`,
    `  eliminated (DSE): ${m.eliminated} | fused (Fusion): ${m.fused}`,
    `  chunks: ${result.chunks.map((c) => `${c.name}[${c.components.join("+")}]`).join(", ")}`,
    `  wire schemas: ${result.wire.schemas.join(", ") || "(none)"}`,
    `  RAS addresses: ${addresses.join(", ") || "(none)"}`,
    `  inputsHash: ${result.manifest.inputsHash.slice(0, 12)}…`,
  ].join("\n");
}

/** Utility: finds the id of a reactive node by component.name. */
export function reactiveNodeId(graph: SemanticGraph, name: string): string | null {
  for (const node of graph.nodes.values()) {
    const reactive =
      node.kind === GraphNodeKind.Signal ||
      node.kind === GraphNodeKind.Derived ||
      node.kind === GraphNodeKind.ServerSignal;
    if (reactive && node.id === name) return node.id;
  }
  return null;
}
