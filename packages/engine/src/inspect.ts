/**
 * Diagnostics, inspect si analyze (whitepaper RaptorEngine 12, 27, 5).
 *
 * Un build rapid dar opac e greu de depanat. Aceste functii raspund intrebari
 * concrete: ce depinde de un signal, de ce editarea unui nod recompileaza altele
 * (invalidation trace), ce a fost eliminat/fuzionat (optimization trace).
 */
import { GraphNodeKind, type SemanticGraph } from "@raptor/compiler";
import type { OptEntry } from "./optimize.ts";
import type { BuildResult } from "./build.ts";

/** Reachability forward peste flow edges: "blast radius"-ul unei schimbari. */
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

/** Dump lizibil al grafului semantic (`raptor inspect graph`). */
export function inspectGraph(graph: SemanticGraph): string {
  const lines: string[] = [
    `Semantic Application Graph (${graph.nodes.size} noduri, ${graph.edges.length} edges)`,
  ];
  for (const node of graph.nodes.values()) {
    const consumers = graph.consumers(node.id);
    const arrow = consumers.length > 0 ? `  ->  ${consumers.join(", ")}` : "";
    lines.push(`  [${node.kind}] ${node.id} "${node.label}"${node.sink ? " (sink)" : ""}${arrow}`);
  }
  return lines.join("\n");
}

/** Trace-ul optimizarilor (`raptor inspect` / report). */
export function formatOptimizationTrace(trace: OptEntry[]): string {
  if (trace.length === 0) return "Optimization trace: (nicio optimizare aplicata)";
  const lines = ["Optimization trace:"];
  for (const e of trace) lines.push(`  [${e.pass}] ${e.action} ${e.target} - ${e.detail}`);
  return lines.join("\n");
}

/** Sumar `raptor analyze`: bundle, signals, wire, costuri (5). */
export function analyzeReport(result: BuildResult): string {
  const m = result.manifest.metrics;
  const reactiveCount = result.ir.components.reduce(
    (n, c) => n + c.signals.length + c.deriveds.length + c.serverSignals.length,
    0,
  );
  const addresses = result.wire.addresses.map((a) => `${a.logical}=${a.ras}[slot ${a.decoderSlot}]`);
  return [
    `raptor analyze - ${result.path}`,
    `  profil: ${result.config.profile} | target: ${result.config.target}`,
    `  componente: ${m.components}`,
    `  noduri reactive (post-optim): ${reactiveCount}`,
    `  DOM bindings: ${m.domBindings}`,
    `  eliminate (DSE): ${m.eliminated} | fuzionate (Fusion): ${m.fused}`,
    `  chunks: ${result.chunks.map((c) => `${c.name}[${c.components.join("+")}]`).join(", ")}`,
    `  wire schemas: ${result.wire.schemas.join(", ") || "(niciuna)"}`,
    `  RAS addresses: ${addresses.join(", ") || "(niciuna)"}`,
    `  inputsHash: ${result.manifest.inputsHash.slice(0, 12)}…`,
  ].join("\n");
}

/** Utilitar: gaseste id-ul unui nod reactiv dupa nume componenta.nume. */
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
