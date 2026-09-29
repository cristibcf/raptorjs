/**
 * ReactiveStore - starea autoritativa a serverului plus motorul de sincronizare
 * (whitepaper 24, 24.1). Aplica operatii asupra unui Document autoritativ, le
 * difuzeaza subscriberilor ca batch-uri versionate cu numere de secventa, si
 * pastreaza un op-log pentru automatic delta resync (v0.2, 14.3).
 *
 * Motorul de sync e separat de business logic: mutatorii produc rezultate
 * canonice, iar broadcast-ul + resync calculeaza ce vede fiecare subscriber.
 */
import { Document, AddressBook, type Operation, type WireValue, type OpsBatch } from "@raptor/wire";

export interface ServerConnection {
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  close(): void;
}

export interface Subscription {
  conn: ServerConnection;
  queryId: number;
  prefixes: string[];
  seq: number;
  /** Reactive Address Space per conexiune (session-scoped, v0.2 5.2). */
  book: AddressBook;
}

interface LogEntry {
  version: number;
  ops: Operation[];
}

/** Rezultatul unei incercari de resync incremental. */
export type ResyncResult =
  | { mode: "delta"; ops: Operation[]; base: number; toVersion: number }
  | { mode: "snapshot" };

function matches(handle: string, prefixes: string[]): boolean {
  // Un prefix expune handle-uri copil DOAR daca se termina cu un delimitator
  // (":", "/", "."). Altfel se cere potrivire exacta - previne expunerea
  // accidentala a unor handle-uri vecine (ex. "cpu" sa nu prinda "cpuSecret").
  return prefixes.some((p) => {
    if (handle === p) return true;
    const isPrefix = p.endsWith(":") || p.endsWith("/") || p.endsWith(".");
    return isPrefix && handle.startsWith(p);
  });
}

export type Broadcaster = (sub: Subscription, batch: OpsBatch, sequence: number) => void;

export class ReactiveStore {
  readonly doc = new Document();
  private readonly subs: Subscription[] = [];
  private readonly log: LogEntry[] = [];
  private pending: Operation[] | null = null;
  private broadcaster: Broadcaster = () => {};

  onBroadcast(fn: Broadcaster): void {
    this.broadcaster = fn;
  }

  addSubscription(sub: Subscription): void {
    this.subs.push(sub);
  }

  removeConnection(conn: ServerConnection): void {
    for (let i = this.subs.length - 1; i >= 0; i--) {
      if (this.subs[i]!.conn === conn) this.subs.splice(i, 1);
    }
  }

  /** Cate subscriptii sunt active - util ca sa verifici ca deconectarile chiar curata. */
  get subscriptionCount(): number {
    return this.subs.length;
  }

  /** Snapshot doar cu handle-urile care se potrivesc prefixelor. */
  snapshotFor(prefixes: string[]): Uint8Array {
    const snap = new Document();
    snap.version = this.doc.version;
    for (const handle of this.doc.handles()) {
      if (matches(handle, prefixes)) snap.set(handle, this.doc.get(handle) as WireValue);
    }
    return snap.encodeSnapshot();
  }

  /**
   * Automatic delta resync (v0.2, 14.3): daca istoricul acopera continuu de la
   * `sinceVersion`, intoarce doar operatiile lipsa; altfel cere snapshot.
   * "Zero full resend" cand aceeasi epoca si istoric suficient.
   */
  resyncSince(sinceVersion: number, prefixes: string[]): ResyncResult {
    if (sinceVersion <= 0 || sinceVersion > this.doc.version) return { mode: "snapshot" };
    if (sinceVersion === this.doc.version) {
      return { mode: "delta", ops: [], base: sinceVersion, toVersion: sinceVersion };
    }
    const missed = this.log.filter((e) => e.version > sinceVersion);
    // Continuitate: prima intrare lipsa trebuie sa fie exact sinceVersion+1.
    if (missed.length === 0 || missed[0]!.version !== sinceVersion + 1) return { mode: "snapshot" };
    const ops: Operation[] = [];
    for (const entry of missed) {
      for (const op of entry.ops) if (matches(op.handle, prefixes)) ops.push(op);
    }
    return { mode: "delta", ops, base: sinceVersion, toVersion: this.doc.version };
  }

  // --- Mutatori (aplica autoritativ + difuzeaza) ---------------------------
  private push(op: Operation): void {
    this.doc.apply(op);
    if (this.pending) this.pending.push(op);
    else this.broadcast([op], false);
  }

  setSignal(handle: string, value: WireValue): void {
    this.push({ kind: "replace", handle, value });
  }
  setField(handle: string, field: string, value: WireValue): void {
    this.push({ kind: "set", handle, field, value });
  }
  inc(handle: string, field: string, delta: number): void {
    this.push({ kind: "inc", handle, field, delta });
  }
  patch(handle: string, fields: Record<string, WireValue>): void {
    this.push({ kind: "patch", handle, fields });
  }
  append(handle: string, value: WireValue): void {
    this.push({ kind: "append", handle, value });
  }
  insert(handle: string, index: number, value: WireValue): void {
    this.push({ kind: "insert", handle, index, value });
  }
  remove(handle: string, index: number): void {
    this.push({ kind: "remove", handle, index });
  }
  move(handle: string, from: number, to: number): void {
    this.push({ kind: "move", handle, from, to });
  }
  clear(handle: string): void {
    this.push({ kind: "clear", handle });
  }

  /**
   * Tranzactie de retea (v0.2, 16.1): grupeaza operatiile intr-un singur batch
   * atomic; clientul face UN singur DOM commit la final.
   */
  transaction<T>(fn: () => T): T {
    if (this.pending) return fn(); // deja intr-o tranzactie
    this.pending = [];
    try {
      return fn();
    } finally {
      const ops = this.pending;
      this.pending = null;
      if (ops && ops.length) this.broadcast(ops, ops.length > 1);
    }
  }

  private broadcast(ops: Operation[], atomic: boolean): void {
    const base = this.doc.version;
    const result = base + 1;
    this.doc.version = result;
    this.log.push({ version: result, ops });
    for (const sub of this.subs) {
      const filtered = ops.filter((op) => matches(op.handle, sub.prefixes));
      if (filtered.length === 0) continue;
      sub.seq++;
      const batch: OpsBatch = { baseVersion: base, resultVersion: result, atomic, ops: filtered };
      this.broadcaster(sub, batch, sub.seq);
    }
  }
}
