import { test } from "node:test";
import assert from "node:assert/strict";
import { RaptorTest, defaultSchedule } from "@raptor/test";
import { buildCartApp } from "../src/app.ts";

function newRT() {
  const app = buildCartApp();
  return {
    app,
    rt: new RaptorTest({
      harness: app.harness,
      twin: app.twin,
      invariants: app.invariants,
      maxDepth: 3,
      buildFingerprint: "cart@test",
    }),
  };
}

test("baseline: happy-path produces no false positive", () => {
  const { rt } = newRT();
  // add -> go to cart, under the normal schedule: the UI converges with the server.
  const res = rt.runScenario(
    ["button:Add to cart:ProductCard", "link:Go to cart:ProductCard"],
    defaultSchedule(),
  );
  assert.equal(res.failure, null);
  assert.equal(res.ui.facts["cart.count"], 1);
});

test("autonomously discovers the stale-read bug (RT-184)", () => {
  const { rt } = newRT();
  const findings = rt.explore();
  const stale = findings.find((f) => f.scheduleLabel.startsWith("stale-read"));
  assert.ok(stale, "must find the stale-read bug");
  assert.equal(stale!.capsule.failedOracle, "cart-count-converges");
  // Minimal repro: exactly add + go-to-cart (2 actions).
  assert.deepEqual(stale!.capsule.actionLog, [
    "button:Add to cart:ProductCard",
    "link:Go to cart:ProductCard",
  ]);
});

test("capsule reproduces deterministically on replay", () => {
  const { rt } = newRT();
  const findings = rt.explore();
  for (const f of findings) {
    const replay = rt.replay(f.capsule);
    assert.equal(replay.reproduced, true, `capsule ${f.capsule.id} must reproduce`);
  }
});

test("oracle catches UI vs server divergence under stale-read", () => {
  const { rt } = newRT();
  const findings = rt.explore();
  const stale = findings.find((f) => f.scheduleLabel.startsWith("stale-read"))!;
  const replay = rt.replay(stale.capsule);
  // UI shows 0, the server has 1 -> divergence.
  assert.equal(replay.ui.facts["cart.count"], 0);
});

test("also discovers the fault-robustness bug (POST 500)", () => {
  const { rt } = newRT();
  const findings = rt.explore();
  const fault = findings.find((f) => f.scheduleLabel.startsWith("fault"));
  assert.ok(fault, "blindly reading .count from an error response is a real defect");
});

test("coverage is multidimensional and grows through exploration", () => {
  const { rt } = newRT();
  rt.explore();
  const cov = rt.coverage.report();
  assert.ok(cov.uiStates > 0);
  assert.ok(cov.transitions > 0);
  assert.ok(cov.apiInteractions >= 2); // POST /cart/items + GET /cart
  assert.ok(cov.networkConditions >= 2); // baseline + chaos
});
