/**
 * Document versionat RaptorWire - starea autoritativa (server) sau replica
 * (client). Operatiile se aplica peste o stare de baza cunoscuta si produc un
 * `Change` care spune exact ce s-a modificat, ca clientul sa poata notifica
 * doar semnalele afectate (whitepaper 13, 13.1).
 */
import { Writer, Reader } from "@raptor/wire-codec";
import { type WireValue, writeValue, readValue } from "./value.ts";
import { type Operation, type OpsBatch } from "./operation.ts";
import { setOwn } from "./safe.ts";

/** Descrie ce a atins o operatie, pentru reactivitate fina pe client. */
export interface Change {
  handle: string;
  /** Field-uri de obiect atinse (set/inc/patch), altfel null. */
  fields: string[] | null;
  /** true daca o colectie s-a modificat structural. */
  list: boolean;
  /** true daca intreg handle-ul a fost inlocuit/creat/sters. */
  replaced: boolean;
}

function asObject(value: WireValue | undefined): { [k: string]: WireValue } {
  return value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array)
    ? (value as { [k: string]: WireValue })
    : {};
}

function asArray(value: WireValue | undefined): WireValue[] {
  return Array.isArray(value) ? value : [];
}

export class Document {
  private readonly data = new Map<string, WireValue>();
  version = 0;

  get(handle: string): WireValue | undefined {
    return this.data.get(handle);
  }

  set(handle: string, value: WireValue): void {
    this.data.set(handle, value);
  }

  has(handle: string): boolean {
    return this.data.has(handle);
  }

  handles(): string[] {
    return [...this.data.keys()];
  }

  toObject(): Record<string, WireValue> {
    return Object.fromEntries(this.data);
  }

  /** Aplica o singura operatie in loc si intoarce ce s-a schimbat. */
  apply(op: Operation): Change {
    switch (op.kind) {
      case "set": {
        const obj = { ...asObject(this.data.get(op.handle)) };
        setOwn(obj, op.field, op.value);
        this.data.set(op.handle, obj);
        return { handle: op.handle, fields: [op.field], list: false, replaced: false };
      }
      case "inc": {
        const obj = { ...asObject(this.data.get(op.handle)) };
        const prev = typeof obj[op.field] === "number" ? (obj[op.field] as number) : 0;
        setOwn(obj, op.field, prev + op.delta);
        this.data.set(op.handle, obj);
        return { handle: op.handle, fields: [op.field], list: false, replaced: false };
      }
      case "patch": {
        const obj = { ...asObject(this.data.get(op.handle)) };
        for (const key of Object.keys(op.fields)) setOwn(obj, key, op.fields[key] as WireValue);
        this.data.set(op.handle, obj);
        return { handle: op.handle, fields: Object.keys(op.fields), list: false, replaced: false };
      }
      case "append": {
        const arr = asArray(this.data.get(op.handle)).slice();
        arr.push(op.value);
        this.data.set(op.handle, arr);
        return { handle: op.handle, fields: null, list: true, replaced: false };
      }
      case "insert": {
        const arr = asArray(this.data.get(op.handle)).slice();
        const index = clamp(op.index, 0, arr.length);
        arr.splice(index, 0, op.value);
        this.data.set(op.handle, arr);
        return { handle: op.handle, fields: null, list: true, replaced: false };
      }
      case "remove": {
        const arr = asArray(this.data.get(op.handle)).slice();
        if (op.index >= 0 && op.index < arr.length) arr.splice(op.index, 1);
        this.data.set(op.handle, arr);
        return { handle: op.handle, fields: null, list: true, replaced: false };
      }
      case "move": {
        const arr = asArray(this.data.get(op.handle)).slice();
        if (op.from >= 0 && op.from < arr.length) {
          const [item] = arr.splice(op.from, 1);
          arr.splice(clamp(op.to, 0, arr.length), 0, item as WireValue);
        }
        this.data.set(op.handle, arr);
        return { handle: op.handle, fields: null, list: true, replaced: false };
      }
      case "clear": {
        this.data.set(op.handle, []);
        return { handle: op.handle, fields: null, list: true, replaced: false };
      }
      case "replace": {
        this.data.set(op.handle, op.value);
        return { handle: op.handle, fields: null, list: Array.isArray(op.value), replaced: true };
      }
    }
  }

  /** Aplica un batch versionat si seteaza versiunea la resultVersion. */
  applyBatch(batch: OpsBatch): Change[] {
    const changes = batch.ops.map((op) => this.apply(op));
    this.version = batch.resultVersion;
    return changes;
  }

  /** Serializeaza intreaga stare ca snapshot binar (frame SNAPSHOT). */
  encodeSnapshot(): Uint8Array {
    const w = new Writer();
    w.varint(this.version);
    w.varint(this.data.size);
    for (const [handle, value] of this.data) {
      w.string(handle);
      writeValue(w, value);
    }
    return w.finish();
  }

  /** Reconstruieste un document dintr-un snapshot binar. */
  static decodeSnapshot(bytes: Uint8Array): Document {
    const doc = new Document();
    const r = new Reader(bytes);
    doc.version = r.varint();
    const count = r.varint();
    for (let i = 0; i < count; i++) {
      const handle = r.string();
      doc.data.set(handle, readValue(r));
    }
    return doc;
  }
}

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}
