/**
 * Behavioral Coverage (whitepaper §19) - multidimensional coverage. A single
 * percentage hides which kind of behavior remains unexplored; we track separate
 * dimensions so the Explorer can decide the next scenario.
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

  /** Mark an element as covered; return true if it is NEW (coverage gain). */
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
