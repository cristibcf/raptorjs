/**
 * Behavioral Coverage (whitepaper §19) - coverage multidimensional. Un procent
 * unic ascunde ce tip de comportament ramane neexplorat; urmarim dimensiuni
 * separate ca Explorer-ul sa poata decide urmatorul scenariu.
 */

export type CoverageDimension =
  | "uiStates"
  | "actions"
  | "transitions"
  | "apiInteractions"
  | "errorStates"
  | "networkConditions"
  | "invariants";

const DIMENSIONS: CoverageDimension[] = [
  "uiStates",
  "actions",
  "transitions",
  "apiInteractions",
  "errorStates",
  "networkConditions",
  "invariants",
];

export class Coverage {
  private readonly covered = new Map<CoverageDimension, Set<string>>();

  constructor() {
    for (const d of DIMENSIONS) this.covered.set(d, new Set());
  }

  /** Marcheaza un element ca acoperit; intoarce true daca e NOU (coverage gain). */
  mark(dimension: CoverageDimension, key: string): boolean {
    const set = this.covered.get(dimension)!;
    if (set.has(key)) return false;
    set.add(key);
    return true;
  }

  has(dimension: CoverageDimension, key: string): boolean {
    return this.covered.get(dimension)!.has(key);
  }

  count(dimension: CoverageDimension): number {
    return this.covered.get(dimension)!.size;
  }

  report(): Record<CoverageDimension, number> {
    const out = {} as Record<CoverageDimension, number>;
    for (const d of DIMENSIONS) out[d] = this.covered.get(d)!.size;
    return out;
  }
}
