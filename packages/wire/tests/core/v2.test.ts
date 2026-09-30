import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AddressBook,
  SchemaCodec,
  encodeOpsFrame,
  decodeOpsFrame,
  peekFrameType,
  FrameType,
  type OpsMsg,
  type Schema,
} from "../../src/core/index.ts";
import { Writer, Reader } from "@raptorstack/wire/codec";

// --- Reactive Address Space (5.2) -----------------------------------------
test("RAS: ops over addresses, the handle name sent only once", () => {
  const serverBook = new AddressBook();
  const clientBook = new AddressBook();

  const frame1: OpsMsg = {
    type: "ops",
    queryId: 1,
    sequence: 1,
    batch: {
      baseVersion: 0,
      resultVersion: 1,
      ops: [{ kind: "replace", handle: "BTC.price", value: 67231.45 }],
    },
  };
  const bytes1 = encodeOpsFrame(serverBook, frame1);
  assert.equal(peekFrameType(bytes1), FrameType.OPS);
  // The first frame contains the name "BTC.price" (introducing the address).
  assert.ok(bytesContain(bytes1, "BTC.price"));
  const decoded1 = decodeOpsFrame(clientBook, bytes1);
  assert.deepEqual(decoded1.batch.ops[0], { kind: "replace", handle: "BTC.price", value: 67231.45 });

  // The second update on the same handle: NO name on the wire (address only).
  const frame2: OpsMsg = {
    type: "ops",
    queryId: 1,
    sequence: 2,
    batch: {
      baseVersion: 1,
      resultVersion: 2,
      ops: [{ kind: "replace", handle: "BTC.price", value: 67240.0 }],
    },
  };
  const bytes2 = encodeOpsFrame(serverBook, frame2);
  assert.ok(!bytesContain(bytes2, "BTC.price"), "the name no longer appears after negotiation");
  const decoded2 = decodeOpsFrame(clientBook, bytes2);
  assert.deepEqual(decoded2.batch.ops[0], { kind: "replace", handle: "BTC.price", value: 67240.0 });
  // Steady-state frame much smaller than the initial one.
  assert.ok(bytes2.length < bytes1.length);
});

test("RAS: atomic and transactionId are preserved through the frame", () => {
  const sb = new AddressBook();
  const cb = new AddressBook();
  const msg: OpsMsg = {
    type: "ops",
    queryId: 3,
    sequence: 7,
    batch: {
      transactionId: 42,
      baseVersion: 5,
      resultVersion: 6,
      atomic: true,
      ops: [
        { kind: "set", handle: "u:1", field: "a", value: 1 },
        { kind: "inc", handle: "u:1", field: "b", delta: 2 },
      ],
    },
  };
  const decoded = decodeOpsFrame(cb, encodeOpsFrame(sb, msg));
  assert.equal(decoded.batch.atomic, true);
  assert.equal(decoded.batch.transactionId, 42);
  assert.equal(decoded.sequence, 7);
  assert.equal(decoded.batch.ops.length, 2);
});

// --- Adaptive encoding (13.2) ---------------------------------------------
test("adaptive encoding: percentage in one byte vs float64 in 8", () => {
  const schema: Schema = { cpu: { type: "percentage" } };
  const codec = new SchemaCodec(schema);
  const w = new Writer();
  codec.encode(w, "cpu", 47);
  assert.equal(w.length, 1, "percentage takes 1 byte");
  const value = codec.decode(new Reader(w.finish()), "cpu");
  assert.equal(value, 47);

  // The generic baseline (value.ts) would use tag + zigzag/float.
  const genericFloat = new Writer();
  genericFloat.float64(47);
  assert.ok(w.length < genericFloat.length);
});

test("adaptive encoding: money as a scaled integer", () => {
  const codec = new SchemaCodec({ price: { type: "money", scale: 2 } });
  const w = new Writer();
  codec.encode(w, "price", 1532.45);
  const value = codec.decode(new Reader(w.finish()), "price");
  assert.equal(value, 1532.45);
});

test("adaptive encoding: small enum as an index", () => {
  const codec = new SchemaCodec({ status: { type: "enum", values: ["sent", "delivered", "read"] } });
  const w = new Writer();
  codec.encode(w, "status", "delivered");
  assert.equal(w.length, 1);
  assert.equal(codec.decode(new Reader(w.finish()), "status"), "delivered");
});

test("adaptive encoding: int with a range uses a uint8 offset", () => {
  const codec = new SchemaCodec({ temp: { type: "int", min: -40, max: 125 } });
  const w = new Writer();
  codec.encode(w, "temp", -10);
  assert.equal(w.length, 1);
  assert.equal(codec.decode(new Reader(w.finish()), "temp"), -10);
});

function bytesContain(bytes: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}
