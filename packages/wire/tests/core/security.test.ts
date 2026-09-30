import { test } from "node:test";
import assert from "node:assert/strict";
import { Writer, Reader } from "@raptor/wire/codec";
import { readValue, writeValue } from "../../src/core/value.ts";
import { Document } from "../../src/core/index.ts";

/** Manually build a wire OBJECT with an arbitrary key. */
function encodeObjectWithKey(key: string, value: unknown): Uint8Array {
  const w = new Writer();
  w.u8(7); // Tag.OBJECT
  w.varint(1);
  w.string(key);
  writeValue(w, value as never);
  return w.finish();
}

test("decoding a __proto__ key does NOT mutate the prototype (CWE-1321)", () => {
  const bytes = encodeObjectWithKey("__proto__", { polluted: 1 });
  const decoded = readValue(new Reader(bytes)) as Record<string, unknown>;

  // Own property, not a prototype mutation.
  assert.deepEqual(Object.getOwnPropertyNames(decoded), ["__proto__"]);
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  // The global Object.prototype stays clean.
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("decoding a constructor key does NOT corrupt the object", () => {
  const bytes = encodeObjectWithKey("constructor", "x");
  const decoded = readValue(new Reader(bytes)) as Record<string, unknown>;
  assert.equal(decoded.constructor, "x"); // own property
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
});

test("applying a PATCH operation with __proto__ does not pollute (client state)", () => {
  const doc = new Document();
  doc.apply({ kind: "patch", handle: "u:1", fields: { __proto__: { polluted: 1 } as never, name: "Ana" } });
  const obj = doc.get("u:1") as Record<string, unknown>;
  assert.equal((obj as { name?: string }).name, "Ana");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.getPrototypeOf(obj), Object.prototype);
});

test("SET with a __proto__ field stays an own property", () => {
  const doc = new Document();
  doc.apply({ kind: "set", handle: "u:1", field: "__proto__", value: 5 });
  const obj = doc.get("u:1") as Record<string, unknown>;
  assert.equal(Object.getOwnPropertyNames(obj).includes("__proto__"), true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("decoder rejects reading past the buffer (fail-closed, §21)", () => {
  // An ARRAY that claims 5 elements but the buffer ends -> error, not OOM.
  const w = new Writer();
  w.u8(6); // Tag.ARRAY
  w.varint(5);
  w.u8(2); // a single TRUE, then an empty buffer
  assert.throws(() => readValue(new Reader(w.finish())));
});
