/**
 * Demo RaptorTest: descopera autonom bug-uri intr-un cart CRUD, fara scenarii
 * scrise manual. Ruleaza ciclul observe -> infer -> explore -> verify -> replay.
 *
 *   node examples/raptortest-crud/src/demo.ts
 */
import { RaptorTest, serializeCapsule } from "@raptor/test";
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

// 1. Descoperire autonoma de secvente (BFS ghidat de coverage).
const sequences = rt.discover();
console.log(`Secvente de actiuni descoperite autonom: ${sequences.length}`);
console.log(`Stari UI: ${rt.coverage.count("uiStates")}, tranzitii: ${rt.coverage.count("transitions")}, API: ${rt.coverage.count("apiInteractions")}\n`);

// 2. Explorare + chaos + oracle -> capsule.
const findings = rt.explore();
console.log(`Defecte gasite: ${findings.length}\n`);

for (const finding of findings) {
  const c = finding.capsule;
  console.log(`BUG ${c.id}  [oracle: ${c.failedOracle}]`);
  console.log(`  schedule       : ${finding.scheduleLabel}`);
  console.log(`  reproducere min: ${JSON.stringify(c.actionLog)}`);
  console.log(`  detaliu        : ${c.detail}`);

  // 3. Replay determinist al capsulei.
  const replay = rt.replay(c);
  console.log(`  replay reprodus: ${replay.reproduced ? "DA" : "NU"} (UI cart.count=${replay.ui.facts["cart.count"]}, server=${app.twin.db.read("cart", 1)?.count})\n`);
}

// 4. Un artefact executabil (.raptorcap) pentru primul bug.
if (findings.length > 0) {
  console.log("--- capsula .raptorcap (extras) ---");
  console.log(serializeCapsule(findings[0]!.capsule).split("\n").slice(0, 12).join("\n"));
}

console.log("\nCoverage final:", JSON.stringify(rt.coverage.report()));
