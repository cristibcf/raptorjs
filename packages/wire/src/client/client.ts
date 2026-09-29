/**
 * RaptorClient - sesiune RaptorWire pe partea de browser (whitepaper 14, 15).
 * Mentine o replica reactiva: fiecare handle devine un semnal @raptor/core, iar
 * operatiile delta actualizeaza doar semnalele afectate -> bindings DOM
 * fine-grained fara re-fetch si fara re-serializare.
 *
 * v0.2: primeste operatii pe Reactive Address Space (adrese compacte, 5.2),
 * aplica un frame atomic cu UN singur commit UI (batch, 16.1) si suporta
 * reconnect cu automatic delta resync (14.3) prin `resume`.
 */
import { state, batch, type State, type Accessor } from "raptorjs";
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
} from "@raptor/wire";
import { type Transport } from "./transport.ts";

export interface RaptorClientOptions {
  build?: string;
  protocolVersion?: number;
  /** Notificat cand se detecteaza o gaura de secventa (resync necesar). */
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
  // Contoare pentru bugetele de performanta (v0.2, 25.2).
  snapshotsReceived = 0;
  opsFramesReceived = 0;

  constructor(transport: Transport, options: RaptorClientOptions = {}) {
    this.transport = transport;
    this.build = options.build ?? "0.1.0";
    this.protocolVersion = options.protocolVersion ?? 1;
    this.onGap = options.onGap;
  }

  /** Versiunea replicii locale (pentru resume). */
  get version(): number {
    return this.replica.version;
  }

  /** Handshake: trimite HELLO si asteapta WELCOME. */
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
   * Reconnect cu automatic delta resync (v0.2, 14.3): pastreaza replica si
   * versiunea, reface handshake-ul pe noul transport si re-abonoaza cerand doar
   * delta de la versiunea curenta (fara full resend cand serverul poate converge).
   */
  async resume(transport: Transport, name: string, args: WireValue = null): Promise<void> {
    this.transport = transport;
    this.book = new AddressBook(); // sesiune noua = address space nou; starea ramane
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

  /** Aboneaza-te la un query numit; snapshot/ops vin asincron. */
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

  /** Semnal reactiv pentru un handle (creat lazy). */
  signal<T extends WireValue = WireValue>(handle: string): Accessor<T | undefined> {
    return this.ensureSignal(handle) as Accessor<T | undefined>;
  }

  /** Trimite o mutatie tipata; se rezolva la MUTATION_RESULT. */
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

  // --- intern --------------------------------------------------------------
  private bindTransport(): void {
    this.transport.onMessage((bytes) => {
      // Fail-closed (§21): un frame invalid/corupt e ignorat, nu arunca in
      // microtask. Hot path OPS decodat pe Reactive Address Space.
      try {
        if (peekFrameType(bytes) === FrameType.OPS) {
          this.handle(decodeOpsFrame(this.book, bytes));
        } else {
          this.handle(decodeMessage(bytes));
        }
      } catch (err) {
        console.warn(`[raptor] frame invalid ignorat: ${String(err)}`);
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
        // Tranzactie de retea: TOATE schimbarile intr-un singur DOM commit (16.1).
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
        console.warn(`[raptor] eroare server ${msg.code}: ${msg.message}`);
        break;
      default:
        break;
    }
  }
}
