/**
 * Behavior Graph (whitepaper §7) - reprezentarea centrala a aplicatiei.
 * Nodurile sunt stari observabile (facts); muchiile sunt actiuni cu preconditii,
 * efecte, tranzitii, confidence, risc si coverage. Se construieste observand
 * perform -> efect -> stare noua.
 */
import { type SemanticNode } from "./types.ts";
import { stableKey } from "./semantic.ts";

export interface StateNode {
  id: string;
  facts: Record<string, unknown>;
  visits: number;
}

export interface Transition {
  outcome: string;
  to: string;
  count: number;
}

export interface ActionEdge {
  id: string; // from + stableKey(action)
  from: string;
  action: SemanticNode;
  transitions: Transition[];
  evidence: number;
  risk: number;
}

/** Hash stabil al unei stari din faptele ei (ordine-independent). */
export function stateId(facts: Record<string, unknown>): string {
  const keys = Object.keys(facts).sort();
  return keys.map((k) => `${k}=${JSON.stringify(facts[k])}`).join("&") || "∅";
}

/** Risc estimat al unei actiuni: mutatiile sunt mai riscante decat citirile. */
function estimateRisk(action: SemanticNode): number {
  const effect = action.actionEffect ?? "";
  if (/^(POST|PUT|PATCH|DELETE)/.test(effect)) return 1;
  if (action.role === "link" || action.role === "button") return 0.5;
  return 0.3;
}

export class BehaviorGraph {
  readonly states = new Map<string, StateNode>();
  readonly actions = new Map<string, ActionEdge>();

  observeState(facts: Record<string, unknown>): StateNode {
    const id = stateId(facts);
    let node = this.states.get(id);
    if (!node) {
      node = { id, facts: { ...facts }, visits: 0 };
      this.states.set(id, node);
    }
    node.visits++;
    return node;
  }

  observeTransition(
    fromFacts: Record<string, unknown>,
    action: SemanticNode,
    toFacts: Record<string, unknown>,
    outcome: string,
  ): ActionEdge {
    const from = stateId(fromFacts);
    const to = stateId(toFacts);
    const edgeId = `${from}::${stableKey(action)}`;
    let edge = this.actions.get(edgeId);
    if (!edge) {
      edge = { id: edgeId, from, action, transitions: [], evidence: 0, risk: estimateRisk(action) };
      this.actions.set(edgeId, edge);
    }
    edge.evidence++;
    let t = edge.transitions.find((x) => x.outcome === outcome && x.to === to);
    if (!t) {
      t = { outcome, to, count: 0 };
      edge.transitions.push(t);
    }
    t.count++;
    return edge;
  }

  edgesFrom(stateKey: string): ActionEdge[] {
    return [...this.actions.values()].filter((e) => e.from === stateKey);
  }
}
