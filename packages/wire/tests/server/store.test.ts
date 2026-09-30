import { test } from "node:test";
import assert from "node:assert/strict";
import { ReactiveStore } from "../../src/server/index.ts";
import { Document } from "@raptor/wire";

test("snapshotFor: a prefix without a delimiter does NOT expose neighboring handles", () => {
  const store = new ReactiveStore();
  store.setSignal("cpu", 10);
  store.setSignal("cpuSecret", 999); // neighboring handle, must not be exposed
  store.setSignal("memory", 40);

  const snap = Document.decodeSnapshot(store.snapshotFor(["cpu", "memory"]));
  assert.equal(snap.get("cpu"), 10);
  assert.equal(snap.get("memory"), 40);
  assert.equal(snap.has("cpuSecret"), false, "an exact prefix must not catch cpuSecret");
});

test("snapshotFor: a prefix with a delimiter exposes the children", () => {
  const store = new ReactiveStore();
  store.setField("job:1", "name", "build");
  store.setField("job:2", "name", "test");
  store.setSignal("other", 1);

  const snap = Document.decodeSnapshot(store.snapshotFor(["job:"]));
  assert.equal(snap.has("job:1"), true);
  assert.equal(snap.has("job:2"), true);
  assert.equal(snap.has("other"), false);
});

test("resyncSince: delta when the history is continuous, otherwise snapshot", () => {
  const store = new ReactiveStore();
  // Two fake subscriptions are not needed; we test the engine directly.
  store.setSignal("cpu", 1); // version 1
  store.setSignal("cpu", 2); // version 2
  store.setSignal("cpu", 3); // version 3

  const delta = store.resyncSince(1, ["cpu"]);
  assert.equal(delta.mode, "delta");
  if (delta.mode === "delta") {
    assert.equal(delta.toVersion, 3);
    assert.equal(delta.ops.length, 2); // versions 2 and 3
  }

  // sinceVersion 0 -> full snapshot.
  assert.equal(store.resyncSince(0, ["cpu"]).mode, "snapshot");
  // sinceVersion equal to the current version -> empty delta (zero resend).
  const current = store.resyncSince(3, ["cpu"]);
  assert.equal(current.mode, "delta");
  if (current.mode === "delta") assert.equal(current.ops.length, 0);
});
