/**
 * RaptorClient - a browser-side RaptorWire session (whitepaper 14, 15).
 * Maintains a reactive replica: each handle becomes a @raptorstack/raptorjs signal, and
 * delta operations update only the affected signals -> fine-grained DOM
 * bindings with no re-fetch and no re-serialization.
 *
 * v0.2: receives operations over the Reactive Address Space (compact addresses,
 * 5.2), applies an atomic frame with ONE UI commit (batch, 16.1) and supports
 * reconnect with automatic delta resync (14.3) via `resume`.
 */
import { state, batch, type State, type Accessor } from "@raptorstack/raptorjs";
import {
  Document,
  AddressBook,
  encodeMessage,
  decodeMessage,
  decodeOpsFrame,
  peekFrameType,
  FrameType,
  type WireValue,
  type Message,
  type QueryMsg,
} from "@raptorstack/wire";
import { type Transport } from "./transport.ts";

export interface RaptorClientOptions {
  build?: string;
  protocolVersion?: number;
  /** Notified when a sequence gap is detected (resync needed). */
  onGap?: (queryId: number, expected: number, received: number) => void;
}

interface PendingMutation {
  resolve: (value: { ok: boolean; value: WireValue }) => void;
}

export class RaptorClient {
  private transport: Transport;
  private readonly build: string;
  private readonly protocolVersion: number;
  private onGap: RaptorClientOptions["onGap"];

  private readonly replica = new Document();
  private book = new AddressBook();
  private readonly signals = new Map<string, State<WireValue | undefined>>();
  private readonly lastSeq = new Map<number, number>();
  private readonly pending = new Map<number, PendingMutation>();
  private readonly subscriptions = new Map<number, { name: string; args: WireValue }>();

  private nextQueryId = 1;
  private nextRequestId = 1;
  private welcomeResolve: (() => void) | null = null;
  private lastAckSeq = 0;

  sessionId = "";
  epoch = 0;
  // Counters for the performance budgets (v0.2, 25.2).
  snapshotsReceived = 0;
  opsFramesReceived = 0;

  constructor(transport: Transport, options: RaptorClientOptions = {}) {
    this.transport = transport;
    this.build = options.build ?? "0.1.0";
    this.protocolVersion = options.protocolVersion ?? 1;
    this.onGap = options.onGap;
  }

  /** The local replica version (for resume). */
  get version(): number {
    return this.replica.version;
  }

  /** Handshake: send HELLO and wait for WELCOME. */
  connect(): Promise<void> {
    this.bindTransport();
    const promise = new Promise<void>((resolve) => (this.welcomeResolve = resolve));
    this.send({
      type: "hello",
      protocolVersion: this.protocolVersion,
      clientBuild: this.build,
      capabilities: ["resume", "ops", "ras"],
    });
    return promise;
  }

  /**
   * Reconnect with automatic delta resync (v0.2, 14.3): keeps the replica and
   * version, redoes the handshake on the new transport and re-subscribes asking
   * only for the delta since the current version (no full resend when the
   * server can converge).
   */
  async resume(transport: Transport, name: string, args: WireValue = null): Promise<void> {
    this.transport = transport;
    this.book = new AddressBook(); // new session = new address space; the state stays
    this.bindTransport();
    await new Promise<void>((resolve) => {
      this.welcomeResolve = resolve;
      this.send({
        type: "hello",
        protocolVersion: this.protocolVersion,
        clientBuild: this.build,
        capabilities: ["resume", "ops", "ras"],
        resumeToken: this.sessionId,
        lastAck: this.lastAckSeq,
      });
    });
    this.subscribe(name, args, this.version);
  }

  /** Subscribe to a named query; snapshot/ops arrive asynchronously. */
  subscribe(name: string, args: WireValue = null, sinceVersion = 0): number {
    const queryId = this.nextQueryId++;
    this.lastSeq.set(queryId, 0);
    this.subscriptions.set(queryId, { name, args });
    const msg: QueryMsg =
      sinceVersion > 0
        ? { type: "query", queryId, name, args, sinceVersion }
        : { type: "query", queryId, name, args };
    this.send(msg);
    return queryId;
  }

  /** Reactive signal for a handle (created lazily). */
  signal<T extends WireValue = WireValue>(handle: string): Accessor<T | undefined> {
    return this.ensureSignal(handle) as Accessor<T | undefined>;
  }

  /** Send a typed mutation; resolves on MUTATION_RESULT. */
  mutate(name: string, input: WireValue = null): Promise<{ ok: boolean; value: WireValue }> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve) => {
      this.pending.set(requestId, { resolve });
      this.send({ type: "mutation", requestId, name, input });
    });
  }

  set gapHandler(fn: RaptorClientOptions["onGap"]) {
    this.onGap = fn;
  }

  close(): void {
    this.transport.close();
  }

  // --- internal ------------------------------------------------------------
  private bindTransport(): void {
    this.transport.onMessage((bytes) => {
      // Fail-closed (§21): an invalid/corrupt frame is ignored, not thrown in a
      // microtask. OPS hot path decoded over the Reactive Address Space.
      try {
        if (peekFrameType(bytes) === FrameType.OPS) {
          this.handle(decodeOpsFrame(this.book, bytes));
        } else {
          this.handle(decodeMessage(bytes));
        }
      } catch (err) {
        console.warn(`[raptor] invalid frame ignored: ${String(err)}`);
      }
    });
  }

  private send(msg: Message): void {
    this.transport.send(encodeMessage(msg));
  }

  private ensureSignal(handle: string): State<WireValue | undefined> {
    let sig = this.signals.get(handle);
    if (!sig) {
      sig = state<WireValue | undefined>(this.replica.get(handle), { equal: false });
      this.signals.set(handle, sig);
    }
    return sig;
  }

  private touch(handle: string): void {
    this.ensureSignal(handle).set(this.replica.get(handle));
  }

  private handle(msg: Message): void {
    switch (msg.type) {
      case "welcome": {
        this.sessionId = msg.sessionId;
        this.epoch = msg.epoch;
        this.welcomeResolve?.();
        this.welcomeResolve = null;
        break;
      }
      case "snapshot": {
        this.snapshotsReceived++;
        const snap = Document.decodeSnapshot(msg.snapshot);
        batch(() => {
          for (const handle of snap.handles()) {
            this.replica.set(handle, snap.get(handle) as WireValue);
            this.touch(handle);
          }
        });
        this.replica.version = snap.version;
        this.lastSeq.set(msg.queryId, 0);
        break;
      }
      case "ops": {
        this.opsFramesReceived++;
        const expected = (this.lastSeq.get(msg.queryId) ?? 0) + 1;
        if (msg.sequence !== expected) {
          this.onGap?.(msg.queryId, expected, msg.sequence);
        }
        // Network transaction: ALL changes in a single DOM commit (16.1).
        batch(() => {
          const changes = this.replica.applyBatch(msg.batch);
          for (const change of changes) this.touch(change.handle);
        });
        this.lastSeq.set(msg.queryId, msg.sequence);
        this.lastAckSeq = msg.sequence;
        this.send({ type: "ack", queryId: msg.queryId, sequence: msg.sequence });
        break;
      }
      case "mutationResult": {
        const pending = this.pending.get(msg.requestId);
        if (pending) {
          this.pending.delete(msg.requestId);
          pending.resolve({ ok: msg.ok, value: msg.value });
        }
        break;
      }
      case "error":
        console.warn(`[raptor] server error ${msg.code}: ${msg.message}`);
        break;
      default:
        break;
    }
  }
}
