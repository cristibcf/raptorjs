/**
 * The RaptorWire message protocol: a frame envelope (type + payload) plus a
 * set of messages for handshake, subscription, snapshot, ops, ack and mutations
 * (whitepaper 14 and 31.2). A single codec shared by server and client.
 */
import { Writer, Reader } from "@raptor/wire/codec";
import { FrameType, OpKindToCode, CodeToOpKind } from "./opcodes.ts";
import { type WireValue, writeValue, readValue } from "./value.ts";
import { type OpsBatch, encodeOpsBatch, decodeOpsBatch, writeOpBody, readOpBody } from "./operation.ts";
import { type AddressBook } from "./address.ts";

export interface HelloMsg {
  type: "hello";
  protocolVersion: number;
  clientBuild: string;
  capabilities: string[];
  resumeToken?: string;
  lastAck?: number;
}
export interface WelcomeMsg {
  type: "welcome";
  sessionId: string;
  epoch: number;
  serverBuild: string;
}
export interface QueryMsg {
  type: "query";
  queryId: number;
  name: string;
  args: WireValue;
  /** Incremental replay: the last version known to the client (v0.2, 14.3). */
  sinceVersion?: number;
}
export interface SnapshotMsg {
  type: "snapshot";
  queryId: number;
  snapshot: Uint8Array;
}
export interface OpsMsg {
  type: "ops";
  queryId: number;
  sequence: number;
  batch: OpsBatch;
}
export interface AckMsg {
  type: "ack";
  queryId: number;
  sequence: number;
}
export interface MutationMsg {
  type: "mutation";
  requestId: number;
  name: string;
  input: WireValue;
}
export interface MutationResultMsg {
  type: "mutationResult";
  requestId: number;
  ok: boolean;
  value: WireValue;
}
export interface ErrorMsg {
  type: "error";
  code: number;
  message: string;
}

export type Message =
  | HelloMsg
  | WelcomeMsg
  | QueryMsg
  | SnapshotMsg
  | OpsMsg
  | AckMsg
  | MutationMsg
  | MutationResultMsg
  | ErrorMsg;

export function encodeMessage(msg: Message): Uint8Array {
  const w = new Writer();
  switch (msg.type) {
    case "hello": {
      w.u8(FrameType.HELLO).varint(msg.protocolVersion).string(msg.clientBuild);
      w.varint(msg.capabilities.length);
      for (const cap of msg.capabilities) w.string(cap);
      w.bool(msg.resumeToken !== undefined);
      if (msg.resumeToken !== undefined) w.string(msg.resumeToken);
      w.bool(msg.lastAck !== undefined);
      if (msg.lastAck !== undefined) w.varint(msg.lastAck);
      break;
    }
    case "welcome":
      w.u8(FrameType.WELCOME).string(msg.sessionId).varint(msg.epoch).string(msg.serverBuild);
      break;
    case "query":
      w.u8(FrameType.QUERY).varint(msg.queryId).string(msg.name);
      writeValue(w, msg.args);
      w.varint(msg.sinceVersion ?? 0);
      break;
    case "snapshot":
      w.u8(FrameType.SNAPSHOT).varint(msg.queryId).bytes(msg.snapshot);
      break;
    case "ops":
      w.u8(FrameType.OPS).varint(msg.queryId).varint(msg.sequence);
      encodeOpsBatch(w, msg.batch);
      break;
    case "ack":
      w.u8(FrameType.ACK).varint(msg.queryId).varint(msg.sequence);
      break;
    case "mutation":
      w.u8(FrameType.MUTATION).varint(msg.requestId).string(msg.name);
      writeValue(w, msg.input);
      break;
    case "mutationResult":
      w.u8(FrameType.MUTATION_RESULT).varint(msg.requestId).bool(msg.ok);
      writeValue(w, msg.value);
      break;
    case "error":
      w.u8(FrameType.ERROR).varint(msg.code).string(msg.message);
      break;
  }
  return w.finish();
}

