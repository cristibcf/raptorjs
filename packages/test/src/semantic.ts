/**
 * Semantic UI Model (whitepaper §8): nodurile sunt identificate prin rol,
 * nume accesibil, context si efect - nu prin selectori CSS/XPath fragili.
 * Self-healing devine o problema de re-identificare semantica, vizibila si
 * auditabila (nu ascunsa).
 */
import { type SemanticNode } from "./types.ts";

/** Identitate stabila a unui nod: rol + context + efect (numele poate varia). */
export function semanticId(node: SemanticNode): string {
  return `${node.role}#${node.context.join(">")}#${node.actionEffect ?? ""}#${node.name}`;
}

/** ID-ul de actiune folosit in action log / capsule (stabil, semantic). */
export function actionId(node: SemanticNode): string {
  return `${node.role}:${node.name}:${node.context.join(">")}`;
}

/** Cheie de identitate rezistenta la schimbari cosmetice de nume. */
export function stableKey(node: SemanticNode): string {
  return `${node.role}#${node.context.join(">")}#${node.actionEffect ?? ""}`;
}

/** Scor de similaritate 0..1 pentru re-identificare (self-heal). */
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
 * Re-identifica un nod cunoscut intr-o lista noua. Intoarce potrivirea plus un
 * flag `healed` cand identificarea s-a facut prin similaritate (nume schimbat),
 * ca sistemul sa poata RAPORTA remaparea, nu sa o ascunda.
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
