/**
 * Opcodes state-aware si tipuri de frame RaptorWire (whitepaper 13 si 31.2).
 * Folosim obiecte `as const` in loc de enum (sintaxa erasabila).
 */

/** Opcodes de operatie asupra starii (sectiunea 13). */
export const Opcode = {
  SET: 0x01, // inlocuieste valoarea unui field
  INC: 0x02, // adauga delta numerica
  APPEND: 0x03, // adauga la sfarsitul unei colectii
  INSERT: 0x04, // insereaza la index
  REMOVE: 0x05, // sterge element la index
  MOVE: 0x06, // reordoneaza fara retransmitere
  PATCH: 0x07, // batch de field updates pe acelasi obiect
  CLEAR: 0x08, // goleste colectia
  REPLACE: 0x09, // snapshot partial/complet cand delta nu merita
} as const;

export type OpcodeValue = (typeof Opcode)[keyof typeof Opcode];

/** Nume simbolice folosite in TS pentru operatii. */
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

/** Tipuri de frame la nivel de sesiune (sectiunea 31.2). */
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