export function decodeMessage(bytes: Uint8Array): Message {
  const r = new Reader(bytes);
  const type = r.u8();
  switch (type) {
    case FrameType.HELLO: {
      const protocolVersion = r.varint();
      const clientBuild = r.string();
      const capCount = r.varint();
      const capabilities: string[] = [];
      for (let i = 0; i < capCount; i++) capabilities.push(r.string());
      const resumeToken = r.bool() ? r.string() : undefined;
      const lastAck = r.bool() ? r.varint() : undefined;
      const msg: HelloMsg = { type: "hello", protocolVersion, clientBuild, capabilities };
      if (resumeToken !== undefined) msg.resumeToken = resumeToken;
      if (lastAck !== undefined) msg.lastAck = lastAck;
      return msg;
    }
    case FrameType.WELCOME:
      return {
        type: "welcome",
        sessionId: r.string(),
        epoch: r.varint(),
        serverBuild: r.string(),
      };
    case FrameType.QUERY: {
      const queryId = r.varint();
      const name = r.string();
      const args = readValue(r);
      const sinceVersion = r.varint();
      return sinceVersion > 0
        ? { type: "query", queryId, name, args, sinceVersion }
        : { type: "query", queryId, name, args };
    }
    case FrameType.SNAPSHOT:
      return { type: "snapshot", queryId: r.varint(), snapshot: r.bytes().slice() };
    case FrameType.OPS:
      return {
        type: "ops",
        queryId: r.varint(),
        sequence: r.varint(),
        batch: decodeOpsBatch(r),
      };
    case FrameType.ACK:
      return { type: "ack", queryId: r.varint(), sequence: r.varint() };
    case FrameType.MUTATION:
      return {
        type: "mutation",
        requestId: r.varint(),
        name: r.string(),
        input: readValue(r),
      };
    case FrameType.MUTATION_RESULT:
      return {
        type: "mutationResult",
        requestId: r.varint(),
        ok: r.bool(),
        value: readValue(r),
      };
    case FrameType.ERROR:
      return { type: "error", code: r.varint(), message: r.string() };
    default:
      throw new RangeError(`[wire] unknown frame type: ${type}`);
  }
}

/**
 * OPS encoding over the Reactive Address Space (v0.2, 5.2/5.3): each operation
 * refers to a compact address instead of a string handle. The handle name is
 * sent only once, when the address is introduced (per-frame dictionary). After
 * negotiation, update frames no longer contain field names.
 */
export function encodeOpsFrame(book: AddressBook, msg: OpsMsg): Uint8Array {
  const w = new Writer();
  w.u8(FrameType.OPS).varint(msg.queryId).varint(msg.sequence);

  const addressed: Array<{ op: OpsBatch["ops"][number]; address: number }> = [];
  const dict: Array<{ address: number; name: string }> = [];
  for (const op of msg.batch.ops) {
    const { address, isNew } = book.assign(op.handle);
    if (isNew) dict.push({ address, name: op.handle });
    addressed.push({ op, address });
  }

  w.varint(dict.length);
  for (const entry of dict) w.varint(entry.address).string(entry.name);

  const hasTx = msg.batch.transactionId !== undefined;
  w.bool(hasTx);
  if (hasTx) w.varint(msg.batch.transactionId as number);
  w.bool(msg.batch.atomic ?? false);
  w.varint(msg.batch.baseVersion).varint(msg.batch.resultVersion).varint(addressed.length);
  for (const { op, address } of addressed) {
    w.u8(OpKindToCode[op.kind]).varint(address);
    writeOpBody(w, op);
  }
  return w.finish();
}

export function decodeOpsFrame(book: AddressBook, bytes: Uint8Array): OpsMsg {
  const r = new Reader(bytes);
  r.u8(); // FrameType.OPS
  const queryId = r.varint();
  const sequence = r.varint();

  const dictLen = r.varint();
  for (let i = 0; i < dictLen; i++) {
    const address = r.varint();
    const name = r.string();
    book.define(address, name);
  }

  const hasTx = r.bool();
  const transactionId = hasTx ? r.varint() : undefined;
  const atomic = r.bool();
  const baseVersion = r.varint();
  const resultVersion = r.varint();
  const count = r.varint();

  const ops: OpsBatch["ops"] = [];
  for (let i = 0; i < count; i++) {
    const code = r.u8();
    const address = r.varint();
    const handle = book.handleOf(address);
    if (handle === undefined) throw new RangeError(`[wire] unknown address: ${address}`);
    const kind = CodeToOpKind[code];
    if (!kind) throw new RangeError(`[wire] unknown opcode: ${code}`);
    ops.push(readOpBody(r, kind, handle));
  }

  const batch: OpsBatch =
    transactionId === undefined
      ? { baseVersion, resultVersion, atomic, ops }
      : { transactionId, baseVersion, resultVersion, atomic, ops };
  return { type: "ops", queryId, sequence, batch };
}

/** The type of a frame's first byte, for routing (OPS vs the rest). */
export function peekFrameType(bytes: Uint8Array): number {
  return bytes.length > 0 ? (bytes[0] as number) : -1;
}
