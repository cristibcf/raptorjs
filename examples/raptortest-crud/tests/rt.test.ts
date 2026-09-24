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

test("baseline: happy-path nu produce false positive", () => {
  const { rt } = newRT();
  // add -> go to cart, sub schedule normal: UI converge cu serverul.
  const res = rt.runScenario(
    ["button:Add to cart:ProductCard", "link:Go to cart:ProductCard"],
    defaultSchedule(),
  );
  assert.equal(res.failure, null);
  assert.equal(res.ui.facts["cart.count"], 1);
});

test("descopera autonom bug-ul stale-read (RT-184)", () => {
  const { rt } = newRT();
  const findings = rt.explore();
  const stale = findings.find((f) => f.scheduleLabel.startsWith("stale-read"));
  assert.ok(stale, "trebuie sa gaseasca bug-ul de stale-read");
  assert.equal(stale!.capsule.failedOracle, "cart-count-converges");
  // Reproducere minima: exact add + go-to-cart (2 actiuni).
  assert.deepEqual(stale!.capsule.actionLog, [
    "button:Add to cart:ProductCard",
    "link:Go to cart:ProductCard",
  ]);
});

test("capsula se reproduce determinist la replay", () => {
  const { rt } = newRT();
  const findings = rt.explore();
  for (const f of findings) {
    const replay = rt.replay(f.capsule);
    assert.equal(replay.reproduced, true, `capsula ${f.capsule.id} trebuie sa se reproduca`);
  }
});

test("oracle prinde divergenta UI vs server sub stale-read", () => {
  const { rt } = newRT();
  const findings = rt.explore();
  const stale = findings.find((f) => f.scheduleLabel.startsWith("stale-read"))!;
  const replay = rt.replay(stale.capsule);
  // UI arata 0, serverul are 1 -> divergenta.
  assert.equal(replay.ui.facts["cart.count"], 0);
});

test("descopera si bug-ul de robustete la fault (POST 500)", () => {
  const { rt } = newRT();
  const findings = rt.explore();
  const fault = findings.find((f) => f.scheduleLabel.startsWith("fault"));
  assert.ok(fault, "citirea oarba a .count dintr-un raspuns de eroare e un defect real");
});

test("coverage este multidimensional si creste prin explorare", () => {
  const { rt } = newRT();
  rt.explore();
  const cov = rt.coverage.report();
  assert.ok(cov.uiStates > 0);
  assert.ok(cov.transitions > 0);
  assert.ok(cov.apiInteractions >= 2); // POST /cart/items + GET /cart
  assert.ok(cov.networkConditions >= 2); // baseline + chaos
});
