import { test } from "node:test";
import assert from "node:assert/strict";
import { Writer, Reader } from "../src/index.ts";

test("varint roundtrip pentru valori mici si mari", () => {
  const values = [0, 1, 127, 128, 300, 16384, 1_000_000, 2 ** 32, Number.MAX_SAFE_INTEGER];
  const w = new Writer();
  for (const v of values) w.varint(v);
  const r = new Reader(w.finish());
  for (const v of values) assert.equal(r.varint(), v);
  assert.equal(r.remaining, 0);
});

test("varint mic ocupa putini octeti", () => {
  const w = new Writer();
  w.varint(1);
  assert.equal(w.length, 1);
  const w2 = new Writer();
  w2.varint(127);
  assert.equal(w2.length, 1);
  const w3 = new Writer();
  w3.varint(128);
  assert.equal(w3.length, 2);
});

test("zigzag roundtrip cu negative", () => {
  const values = [0, -1, 1, -2, 2, -1000, 1000, -1_000_000, 1_000_000];
  const w = new Writer();
  for (const v of values) w.zigzag(v);
  const r = new Reader(w.finish());
  for (const v of values) assert.equal(r.zigzag(), v);
});

test("zigzag valori mici negative sunt compacte", () => {
  const w = new Writer();
  w.zigzag(-1); // -> 1 -> 1 octet
  assert.equal(w.length, 1);
});

test("float64 roundtrip", () => {
  const values = [0, 1.5, -3.14159, 1532.45, 1e300, -1e-300];
  const w = new Writer();
  for (const v of values) w.float64(v);
  const r = new Reader(w.finish());
  for (const v of values) assert.equal(r.float64(), v);
});

test("string UTF-8 roundtrip", () => {
  const values = ["", "hello", "Cristian", "emoji ok", "diacritice: ăîâșț"];
  const w = new Writer();
  for (const v of values) w.string(v);
  const r = new Reader(w.finish());
  for (const v of values) assert.equal(r.string(), v);
});

test("bytes roundtrip", () => {
  const data = new Uint8Array([1, 2, 3, 250, 0, 255]);
  const w = new Writer();
  w.bytes(data);
  const r = new Reader(w.finish());
  assert.deepEqual([...r.bytes()], [...data]);
});

test("citire dincolo de buffer arunca eroare (fuzz safety)", () => {
  const r = new Reader(new Uint8Array([0x80])); // varint incomplet
  assert.throws(() => r.varint());
});

test("mix de tipuri intr-un singur frame", () => {
  const w = new Writer();
  w.u8(0x12).varint(421).zigzag(-5).string("score").float64(920.5).bool(true);
  const r = new Reader(w.finish());
  assert.equal(r.u8(), 0x12);
  assert.equal(r.varint(), 421);
  assert.equal(r.zigzag(), -5);
  assert.equal(r.string(), "score");
  assert.equal(r.float64(), 920.5);
  assert.equal(r.bool(), true);
});
