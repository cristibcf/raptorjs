/**
 * Semantic caching and reproducibility (RaptorEngine whitepaper 21).
 *
 * The cache key is not just the file hash: it includes the compiler version,
 * the profile, the target and the schema compatibility version (21.1). A no-op
 * edit yields a cache hit; a local edit invalidates only the relevant entries.
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

/** Stable content hash (sha256 hex) over all inputs that affect the output. */
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

/** In-memory cache with statistics (content-addressed). */
export class SemanticCache<T> {
  private readonly store: Map<string, T>;
  readonly stats: CacheStats;
  constructor() {
    this.store = new Map();
    this.stats = { hits: 0, misses: 0 };
  }

  /** Returns the value from the cache, or computes and memoizes it. */
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
