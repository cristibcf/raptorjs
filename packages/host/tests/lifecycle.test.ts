import test from "node:test";
import assert from "node:assert/strict";
import { LIFECYCLE_STATES, canTransition, createLifecycle } from "../src/index.ts";

test("drumul normal al unei aplicatii trece prin toate starile de lucru", () => {
  const lifecycle = createLifecycle();
  assert.equal(lifecycle.state, "launching");
  lifecycle.to("ready");
  lifecycle.to("foreground");
  lifecycle.to("background");
  lifecycle.to("foreground");
  lifecycle.to("stopped");
  assert.deepEqual(lifecycle.history, ["launching", "ready", "foreground", "background", "foreground", "stopped"]);
});

test("un telefon poate suspenda si relua fara sa inchida aplicatia", () => {
  const lifecycle = createLifecycle();
  lifecycle.to("ready");
  lifecycle.to("foreground");
  lifecycle.to("background");
  lifecycle.to("suspended");
  assert.equal(lifecycle.to("foreground"), "foreground", "reluarea din suspendare este legala");
});

test("sariturile ilegale sunt erori de host, nu stari noi", () => {
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
  assert.equal(lifecycle.state, "launching", "o tranzitie refuzata nu schimba starea");
  assert.equal(canTransition("launching", "foreground"), false);
  assert.equal(canTransition("launching", "ready"), true);
});

test("din 'stopped' nu mai exista iesire", () => {
  const lifecycle = createLifecycle("stopped");
  for (const state of LIFECYCLE_STATES) {
    if (state === "stopped") continue;
    assert.equal(canTransition("stopped", state), false, `stopped -> ${state} nu are voie sa existe`);
  }
  assert.throws(() => lifecycle.to("ready"));
});

test("orice stare de lucru poate fi oprita direct", () => {
  for (const state of LIFECYCLE_STATES) {
    if (state === "stopped") continue;
    assert.equal(canTransition(state, "stopped"), true, `${state} trebuie sa poata fi oprita`);
  }
});

test("settle este idempotent si nu anunta o schimbare care nu s-a petrecut", () => {
  const lifecycle = createLifecycle();
  const changes: string[] = [];
  lifecycle.onChange((state, reason) => changes.push(`${state}:${reason}`));

  assert.equal(lifecycle.settle("ready", "pornire"), true);
  assert.equal(lifecycle.settle("ready", "pornire"), false);
  assert.deepEqual(changes, ["ready:pornire"]);
});

test("masina ramane corecta si destructurata din obiect", () => {
  const lifecycle = createLifecycle();
  const { settle } = lifecycle;
  assert.equal(settle("ready"), true);
  assert.equal(lifecycle.state, "ready");
});
