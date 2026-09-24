/**
 * Plan hints - intrarea profile-guided in RaptorBuild (whitepaper RaptorEngine
 * 22-24). Sunt HINTS de STRATEGIE, nu de corectitudine (§24: "profilele pot
 * influenta strategia, nu semantica"). Tipul traieste in engine fiindca build-ul
 * il consuma; @raptor/profile il PRODUCE dintr-un profil + graf (fara ciclu).
 *
 * Regula de aur: un hint poate reorganiza chunks/preload/batch/encoding, dar NU
 * poate elimina cod, nu poate schimba ordinea semantica a effects si nu poate
 * ignora routes rare. Eliminarea ramane treaba DSE-ului (analiza statica, 14.1).
 */

export interface PlanHints {
  /** Grupuri de componente plasate impreuna intr-un chunk (chunk folding, 16). */
  foldChunks: string[][];
  /** Routes de preincarcat (preload agresiv pentru cele frecvente, 16/24). */
  preloadRoutes: string[];
  /** Batch size sugerat per componenta (din DOM mutation bursts, 22). */
  batchSizes: Record<string, number>;
  /** Adrese wire candidate pentru encoding specializat cu fallback (15/24). */
  encodingSpecialization: string[];
}

export function emptyPlanHints(): PlanHints {
  return { foldChunks: [], preloadRoutes: [], batchSizes: {}, encodingSpecialization: [] };
}
