/**
 * State-aware opcodes and RaptorWire frame types (whitepaper 13 and 31.2).
 * We use `as const` objects instead of enums (erasable syntax).
 */

/** Opcodes for operations on state (section 13). */
export const Opcode = {
  SET: 0x01, // replace the value of a field
  INC: 0x02, // add a numeric delta
  APPEND: 0x03, // append to the end of a collection
  INSERT: 0x04, // insert at index
  REMOVE: 0x05, // remove element at index
  MOVE: 0x06, // reorder without retransmitting
  PATCH: 0x07, // batch of field updates on the same object
  CLEAR: 0x08, // empty the collection
  REPLACE: 0x09, // partial/full snapshot when a delta isn't worth it
} as const;

export type OpcodeValue = (typeof Opcode)[keyof typeof Opcode];

/** Symbolic names used in TS for operations. */
export const OpKindToCode = {
  set: Opcode.SET,
  inc: Opcode.INC,
  append: Opcode.APPEND,
  insert: Opcode.INSERT,
  remove: Opcode.REMOVE,
  move: Opcode.MOVE,
  patch: Opcode.PATCH,
  clear: Opcode.CLEAR,
  replace: Opcode.REPLACE,
} as const;

export type OpKind = keyof typeof OpKindToCode;

export const CodeToOpKind: Record<number, OpKind> = Object.fromEntries(
  Object.entries(OpKindToCode).map(([k, v]) => [v, k as OpKind]),
) as Record<number, OpKind>;

/** Session-level frame types (section 31.2). */
export const FrameType = {
  HELLO: 0x01,
  WELCOME: 0x02,
  SCHEMA: 0x03,
  QUERY: 0x10,
  SNAPSHOT: 0x11,
  OPS: 0x12,
  ACK: 0x13,
  RESYNC: 0x14,
  MUTATION: 0x20,
  MUTATION_RESULT: 0x21,
  PING: 0x30,
  ERROR: 0x7f,
} as const;

export type FrameTypeValue = (typeof FrameType)[keyof typeof FrameType];
