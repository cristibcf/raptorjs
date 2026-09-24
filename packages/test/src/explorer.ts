/**
 * RaptorExplorer - explorare autonoma ghidata de scor (whitepaper §12).
 * Nu random crawling: fiecare actiune candidata primeste un scor care combina
 * castigul de coverage, riscul, noutatea si costul de executie.
 *
 *   score = (coverageGain * risk * novelty) / executionCost
 */
export interface ScoreInputs {
  coverageGain: number; // cate dimensiuni noi ar atinge (>=0)
  risk: number; // 0..1, mutatiile sunt mai riscante
  novelty: number; // 0..1, stari/tranzitii neobservate
  executionCost: number; // >0
}

export function actionScore(i: ScoreInputs): number {
  const gain = Math.max(i.coverageGain, 0.1);
  return (gain * Math.max(i.risk, 0.1) * Math.max(i.novelty, 0.1)) / Math.max(i.executionCost, 0.01);
}

/** Alege indexul actiunii cu scorul maxim (tie -> prima). */
export function pickBest(scores: number[]): number {
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[best]!) best = i;
  return best;
}
