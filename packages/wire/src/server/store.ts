/**
 * ReactiveStore - the server's authoritative state plus the synchronization
 * engine (whitepaper 24, 24.1). Applies operations to an authoritative
 * Document, broadcasts them to subscribers as versioned batches with sequence
 * numbers, and keeps an op-log for automatic delta resync (v0.2, 14.3).
 *
 * The sync engine is separate from business logic: mutators produce canonical
 * results, and broadcast + resync compute what each subscriber sees.
 */
import { Document, AddressBook, type Operation, type WireValue, type OpsBatch } from "@raptorstack/wire";

/**
 * What the transport knew about the connection before RaptorWire took it over
 * (v0.2.1). `onConnect` needs it: a cookie or an `Authorization` header is the
 * only place a real deployment keeps the caller's identity, and the protocol
 * itself deliberately carries no credentials (21 - the client is untrusted).
 *
 * Optional on purpose: a loopback or an embedded transport has no handshake,
 * and a custom one written against 0.2.0 still satisfies the interface.
 */
export interface ConnectionHandshake {
  /** Request target as received, path plus query. */
  readonly url: string;
  /** Header names lowercased, exactly as the transport parsed them. */
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Peer address, when the transport knows one. */
  readonly remoteAddress?: string;
}

export interface ServerConnection {
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  close(): void;
  /** Set by transports that have one; see `ConnectionHandshake`. */
  readonly handshake?: ConnectionHandshake;
}

export interface Subscription {
  conn: ServerConnection;
  queryId: number;
  prefixes: string[];
  seq: number;
  /** Reactive Address Space per connection (session-scoped, v0.2 5.2). */
  book: AddressBook;
}

interface LogEntry {
  version: number;
  ops: Operation[];
}

/** The result of an incremental resync attempt. */
export type ResyncResult =
  | { mode: "delta"; ops: Operation[]; base: number; toVersion: number }
  | { mode: "snapshot" };

function matches(handle: string, prefixes: string[]): boolean {
  // A prefix exposes child handles ONLY if it ends with a delimiter
  // (":", "/", "."). Otherwise an exact match is required - prevents accidental
  // exposure of neighboring handles (e.g. "cpu" must not catch "cpuSecret").
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

  /**
   * Drops one subscription of one connection. Returns whether there was one.
   *
   * The counterpart of `addSubscription`, and it was missing: closing the
   * connection used to be the only way to stop a subscription, so an
   * application that navigates between screens on one socket kept every
   * subscription it had ever opened, and `broadcast` walked all of them on
   * every mutation.
   */
  removeSubscription(conn: ServerConnection, queryId: number): boolean {
    for (let i = this.subs.length - 1; i >= 0; i--) {
      const sub = this.subs[i]!;
      if (sub.conn === conn && sub.queryId === queryId) {
        this.subs.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /** How many subscriptions are active - useful to check that disconnects really clean up. */
  get subscriptionCount(): number {
    return this.subs.length;
  }

  /** Snapshot with only the handles that match the prefixes. */
  snapshotFor(prefixes: string[]): Uint8Array {
    const snap = new Document();
    snap.version = this.doc.version;
    for (const handle of this.doc.handles()) {
      if (matches(handle, prefixes)) snap.set(handle, this.doc.get(handle) as WireValue);
    }
    return snap.encodeSnapshot();
  }

  /**
   * Automatic delta resync (v0.2, 14.3): if the history covers continuously
   * from `sinceVersion`, return only the missing operations; otherwise request
   * a snapshot. "Zero full resend" when the same epoch and enough history.
   */
  resyncSince(sinceVersion: number, prefixes: string[]): ResyncResult {
    if (sinceVersion <= 0 || sinceVersion > this.doc.version) return { mode: "snapshot" };
    if (sinceVersion === this.doc.version) {
      return { mode: "delta", ops: [], base: sinceVersion, toVersion: sinceVersion };
    }
    const missed = this.log.filter((e) => e.version > sinceVersion);
    // Continuity: the first missing entry must be exactly sinceVersion+1.
    if (missed.length === 0 || missed[0]!.version !== sinceVersion + 1) return { mode: "snapshot" };
    const ops: Operation[] = [];
    for (const entry of missed) {
      for (const op of entry.ops) if (matches(op.handle, prefixes)) ops.push(op);
    }
    return { mode: "delta", ops, base: sinceVersion, toVersion: this.doc.version };
  }

  // --- Mutators (apply authoritatively + broadcast) ------------------------
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
   * Network transaction (v0.2, 16.1): groups the operations into a single
   * atomic batch; the client does ONE DOM commit at the end.
   */
  transaction<T>(fn: () => T): T {
    if (this.pending) return fn(); // already inside a transaction
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
