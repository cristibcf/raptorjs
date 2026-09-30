/**
 * Semantic Application Graph (RaptorEngine whitepaper section 8).
 *
 * Links into a single view: Module -> Component -> Signal -> Derived -> DOM
 * Binding, plus ServerSignal -> Schema -> RAS Address. On this graph we answer
 * the questions a normal module graph cannot: if a signal changes, which
 * bindings regenerate? if a derived never reaches the DOM, can it be
 * eliminated? (the basis for DSE and Dependency Fusion, 14).
 */
import type {
  IRModule,
  IRComponent,
  IRElement,
  IRChild,
} from "./ir.ts";

export const GraphNodeKind = {
  Component: "component",
  Signal: "signal",
  Derived: "derived",
  ServerSignal: "serverSignal",
  Effect: "effect",
  Element: "element",
  Text: "text",
  Attr: "attr",
  Event: "event",
  Schema: "schema",
  Address: "address",
} as const;

export type GraphNodeKindValue = (typeof GraphNodeKind)[keyof typeof GraphNodeKind];

export const EdgeType = {
  /** Data flows from producer to consumer (signal -> derived -> binding). */
  Flow: "flow",
  /** A handler writes a signal (event -> signal). */
  Write: "write",
  /** DOM structure (element -> child, component -> root). */
  Renders: "renders",
  /** Wire link (serverSignal -> schema / address). */
  Wire: "wire",
  /** Ownership (component -> signal/derived/...). */
  Contains: "contains",
} as const;

export type EdgeTypeValue = (typeof EdgeType)[keyof typeof EdgeType];

export interface GraphNode {
  id: string;
  kind: GraphNodeKindValue;
  label: string;
  component: string;
  /** Marks observable nodes (sinks for liveness): text/attr/effect. */
  sink: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeTypeValue;
}

export class SemanticGraph {
  readonly nodes: Map<string, GraphNode>;
  readonly edges: GraphEdge[];
  private readonly outFlow: Map<string, string[]>;
  private readonly inFlow: Map<string, string[]>;

  constructor() {
    this.nodes = new Map();
    this.edges = [];
    this.outFlow = new Map();
    this.inFlow = new Map();
  }

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  addEdge(from: string, to: string, type: EdgeTypeValue): void {
    this.edges.push({ from, to, type });
    if (type === EdgeType.Flow) {
      (this.outFlow.get(from) ?? this.outFlow.set(from, []).get(from)!).push(to);
      (this.inFlow.get(to) ?? this.inFlow.set(to, []).get(to)!).push(from);
    }
  }

  /** The direct (flow) consumers of a node. */
  consumers(id: string): string[] {
    return this.outFlow.get(id) ?? [];
  }

  /** The direct (flow) producers of a node. */
  producers(id: string): string[] {
    return this.inFlow.get(id) ?? [];
  }

  /**
   * Reverse reachability from sinks: the set of nodes that reach an observable
   * output. A reactive node not in this set is "dead" (DSE 14.1).
   */
  liveNodes(): Set<string> {
    const live = new Set<string>();
    const queue: string[] = [];
    for (const node of this.nodes.values()) {
      if (node.sink) {
        live.add(node.id);
        queue.push(node.id);
      }
    }
    while (queue.length > 0) {
      const id = queue.pop()!;
      const reach = (other: string): void => {
        if (live.has(other)) return;
        live.add(other);
        queue.push(other);
      };
      for (const producer of this.producers(id)) reach(producer);
      // And the written targets: the code emitted for a live handler NAMES them,
      // so deleting them would leave a dead reference in the generated file. A
      // signal that is written but never read may be useless, but it is not DSE's
      // job to decide that by cutting it in half.
      for (const edge of this.edges) {
        if (edge.type === EdgeType.Write && edge.from === id) reach(edge.to);
      }
    }
    return live;
  }

  /** Reactive nodes with no path to a sink (DSE candidates). */
  deadReactive(): string[] {
    const live = this.liveNodes();
    const dead: string[] = [];
    for (const node of this.nodes.values()) {
      const reactive =
        node.kind === GraphNodeKind.Signal ||
        node.kind === GraphNodeKind.Derived ||
        node.kind === GraphNodeKind.ServerSignal;
      if (reactive && !live.has(node.id)) dead.push(node.id);
    }
    return dead;
  }
}

