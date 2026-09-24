/**
 * RaptorTwin - backend digital twin stateful (whitepaper §9, §13).
 *
 * VirtualDB: entitati + CRUD + relatii de ID. RaptorTwin: rute peste DB, cu
 * snapshot/fork copy-on-write pentru State Forking (testare paralela fara
 * reseed complet). Nu recreeaza microserviciile reale, ci contractele si
 * tranzitiile observabile.
 */

export interface TwinRequest {
  method: string;
  path: string;
  body: unknown;
  params: Record<string, string>;
}
export interface TwinResponse {
  status: number;
  body: unknown;
}
export type RouteHandler = (req: TwinRequest, db: VirtualDB) => TwinResponse;

interface Route {
  method: string;
  pattern: string; // ex. "/cart/items", "/orders/:id"
  handler: RouteHandler;
}

export class VirtualDB {
  private readonly collections = new Map<string, Map<number, Record<string, unknown>>>();
  private readonly seqs = new Map<string, number>();

  private col(name: string): Map<number, Record<string, unknown>> {
    let c = this.collections.get(name);
    if (!c) {
      c = new Map();
      this.collections.set(name, c);
    }
    return c;
  }

  create(collection: string, record: Record<string, unknown>): Record<string, unknown> {
    const id = (this.seqs.get(collection) ?? 0) + 1;
    this.seqs.set(collection, id);
    const stored = { id, ...record };
    this.col(collection).set(id, stored);
    return { ...stored };
  }

  read(collection: string, id: number): Record<string, unknown> | undefined {
    const r = this.col(collection).get(id);
    return r ? { ...r } : undefined;
  }

  update(collection: string, id: number, patch: Record<string, unknown>): Record<string, unknown> | undefined {
    const r = this.col(collection).get(id);
    if (!r) return undefined;
    // Asignare proprie (nu Object.assign): evita setter-ul __proto__ / prototype pollution.
    for (const key of Object.keys(patch)) {
      Object.defineProperty(r, key, { value: patch[key], writable: true, enumerable: true, configurable: true });
    }
    return { ...r };
  }

  delete(collection: string, id: number): boolean {
    return this.col(collection).delete(id);
  }

  list(collection: string): Record<string, unknown>[] {
    return [...this.col(collection).values()].map((r) => ({ ...r }));
  }

  /** Snapshot copy-on-write (deep clone). */
  snapshot(): unknown {
    return structuredClone({
      collections: [...this.collections.entries()].map(([k, v]) => [k, [...v.entries()]]),
      seqs: [...this.seqs.entries()],
    });
  }

  restore(snap: unknown): void {
    const s = structuredClone(snap) as {
      collections: [string, [number, Record<string, unknown>][]][];
      seqs: [string, number][];
    };
    this.collections.clear();
    this.seqs.clear();
    for (const [name, entries] of s.collections) this.collections.set(name, new Map(entries));
    for (const [name, seq] of s.seqs) this.seqs.set(name, seq);
  }
}

export class RaptorTwin {
  readonly db = new VirtualDB();
  private readonly routes: Route[] = [];

  route(method: string, pattern: string, handler: RouteHandler): this {
    this.routes.push({ method: method.toUpperCase(), pattern, handler });
    return this;
  }

  handle(method: string, path: string, body: unknown): TwinResponse {
    const m = method.toUpperCase();
    for (const r of this.routes) {
      if (r.method !== m) continue;
      const params = matchPattern(r.pattern, path);
      if (params) return r.handler({ method: m, path, body, params }, this.db);
    }
    return { status: 404, body: { error: "no route" } };
  }

  /** State fork copy-on-write: intoarce o functie care restaureaza snapshot-ul. */
  fork(): () => void {
    const snap = this.db.snapshot();
    return () => this.db.restore(snap);
  }

  snapshot(): unknown {
    return this.db.snapshot();
  }
  restore(snap: unknown): void {
    this.db.restore(snap);
  }
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean);
  const pathParts = path.split("?")[0]!.split("/").filter(Boolean);
  if (pp.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const seg = pp[i]!;
    const val = pathParts[i]!;
    if (seg.startsWith(":")) params[seg.slice(1)] = val;
    else if (seg !== val) return null;
  }
  return params;
}
