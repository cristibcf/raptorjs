/**
 * Caching semantic si reproducibilitate (whitepaper RaptorEngine 21).
 *
 * Cheia de cache nu e doar hash-ul fisierului: include versiunea compilerului,
 * profilul, target-ul si versiunea de compatibilitate a schemei (21.1). Un edit
 * no-op da cache hit; un edit local invalideaza doar intrarile relevante.
 */
import { createHash } from "node:crypto";

export const ENGINE_VERSION = "0.1.0";
export const COMPILER_VERSION = "0.1.0";
export const SCHEMA_COMPAT = "1";

export interface CacheKeyInputs {
  source: string;
  profile: string;
  target: string;
}

/** Content hash stabil (sha256 hex) peste toate intrarile care afecteaza output-ul. */
export function computeCacheKey(inputs: CacheKeyInputs): string {
  const h = createHash("sha256");
  h.update("compiler:" + COMPILER_VERSION);
  h.update("|engine:" + ENGINE_VERSION);
  h.update("|schema:" + SCHEMA_COMPAT);
  h.update("|profile:" + inputs.profile);
  h.update("|target:" + inputs.target);
  h.update("|source:" + inputs.source);
  return h.digest("hex");
}

export interface CacheStats {
  hits: number;
  misses: number;
}

/** Cache in-memory cu statistici (content-addressed). */
export class SemanticCache<T> {
  private readonly store: Map<string, T>;
  readonly stats: CacheStats;
  constructor() {
    this.store = new Map();
    this.stats = { hits: 0, misses: 0 };
  }

  /** Returneaza valoarea din cache sau o calculeaza si o memoreaza. */
  getOrCompute(key: string, compute: () => T): { value: T; hit: boolean } {
    const existing = this.store.get(key);
    if (existing !== undefined) {
      this.stats.hits++;
      return { value: existing, hit: true };
    }
    this.stats.misses++;
    const value = compute();
    this.store.set(key, value);
    return { value, hit: false };
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  get size(): number {
    return this.store.size;
  }
}
