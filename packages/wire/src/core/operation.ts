/**
 * State-aware operations and versioned batches (whitepaper 13, 14, 31.3).
 * Each operation targets a "handle" (an object/collection/signal id, usually
 * session-local after a snapshot - see section 31.3).
 */
import { Writer, Reader } from "@raptorstack/wire/codec";
import { OpKindToCode, CodeToOpKind, type OpKind } from "./opcodes.ts";
import { type WireValue, writeValue, readValue } from "./value.ts";
import { setOwn } from "./safe.ts";

export interface SetOp {
  kind: "set";
  handle: string;
  field: string;
  value: WireValue;
}
export interface IncOp {
  kind: "inc";
  handle: string;
  field: string;
  delta: number;
}
export interface AppendOp {
  kind: "append";
  handle: string;
  value: WireValue;
}
export interface InsertOp {
  kind: "insert";
  handle: string;
  index: number;
  value: WireValue;
}
export interface RemoveOp {
  kind: "remove";
  handle: string;
  index: number;
}
export interface MoveOp {
  kind: "move";
  handle: string;
  from: number;
  to: number;
}
export interface PatchOp {
  kind: "patch";
  handle: string;
  fields: Record<string, WireValue>;
}
export interface ClearOp {
  kind: "clear";
  handle: string;
}
export interface ReplaceOp {
  kind: "replace";
  handle: string;
  value: WireValue;
}

export type Operation =
  | SetOp
  | IncOp
  | AppendOp
  | InsertOp
  | RemoveOp
  | MoveOp
  | PatchOp
  | ClearOp
  | ReplaceOp;

/** The body of an operation WITHOUT the handle (also used by address encoding - RAS). */
export function writeOpBody(w: Writer, op: Operation): void {
  switch (op.kind) {
    case "set":
      w.string(op.field);
      writeValue(w, op.value);
      break;
    case "inc":
      w.string(op.field);
      w.float64(op.delta);
      break;
    case "append":
      writeValue(w, op.value);
      break;
    case "insert":
      w.varint(op.index);
      writeValue(w, op.value);
      break;
    case "remove":
      w.varint(op.index);
      break;
    case "move":
      w.varint(op.from);
      w.varint(op.to);
      break;
    case "patch": {
      const keys = Object.keys(op.fields);
      w.varint(keys.length);
      for (const key of keys) {
        w.string(key);
        writeValue(w, op.fields[key] as WireValue);
      }
      break;
    }
    case "clear":
      break;
    case "replace":
      writeValue(w, op.value);
      break;
  }
}

/** Reconstruct an operation from an already-known kind + handle + body. */
export function readOpBody(r: Reader, kind: OpKind, handle: string): Operation {
  switch (kind) {
    case "set":
      return { kind, handle, field: r.string(), value: readValue(r) };
    case "inc":
      return { kind, handle, field: r.string(), delta: r.float64() };
    case "append":
      return { kind, handle, value: readValue(r) };
    case "insert":
      return { kind, handle, index: r.varint(), value: readValue(r) };
    case "remove":
      return { kind, handle, index: r.varint() };
    case "move":
      return { kind, handle, from: r.varint(), to: r.varint() };
    case "patch": {
      const count = r.varint();
      const fields: Record<string, WireValue> = {};
      for (let i = 0; i < count; i++) setOwn(fields, r.string(), readValue(r));
      return { kind, handle, fields };
    }
    case "clear":
      return { kind, handle };
    case "replace":
      return { kind, handle, value: readValue(r) };
    default:
      throw new RangeError(`[wire] unknown kind: ${kind as string}`);
  }
}

export function encodeOp(w: Writer, op: Operation): void {
  w.u8(OpKindToCode[op.kind]);
  w.string(op.handle);
  writeOpBody(w, op);
}

export function decodeOp(r: Reader): Operation {
  const code = r.u8();
  const kind = CodeToOpKind[code];
  if (!kind) throw new RangeError(`[wire] unknown opcode: ${code}`);
  const handle = r.string();
  return readOpBody(r, kind, handle);
}

/** A batch of operations with versioning + transaction id (idempotency, section 14). */
export interface OpsBatch {
  transactionId?: number;
  baseVersion: number;
  resultVersion: number;
  /** Network transaction: the client applies everything and does ONE DOM commit (v0.2, 16.1). */
  atomic?: boolean;
  ops: Operation[];
}

export function encodeOpsBatch(w: Writer, batch: OpsBatch): void {
  const hasTx = batch.transactionId !== undefined;
  w.bool(hasTx);
  if (hasTx) w.varint(batch.transactionId as number);
  w.bool(batch.atomic ?? false);
  w.varint(batch.baseVersion);
  w.varint(batch.resultVersion);
  w.varint(batch.ops.length);
  for (const op of batch.ops) encodeOp(w, op);
}

export function decodeOpsBatch(r: Reader): OpsBatch {
  const hasTx = r.bool();
  const transactionId = hasTx ? r.varint() : undefined;
  const atomic = r.bool();
  const baseVersion = r.varint();
  const resultVersion = r.varint();
  const count = r.varint();
  const ops: Operation[] = [];
  for (let i = 0; i < count; i++) ops.push(decodeOp(r));
  return transactionId === undefined
    ? { baseVersion, resultVersion, atomic, ops }
    : { transactionId, baseVersion, resultVersion, atomic, ops };
}
