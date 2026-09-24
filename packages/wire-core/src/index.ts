/** @raptor/wire-core - opcodes, valori, operatii, document versionat, protocol. */
export {
  Opcode,
  FrameType,
  OpKindToCode,
  CodeToOpKind,
  type OpcodeValue,
  type OpKind,
  type FrameTypeValue,
} from "./opcodes.ts";

export { type WireValue, writeValue, readValue } from "./value.ts";

export {
  type Operation,
  type SetOp,
  type IncOp,
  type AppendOp,
  type InsertOp,
  type RemoveOp,
  type MoveOp,
  type PatchOp,
  type ClearOp,
  type ReplaceOp,
  type OpsBatch,
  encodeOp,
  decodeOp,
  encodeOpsBatch,
  decodeOpsBatch,
  writeOpBody,
  readOpBody,
} from "./operation.ts";

export { Document, type Change } from "./document.ts";

export { AddressBook } from "./address.ts";

export {
  type Schema,
  type FieldSchema,
  SchemaCodec,
} from "./schema.ts";

export {
  type Message,
  type HelloMsg,
  type WelcomeMsg,
  type QueryMsg,
  type SnapshotMsg,
  type OpsMsg,
  type AckMsg,
  type MutationMsg,
  type MutationResultMsg,
  type ErrorMsg,
  encodeMessage,
  decodeMessage,
  encodeOpsFrame,
  decodeOpsFrame,
  peekFrameType,
} from "./protocol.ts";
