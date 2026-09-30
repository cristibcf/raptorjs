/**
 * Schema-based adaptive encoding - whitepaper v0.2 section 13.2.
 *
 * A schema can contain range, scale, cardinality and semantic type; the codec
 * picks the representation with the best bytes/decode trade-off. It is an
 * OPTIONAL optimization: the generic format (value.ts) remains the fallback for
 * types without constraints. This is the target of a schema-generated codec
 * (8.3, 31.4).
 */
import { Writer, Reader } from "@raptorstack/wire/codec";

export interface FieldSchema {
  type: "bool" | "uint" | "int" | "percentage" | "money" | "enum" | "float" | "string";
  /** range for uint/int */
  min?: number;
  max?: number;
  /** decimals for money (scaled integer) */
  scale?: number;
  /** values for a small enum */
  values?: string[];
}

export type Schema = Record<string, FieldSchema>;

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Schema-guided codec for scalar values (per field). */
export class SchemaCodec {
  private readonly schema: Schema;
  constructor(schema: Schema) {
    this.schema = schema;
  }

  encode(w: Writer, field: string, value: unknown): void {
    const s = this.schema[field];
    if (!s) {
      // Fallback: float64 for numbers, string otherwise.
      if (typeof value === "number") w.u8(0).float64(value);
      else w.u8(1).string(String(value));
      return;
    }
    switch (s.type) {
      case "bool":
        w.u8(value ? 1 : 0);
        break;
      case "percentage":
        w.u8(clamp(Math.round(value as number), 0, 100));
        break;
      case "uint": {
        const max = s.max ?? Number.MAX_SAFE_INTEGER;
        const v = value as number;
        if (max <= 0xff) w.u8(v);
        else if (max <= 0xffff) w.u8(v & 0xff).u8((v >> 8) & 0xff);
        else w.varint(v);
        break;
      }
      case "int": {
        const v = value as number;
        if (s.min !== undefined && s.max !== undefined) {
          const range = s.max - s.min;
          if (range <= 0xff) {
            w.u8(v - s.min);
            break;
          }
          if (range <= 0xffff) {
            const off = v - s.min;
            w.u8(off & 0xff).u8((off >> 8) & 0xff);
            break;
          }
        }
        w.zigzag(v);
        break;
      }
      case "money": {
        const scale = s.scale ?? 2;
        w.zigzag(Math.round((value as number) * 10 ** scale));
        break;
      }
      case "enum": {
        const values = s.values ?? [];
        const idx = values.indexOf(String(value));
        const i = idx < 0 ? 0 : idx;
        if (values.length <= 256) w.u8(i);
        else w.varint(i);
        break;
      }
      case "float":
        w.float64(value as number);
        break;
      case "string":
        w.string(String(value));
        break;
    }
  }

  decode(r: Reader, field: string): unknown {
    const s = this.schema[field];
    if (!s) {
      const tag = r.u8();
      return tag === 0 ? r.float64() : r.string();
    }
    switch (s.type) {
      case "bool":
        return r.u8() !== 0;
      case "percentage":
        return r.u8();
      case "uint": {
        const max = s.max ?? Number.MAX_SAFE_INTEGER;
        if (max <= 0xff) return r.u8();
        if (max <= 0xffff) return r.u8() | (r.u8() << 8);
        return r.varint();
      }
      case "int": {
        if (s.min !== undefined && s.max !== undefined) {
          const range = s.max - s.min;
          if (range <= 0xff) return r.u8() + s.min;
          if (range <= 0xffff) return (r.u8() | (r.u8() << 8)) + s.min;
        }
        return r.zigzag();
      }
      case "money": {
        const scale = s.scale ?? 2;
        return r.zigzag() / 10 ** scale;
      }
      case "enum": {
        const values = s.values ?? [];
        const i = values.length <= 256 ? r.u8() : r.varint();
        return values[i];
      }
      case "float":
        return r.float64();
      case "string":
        return r.string();
    }
  }
}
