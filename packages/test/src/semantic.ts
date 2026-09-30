/**
 * Semantic UI Model (whitepaper §8): nodes are identified by role, accessible
 * name, context and effect - not by fragile CSS/XPath selectors. Self-healing
 * becomes a problem of semantic re-identification, visible and auditable (not
 * hidden).
 */
import { type SemanticNode } from "./types.ts";

/** Stable identity of a node: role + context + effect (the name may vary). */
export function semanticId(node: SemanticNode): string {
  return `${node.role}#${node.context.join(">")}#${node.actionEffect ?? ""}#${node.name}`;
}

/** The action ID used in the action log / capsule (stable, semantic). */
export function actionId(node: SemanticNode): string {
  return `${node.role}:${node.name}:${node.context.join(">")}`;
}

/** An identity key resistant to cosmetic name changes. */
export function stableKey(node: SemanticNode): string {
  return `${node.role}#${node.context.join(">")}#${node.actionEffect ?? ""}`;
}

/** Similarity score 0..1 for re-identification (self-heal). */
export function semanticSimilarity(a: SemanticNode, b: SemanticNode): number {
  let score = 0;
  if (a.role === b.role) score += 0.35;
  if ((a.actionEffect ?? "") === (b.actionEffect ?? "") && a.actionEffect) score += 0.3;
  const ctxA = new Set(a.context);
  const overlap = b.context.filter((c) => ctxA.has(c)).length;
  const ctxMax = Math.max(a.context.length, b.context.length, 1);
  score += 0.25 * (overlap / ctxMax);
  if (a.name === b.name) score += 0.1;
  return score;
}

/**
 * Re-identify a known node in a new list. Returns the match plus a `healed`
 * flag when identification was done by similarity (name changed), so the system
 * can REPORT the remapping, not hide it.
 */
export function reidentify(
  target: SemanticNode,
  candidates: SemanticNode[],
  threshold = 0.6,
): { node: SemanticNode; healed: boolean } | null {
  const exactId = semanticId(target);
  const exact = candidates.find((c) => semanticId(c) === exactId);
  if (exact) return { node: exact, healed: false };

  let best: SemanticNode | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = semanticSimilarity(target, c);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (best && bestScore >= threshold) return { node: best, healed: true };
  return null;
}
