/**
 * RaptorExplorer - autonomous, score-guided exploration (whitepaper §12).
 * Not random crawling: each candidate action gets a score that combines
 * coverage gain, risk, novelty and execution cost.
 *
 *   score = (coverageGain * risk * novelty) / executionCost
 */
export interface ScoreInputs {
  coverageGain: number; // how many new dimensions it would hit (>=0)
  risk: number; // 0..1, mutations are riskier
  novelty: number; // 0..1, unobserved states/transitions
  executionCost: number; // >0
}

export function actionScore(i: ScoreInputs): number {
  const gain = Math.max(i.coverageGain, 0.1);
  return (gain * Math.max(i.risk, 0.1) * Math.max(i.novelty, 0.1)) / Math.max(i.executionCost, 0.01);
}

/** Pick the index of the action with the highest score (tie -> the first). */
export function pickBest(scores: number[]): number {
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[best]!) best = i;
  return best;
}
