/**
 * @raptor/wire-codec - primitive de codec pentru RaptorWire.
 *
 * Encoding-uri (whitepaper sectiunea 12):
 *  - unsigned int  -> varint (LEB128)
 *  - signed int    -> zig-zag + varint
 *  - float64       -> IEEE fixed width (little-endian)
 *  - string        -> UTF-8 length-prefixed
 *  - bytes         -> length-prefixed raw
 *
 * Fara base64, fara nume de campuri repetate: acelea sunt in schema.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** Scriitor binar cu buffer care creste automat. */
export class Writer {
  private buffer: Uint8Array;
  private view: DataView;
  private offset = 0;

  constructor(initialCapacity = 64) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
  }

  private ensure(extra: number): void {
    const needed = this.offset + extra;
    if (needed <= this.buffer.length) return;
    let capacity = this.buffer.length * 2;
    while (capacity < needed) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.buffer);
    this.buffer = next;
    this.view = new DataView(this.buffer.buffer);
  }

  u8(value: number): this {
    this.ensure(1);
    this.buffer[this.offset++] = value & 0xff;
    return this;
  }

  bool(value: boolean): this {
    return this.u8(value ? 1 : 0);
  }

  /** varint LEB128 pentru intregi non-negativi (pana la 2^53-1). */
  varint(value: number): this {
    if (value < 0 || !Number.isInteger(value) || value > MAX_SAFE) {
      throw new RangeError(`[codec] varint invalid: ${value}`);
    }
    let v = value;
    this.ensure(8);
    while (v >= 0x80) {
      this.buffer[this.offset++] = (v & 0x7f) | 0x80;
      v = Math.floor(v / 128);
    }
    this.buffer[this.offset++] = v;
    return this;
  }

  /** intreg cu semn via zig-zag + varint. */
  zigzag(value: number): this {
    const encoded = value >= 0 ? value * 2 : -value * 2 - 1;
    return this.varint(encoded);
  }

  float64(value: number): this {
    this.ensure(8);
    this.view.setFloat64(this.offset, value, true);
    this.offset += 8;
    return this;
  }

  bytes(data: Uint8Array): this {
    this.varint(data.length);
    this.ensure(data.length);
    this.buffer.set(data, this.offset);
    this.offset += data.length;
    return this;
  }

  string(value: string): this {
    return this.bytes(textEncoder.encode(value));
  }

  /** Snapshot al octetilor scrisi (copie). */
  finish(): Uint8Array {
    return this.buffer.slice(0, this.offset);
  }

  get length(): number {
    return this.offset;
  }
}

/** Cititor binar pereche pentru Writer. */
export class Reader {
  private readonly data: Uint8Array;
  private view: DataView;
  private offset = 0;

  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  get position(): number {
    return this.offset;
  }

  private check(n: number): void {
    if (this.offset + n > this.data.length) {
      throw new RangeError("[codec] citire dincolo de sfarsitul buffer-ului");
    }
  }

  u8(): number {
    this.check(1);
    return this.data[this.offset++]!;
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  varint(): number {
    let result = 0;
    let shift = 1;
    for (let i = 0; i < 8; i++) {
      this.check(1);
      const byte = this.data[this.offset++]!;
      result += (byte & 0x7f) * shift;
      if ((byte & 0x80) === 0) return result;
      shift *= 128;
    }
    throw new RangeError("[codec] varint prea lung");
  }

  zigzag(): number {
    const u = this.varint();
    return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
  }

  float64(): number {
    this.check(8);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  bytes(): Uint8Array {
    const len = this.varint();
    this.check(len);
    const out = this.data.subarray(this.offset, this.offset + len);
    this.offset += len;
    return out;
  }

  string(): string {
    return textDecoder.decode(this.bytes());
  }
}
