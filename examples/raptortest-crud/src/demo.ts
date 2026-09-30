/**
 * RaptorTest demo: autonomously discovers bugs in a CRUD cart, with no manually
 * written scenarios. Runs the observe -> infer -> explore -> verify -> replay cycle.
 *
 *   node examples/raptortest-crud/src/demo.ts
 */
import { RaptorTest, serializeCapsule } from "@raptorstack/test";
import { buildCartApp } from "./app.ts";

const app = buildCartApp();
const rt = new RaptorTest({
  harness: app.harness,
  twin: app.twin,
  invariants: app.invariants,
  maxDepth: 3,
  buildFingerprint: "cart@demo",
});

console.log("=== RaptorTest - autonomous behavioral testing ===\n");

// 1. Autonomous discovery of sequences (coverage-guided BFS).
const sequences = rt.discover();
console.log(`Action sequences discovered autonomously: ${sequences.length}`);
console.log(`UI states: ${rt.coverage.count("uiStates")}, transitions: ${rt.coverage.count("transitions")}, API: ${rt.coverage.count("apiInteractions")}\n`);

// 2. Explore + chaos + oracle -> capsules.
const findings = rt.explore();
console.log(`Defects found: ${findings.length}\n`);

for (const finding of findings) {
  const c = finding.capsule;
  console.log(`BUG ${c.id}  [oracle: ${c.failedOracle}]`);
  console.log(`  schedule       : ${finding.scheduleLabel}`);
  console.log(`  min repro      : ${JSON.stringify(c.actionLog)}`);
  console.log(`  detail         : ${c.detail}`);

  // 3. Deterministic replay of the capsule.
  const replay = rt.replay(c);
  console.log(`  replay reproduced: ${replay.reproduced ? "YES" : "NO"} (UI cart.count=${replay.ui.facts["cart.count"]}, server=${app.twin.db.read("cart", 1)?.count})\n`);
}

// 4. An executable artifact (.raptorcap) for the first bug.
if (findings.length > 0) {
  console.log("--- .raptorcap capsule (excerpt) ---");
  console.log(serializeCapsule(findings[0]!.capsule).split("\n").slice(0, 12).join("\n"));
}

console.log("\nFinal coverage:", JSON.stringify(rt.coverage.report()));
