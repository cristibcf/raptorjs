import test from "node:test";
import assert from "node:assert/strict";
import { LIFECYCLE_STATES, canTransition, createLifecycle } from "../../src/core/index.ts";

test("an app's normal path goes through all the working states", () => {
  const lifecycle = createLifecycle();
  assert.equal(lifecycle.state, "launching");
  lifecycle.to("ready");
  lifecycle.to("foreground");
  lifecycle.to("background");
  lifecycle.to("foreground");
  lifecycle.to("stopped");
  assert.deepEqual(lifecycle.history, ["launching", "ready", "foreground", "background", "foreground", "stopped"]);
});

test("a phone can suspend and resume without closing the app", () => {
  const lifecycle = createLifecycle();
  lifecycle.to("ready");
  lifecycle.to("foreground");
  lifecycle.to("background");
  lifecycle.to("suspended");
  assert.equal(lifecycle.to("foreground"), "foreground", "resuming from suspension is legal");
});

test("illegal jumps are host errors, not new states", () => {
  const lifecycle = createLifecycle();
  assert.throws(
    () => lifecycle.to("foreground"),
    (error: unknown) => {
      const hostError = error as { code: string; detail: Record<string, unknown> };
      assert.equal(hostError.code, "raptor:host/lifecycle");
      assert.deepEqual(hostError.detail["allowed"], ["ready", "stopped"]);
      return true;
    },
  );
  assert.equal(lifecycle.state, "launching", "a denied transition does not change the state");
  assert.equal(canTransition("launching", "foreground"), false);
  assert.equal(canTransition("launching", "ready"), true);
});

test("from 'stopped' there is no way out", () => {
  const lifecycle = createLifecycle("stopped");
  for (const state of LIFECYCLE_STATES) {
    if (state === "stopped") continue;
    assert.equal(canTransition("stopped", state), false, `stopped -> ${state} must not be allowed to exist`);
  }
  assert.throws(() => lifecycle.to("ready"));
});

test("any working state can be stopped directly", () => {
  for (const state of LIFECYCLE_STATES) {
    if (state === "stopped") continue;
    assert.equal(canTransition(state, "stopped"), true, `${state} must be stoppable`);
  }
});

test("settle is idempotent and does not announce a change that did not happen", () => {
  const lifecycle = createLifecycle();
  const changes: string[] = [];
  lifecycle.onChange((state, reason) => changes.push(`${state}:${reason}`));

  assert.equal(lifecycle.settle("ready", "startup"), true);
  assert.equal(lifecycle.settle("ready", "startup"), false);
  assert.deepEqual(changes, ["ready:startup"]);
});

test("the machine stays correct even when destructured from the object", () => {
  const lifecycle = createLifecycle();
  const { settle } = lifecycle;
  assert.equal(settle("ready"), true);
  assert.equal(lifecycle.state, "ready");
});
