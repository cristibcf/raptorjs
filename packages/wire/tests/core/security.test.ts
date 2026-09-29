import { test } from "node:test";
import assert from "node:assert/strict";
import { Writer, Reader } from "@raptor/wire/codec";
import { readValue, writeValue } from "../../src/core/value.ts";
import { Document } from "../../src/core/index.ts";

/** Construieste manual un OBJECT wire cu o cheie arbitrara. */
function encodeObjectWithKey(key: string, value: unknown): Uint8Array {
  const w = new Writer();
  w.u8(7); // Tag.OBJECT
  w.varint(1);
  w.string(key);
  writeValue(w, value as never);
  return w.finish();
}

test("decodarea unei chei __proto__ NU muteaza prototipul (CWE-1321)", () => {
  const bytes = encodeObjectWithKey("__proto__", { polluted: 1 });
  const decoded = readValue(new Reader(bytes)) as Record<string, unknown>;

  // Proprietate proprie, nu mutatie de prototip.
  assert.deepEqual(Object.getOwnPropertyNames(decoded), ["__proto__"]);
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  // Object.prototype global ramane curat.
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("decodarea unei chei constructor NU corupe obiectul", () => {
  const bytes = encodeObjectWithKey("constructor", "x");
  const decoded = readValue(new Reader(bytes)) as Record<string, unknown>;
  assert.equal(decoded.constructor, "x"); // proprietate proprie
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
});

test("aplicarea unei operatii PATCH cu __proto__ nu polueaza (client state)", () => {
  const doc = new Document();
  doc.apply({ kind: "patch", handle: "u:1", fields: { __proto__: { polluted: 1 } as never, name: "Ana" } });
  const obj = doc.get("u:1") as Record<string, unknown>;
  assert.equal((obj as { name?: string }).name, "Ana");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.getPrototypeOf(obj), Object.prototype);
});

test("SET cu field __proto__ ramane proprietate proprie", () => {
  const doc = new Document();
  doc.apply({ kind: "set", handle: "u:1", field: "__proto__", value: 5 });
  const obj = doc.get("u:1") as Record<string, unknown>;
  assert.equal(Object.getOwnPropertyNames(obj).includes("__proto__"), true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("decoder respinge citirea dincolo de buffer (fail-closed, §21)", () => {
  // ARRAY care pretinde 5 elemente dar bufferul se termina -> eroare, nu OOM.
  const w = new Writer();
  w.u8(6); // Tag.ARRAY
  w.varint(5);
  w.u8(2); // un singur TRUE, apoi buffer gol
  assert.throws(() => readValue(new Reader(w.finish())));
});
