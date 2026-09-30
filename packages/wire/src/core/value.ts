/**
 * Tagged value codec for RaptorWire. Generic (CBOR-lite) for the MVP;
 * whitepaper 8.3/31.4 notes that a schema-specialized codec is a later
 * optimization. Integers use zig-zag, everything else uses float64.
 */
import { Writer, Reader } from "@raptor/wire/codec";
import { setOwn } from "./safe.ts";

export type WireValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | WireValue[]
  | { [key: string]: WireValue };

const Tag = {
  NULL: 0,
  FALSE: 1,
  TRUE: 2,
  INT: 3,
  FLOAT: 4,
  STRING: 5,
  ARRAY: 6,
  OBJECT: 7,
  BYTES: 8,
} as const;

export function writeValue(w: Writer, value: WireValue): void {
  if (value === null || value === undefined) {
    w.u8(Tag.NULL);
    return;
  }
  switch (typeof value) {
    case "boolean":
      w.u8(value ? Tag.TRUE : Tag.FALSE);
      return;
    case "number":
      if (Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) {
        w.u8(Tag.INT).zigzag(value);
      } else {
        w.u8(Tag.FLOAT).float64(value);
      }
      return;
    case "string":
      w.u8(Tag.STRING).string(value);
      return;
  }
  if (value instanceof Uint8Array) {
    w.u8(Tag.BYTES).bytes(value);
    return;
  }
  if (Array.isArray(value)) {
    w.u8(Tag.ARRAY).varint(value.length);
    for (const item of value) writeValue(w, item);
    return;
  }
  const keys = Object.keys(value);
  w.u8(Tag.OBJECT).varint(keys.length);
  for (const key of keys) {
    w.string(key);
    writeValue(w, value[key] as WireValue);
  }
}

export function readValue(r: Reader): WireValue {
  const tag = r.u8();
  switch (tag) {
    case Tag.NULL:
      return null;
    case Tag.FALSE:
      return false;
    case Tag.TRUE:
      return true;
    case Tag.INT:
      return r.zigzag();
    case Tag.FLOAT:
      return r.float64();
    case Tag.STRING:
      return r.string();
    case Tag.BYTES:
      return r.bytes().slice();
    case Tag.ARRAY: {
      const len = r.varint();
      const arr: WireValue[] = [];
      for (let i = 0; i < len; i++) arr.push(readValue(r));
      return arr;
    }
    case Tag.OBJECT: {
      const len = r.varint();
      const obj: { [key: string]: WireValue } = {};
      for (let i = 0; i < len; i++) {
        const key = r.string();
        setOwn(obj, key, readValue(r)); // own-property assignment: prevents prototype pollution
      }
      return obj;
    }
    default:
      throw new RangeError(`[wire] unknown value tag: ${tag}`);
  }
}