function walkElement(
  graph: SemanticGraph,
  comp: IRComponent,
  el: IRElement,
  parentId: string,
  producerOf: (name: string) => string | null,
): void {
  graph.addNode({
    id: el.id,
    kind: GraphNodeKind.Element,
    label: `<${el.tag}>`,
    component: comp.name,
    sink: false,
  });
  graph.addEdge(parentId, el.id, EdgeType.Renders);

  for (const attr of el.attrs) {
    if (!attr.expr) continue; // static attribute, no reactive node
    graph.addNode({
      id: attr.id,
      kind: GraphNodeKind.Attr,
      label: `@${attr.name}`,
      component: comp.name,
      sink: true,
    });
    graph.addEdge(el.id, attr.id, EdgeType.Renders);
    for (const r of attr.reads) {
      const p = producerOf(r);
      if (p) graph.addEdge(p, attr.id, EdgeType.Flow);
    }
  }

  for (const ev of el.events) {
    graph.addNode({
      id: ev.id,
      kind: GraphNodeKind.Event,
      label: `on:${ev.event}`,
      component: comp.name,
      // A handler IS an observable output: it runs when the user clicks.
      // As long as it was not a sink, nothing in it kept anything alive - and DSE
      // deleted a derived read only inside the handler, leaving in the emitted
      // code a reference to a name that no longer exists. Audit round 3, U4/U5.
      sink: true,
    });
    graph.addEdge(el.id, ev.id, EdgeType.Renders);
    // What the handler READS keeps it alive, exactly like a DOM binding.
    for (const r of ev.reads) {
      const p = producerOf(r);
      if (p) graph.addEdge(p, ev.id, EdgeType.Flow);
    }
    for (const w of ev.writes) {
      const p = producerOf(w);
      if (p) graph.addEdge(ev.id, p, EdgeType.Write);
    }
  }

  for (const child of el.children as IRChild[]) {
    if (child.kind === "Element") {
      walkElement(graph, comp, child, el.id, producerOf);
      continue;
    }
    // TextBinding
    if (child.expr) {
      graph.addNode({
        id: child.id,
        kind: GraphNodeKind.Text,
        label: "{…}",
        component: comp.name,
        sink: true,
      });
      graph.addEdge(el.id, child.id, EdgeType.Renders);
      for (const r of child.reads) {
        const p = producerOf(r);
        if (p) graph.addEdge(p, child.id, EdgeType.Flow);
      }
    }
    // Static text does not create a reactive node.
  }
}

/** Builds the semantic graph from an IR module. */
export function buildGraph(module: IRModule): SemanticGraph {
  const graph = new SemanticGraph();

  for (const comp of module.components) {
    graph.addNode({
      id: comp.id,
      kind: GraphNodeKind.Component,
      label: comp.name,
      component: comp.name,
      sink: false,
    });

    // Map reactive name -> producer node id, for resolving edges.
    const producerId = new Map<string, string>();
    for (const s of comp.signals) producerId.set(s.name, s.id);
    for (const d of comp.deriveds) producerId.set(d.name, d.id);
    for (const ss of comp.serverSignals) producerId.set(ss.name, ss.id);
    const producerOf = (name: string): string | null => producerId.get(name) ?? null;

    for (const s of comp.signals) {
      graph.addNode({
        id: s.id,
        kind: GraphNodeKind.Signal,
        label: s.name,
        component: comp.name,
        sink: false,
      });
      graph.addEdge(comp.id, s.id, EdgeType.Contains);
    }

    for (const ss of comp.serverSignals) {
      graph.addNode({
        id: ss.id,
        kind: GraphNodeKind.ServerSignal,
        label: `${ss.name} (${ss.address})`,
        component: comp.name,
        sink: false,
      });
      graph.addEdge(comp.id, ss.id, EdgeType.Contains);
      // Wire chain: schema + address.
      if (ss.schema) {
        const schemaId = `${ss.id}#schema`;
        graph.addNode({
          id: schemaId,
          kind: GraphNodeKind.Schema,
          label: ss.schema,
          component: comp.name,
          sink: false,
        });
        graph.addEdge(ss.id, schemaId, EdgeType.Wire);
      }
      const addrId = `${ss.id}#addr`;
      graph.addNode({
        id: addrId,
        kind: GraphNodeKind.Address,
        label: ss.address,
        component: comp.name,
        sink: false,
      });
      graph.addEdge(ss.id, addrId, EdgeType.Wire);
    }

    for (const d of comp.deriveds) {
      graph.addNode({
        id: d.id,
        kind: GraphNodeKind.Derived,
        label: d.name,
        component: comp.name,
        sink: false,
      });
      graph.addEdge(comp.id, d.id, EdgeType.Contains);
      for (const r of d.reads) {
        const p = producerOf(r);
        if (p) graph.addEdge(p, d.id, EdgeType.Flow);
      }
    }

    for (const ef of comp.effects) {
      graph.addNode({
        id: ef.id,
        kind: GraphNodeKind.Effect,
        label: "effect",
        component: comp.name,
        sink: true, // effects are observable outputs
      });
      graph.addEdge(comp.id, ef.id, EdgeType.Contains);
      for (const r of ef.reads) {
        const p = producerOf(r);
        if (p) graph.addEdge(p, ef.id, EdgeType.Flow);
      }
    }

    walkElement(graph, comp, comp.root, comp.id, producerOf);
  }

  return graph;
}
