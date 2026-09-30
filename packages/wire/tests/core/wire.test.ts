import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Document,
  encodeOp,
  decodeOp,
  encodeOpsBatch,
  decodeOpsBatch,
  encodeMessage,
  decodeMessage,
  type Operation,
  type OpsBatch,
} from "../../src/core/index.ts";
import { Writer, Reader } from "@raptor/wire/codec";

function roundtripOp(op: Operation): Operation {
  const w = new Writer();
  encodeOp(w, op);
  return decodeOp(new Reader(w.finish()));
}

test("roundtrip for all opcodes", () => {
  const ops: Operation[] = [
    { kind: "set", handle: "user:42", field: "name", value: "Cristian" },
    { kind: "inc", handle: "user:42", field: "score", delta: 1 },
    { kind: "append", handle: "messages", value: { id: 1, text: "hi" } },
    { kind: "insert", handle: "list:9", index: 2, value: "x" },
    { kind: "remove", handle: "list:9", index: 3 },
    { kind: "move", handle: "list:9", from: 5, to: 1 },
    { kind: "patch", handle: "obj:17", fields: { name: "a", active: true } },
    { kind: "clear", handle: "notifications" },
    { kind: "replace", handle: "list:9", value: [1, 2, 3] },
  ];
  for (const op of ops) {
    assert.deepEqual(roundtripOp(op), op);
  }
});

test("Document: SET / INC on a field (the example from whitepaper 13)", () => {
  const doc = new Document();
  doc.apply({ kind: "set", handle: "object:17", field: "score", value: 920 });
  assert.equal((doc.get("object:17") as any).score, 920);
  const change = doc.apply({ kind: "inc", handle: "object:17", field: "score", delta: 1 });
  assert.equal((doc.get("object:17") as any).score, 921);
  assert.deepEqual(change.fields, ["score"]);
  assert.equal(change.list, false);
});

test("Document: collection operations", () => {
  const doc = new Document();
  doc.apply({ kind: "append", handle: "list", value: "a" });
  doc.apply({ kind: "append", handle: "list", value: "b" });
  doc.apply({ kind: "append", handle: "list", value: "c" });
  doc.apply({ kind: "insert", handle: "list", index: 1, value: "X" });
  assert.deepEqual(doc.get("list"), ["a", "X", "b", "c"]);
  doc.apply({ kind: "remove", handle: "list", index: 0 });
  assert.deepEqual(doc.get("list"), ["X", "b", "c"]);
  doc.apply({ kind: "move", handle: "list", from: 2, to: 0 });
  assert.deepEqual(doc.get("list"), ["c", "X", "b"]);
  doc.apply({ kind: "clear", handle: "list" });
  assert.deepEqual(doc.get("list"), []);
});

test("Document: PATCH and REPLACE", () => {
  const doc = new Document();
  doc.apply({ kind: "patch", handle: "obj", fields: { a: 1, b: 2 } });
  assert.deepEqual(doc.get("obj"), { a: 1, b: 2 });
  doc.apply({ kind: "replace", handle: "obj", value: { c: 3 } });
  assert.deepEqual(doc.get("obj"), { c: 3 });
});

test("versioned batch roundtrip + apply", () => {
  const batch: OpsBatch = {
    transactionId: 7,
    baseVersion: 10,
    resultVersion: 11,
    atomic: true,
    ops: [
      { kind: "inc", handle: "u:1", field: "score", delta: 5 },
      { kind: "set", handle: "u:1", field: "name", value: "Ana" },
    ],
  };
  const w = new Writer();
  encodeOpsBatch(w, batch);
  const decoded = decodeOpsBatch(new Reader(w.finish()));
  assert.deepEqual(decoded, batch);

  const doc = new Document();
  doc.version = 10;
  doc.applyBatch(decoded);
  assert.equal(doc.version, 11);
  assert.equal((doc.get("u:1") as any).score, 5);
});

test("snapshot roundtrip preserves state and version", () => {
  const doc = new Document();
  doc.version = 3;
  doc.apply({ kind: "set", handle: "cpu", field: "v", value: 42.5 });
  doc.apply({ kind: "append", handle: "jobs", value: { id: 1, name: "build" } });
  const bytes = doc.encodeSnapshot();
  const restored = Document.decodeSnapshot(bytes);
  assert.equal(restored.version, 3);
  assert.deepEqual(restored.get("cpu"), { v: 42.5 });
  assert.deepEqual(restored.get("jobs"), [{ id: 1, name: "build" }]);
});

test("protocol messages roundtrip", () => {
  const msgs = [
    { type: "hello", protocolVersion: 1, clientBuild: "0.1.0", capabilities: ["webtransport", "resume"] },
    { type: "welcome", sessionId: "s1", epoch: 1, serverBuild: "0.1.0" },
    { type: "query", queryId: 1, name: "activeUsers", args: { limit: 100 } },
    { type: "ack", queryId: 1, sequence: 42 },
    { type: "mutation", requestId: 3, name: "renameUser", input: { userId: 42, name: "Cristian" } },
    { type: "mutationResult", requestId: 3, ok: true, value: { userId: 42, name: "Cristian" } },
    { type: "error", code: 7, message: "unauthorized" },
  ] as const;
  for (const msg of msgs) {
    assert.deepEqual(decodeMessage(encodeMessage(msg as any)), msg);
  }
});

test("THESIS: an INC delta is much smaller than re-snapshotting the object", () => {
  // An object with 50 fields; only one changes.
  const bigObject: Record<string, unknown> = {};
  for (let i = 0; i < 50; i++) bigObject[`field${i}`] = `text-value-${i}`;
  bigObject.score = 920;

  // RaptorWire cost: one INC operation on a field.
  const wDelta = new Writer();
  encodeOp(wDelta, { kind: "inc", handle: "object:17", field: "score", delta: 1 });
  const deltaBytes = wDelta.length;

  // "Document re-serialization" cost: the whole object as JSON.
  const jsonBytes = new TextEncoder().encode(JSON.stringify(bigObject)).length;

  assert.ok(deltaBytes < jsonBytes / 10, `delta=${deltaBytes} vs json=${jsonBytes}`);
});

test("idempotency: replaying an INC would double the effect (so dedup is needed)", () => {
  // Documents the contract from section 14.2: INC is not idempotent.
  const doc = new Document();
  const op: Operation = { kind: "inc", handle: "u", field: "n", delta: 1 };
  doc.apply(op);
  doc.apply(op); // accidental replay
  assert.equal((doc.get("u") as any).n, 2); // this is why batches have a transactionId
});
