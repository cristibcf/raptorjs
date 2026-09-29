/**
 * `raptor:kv` (spec sectiunea 6): interfata portabila de key-value, cu store
 * implicit in memorie pentru dezvoltare. Contractul este ce conteaza - backing
 * store-ul se inlocuieste fara sa schimbe codul aplicatiei.
 */
import type { HostContext } from "../context.ts";

export interface KvEntry {
  readonly key: string;
  readonly value: string;
  readonly expiresAtMs: number | null;
}

export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ttlMs?: number }): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(prefix?: string): Promise<readonly string[]>;
  clear(): Promise<void>;
}

export interface RaptorKv extends KvStore {
  /** Deschide un spatiu de nume izolat pe acelasi backing store. */
  namespace(name: string): KvStore;
}

/** Backing store implicit: in memorie, cu TTL evaluat lenes la citire. */
export function createMemoryBacking(now: () => number = () => Date.now()): Map<string, KvEntry> & { now: () => number } {
  const map = new Map<string, KvEntry>() as Map<string, KvEntry> & { now: () => number };
  map.now = now;
  return map;
}

/**
 * Separatorul de spatiu de nume. Un prefix gol nu ar functiona: orice cheie
 * incepe cu el, deci store-ul radacina ar lista si cheile spatiilor de nume.
 * Cu un separator explicit, radacina este ea insasi un spatiu de nume ("").
 */
const NAMESPACE_SEPARATOR = String.fromCharCode(0);

export function createKv(host: HostContext, backing = createMemoryBacking()): RaptorKv {
  const open = (namespace: string): KvStore => {
    const prefix = namespace + NAMESPACE_SEPARATOR;
    const full = (key: string): string => prefix + key;

    const live = (entry: KvEntry | undefined): KvEntry | null => {
      if (!entry) return null;
      if (entry.expiresAtMs !== null && entry.expiresAtMs <= backing.now()) return null;
      return entry;
    };

    return {
      async get(key: string): Promise<string | null> {
        const entry = live(backing.get(full(key)));
        if (!entry) {
          backing.delete(full(key));
          return null;
        }
        return entry.value;
      },

      async set(key: string, value: string, options: { ttlMs?: number } = {}): Promise<void> {
        const ttl = options.ttlMs;
        backing.set(full(key), {
          key: full(key),
          value,
          expiresAtMs: ttl === undefined ? null : backing.now() + ttl,
        });
        host.observer.metric("kv.set", value.length, { key: full(key) });
      },

      async delete(key: string): Promise<boolean> {
        return backing.delete(full(key));
      },

      async list(scan = ""): Promise<readonly string[]> {
        const out: string[] = [];
        for (const [key, entry] of backing) {
          if (!key.startsWith(prefix + scan)) continue;
          if (!live(entry)) continue;
          out.push(key.slice(prefix.length));
        }
        return out.sort();
      },

      async clear(): Promise<void> {
        for (const key of [...backing.keys()]) {
          if (key.startsWith(prefix)) backing.delete(key);
        }
      },
    };
  };

  const root = open("");
  return {
    ...root,
    namespace(name: string): KvStore {
      return open(name);
    },
  };
}
