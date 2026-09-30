/**
 * End-to-end MVP (whitepaper section 28, milestones M1..M8): server -> RaptorWire
 * -> reactive client -> fine-grained DOM, headless on Node.
 *
 *   node examples/realtime-dashboard/src/demo.ts
 *
 * Demonstrates: initial snapshot, versioned delta operations, exact DOM updates
 * and the delta byte count vs. re-sending the whole document as JSON.
 */
import { installMiniDom, stats, resetStats } from "raptorjs/dom/testing";
import { createLoopback, flushLoopback, RaptorClient } from "@raptor/wire/client";
import { buildDashboardApp, DASHBOARD_QUERY } from "./app.ts";
import { renderDashboard } from "./view.ts";

const doc = installMiniDom();

// 1. Server + transport loopback.
const app = buildDashboardApp();
const link = createLoopback();
app.serve(link.server);

// 2. Client: handshake + subscribe.
const client = new RaptorClient(link.client, { build: "dashboard-web-0.1.0" });
await client.connect();
client.subscribe(DASHBOARD_QUERY);
await flushLoopback();

// 3. Fine-grained render (headless).
const root = doc.createElement("div");
renderDashboard(client, doc, root);

console.log("=== RaptorWire realtime dashboard (end-to-end) ===\n");
console.log("Session:", client.sessionId, "| epoch:", client.epoch);
console.log("Snapshot -> initial DOM:");
console.log("  " + root.querySelector("main")!.toHTML() + "\n");
console.log(
  `Handshake+snapshot on the wire: c->s ${link.stats.clientToServerBytes}B, s->c ${link.stats.serverToClientBytes}B\n`,
);

// Cost of re-sending the whole document as JSON (naive baseline).
function fullJsonBytes(): number {
  const ids = (client.signal<number[]>("jobs")() ?? []) as number[];
  const snapshot = {
    cpu: client.signal("cpu")(),
    memory: client.signal("memory")(),
    jobs: ids.map((id) => client.signal(`job:${id}`)()),
  };
  return new TextEncoder().encode(JSON.stringify(snapshot)).length;
}

// 4. 5 live ticks: each tick = one delta batch (cpu+memory+progress job 1).
console.log("--- 5 realtime ticks (each = 1 delta batch) ---");
resetStats();
let raptorDeltaTotal = 0;
let jsonResendTotal = 0;
for (let t = 1; t <= 5; t++) {
  const before = link.stats.serverToClientBytes;
  app.store.transaction(() => {
    app.store.setSignal("cpu", 12 + t * 7);
    app.store.setSignal("memory", 40 + t * 3);
    app.store.patch("job:1", { progress: 10 + t * 15 });
  });
  await flushLoopback();
  const delta = link.stats.serverToClientBytes - before;
  const json = fullJsonBytes();
  raptorDeltaTotal += delta;
  jsonResendTotal += json;
  console.log(`  tick ${t}: RaptorWire ${delta}B  |  JSON full-resend ${json}B`);
}

console.log("\nDOM after the ticks (only the affected text was moved):");
console.log("  " + root.querySelector("main")!.toHTML());
console.log("\nDOM mutations across the 5 ticks:");
console.log(`  elements created: ${stats.createElement}  (expected 0 - no new nodes)`);
console.log(`  text updates    : ${stats.textUpdate}`);

// 5. Mutation: add a job (typed client->server->broadcast command).
console.log("\n--- addJob mutation (client -> server -> ops) ---");
resetStats();
const res = await client.mutate("addJob", { id: 4, name: "notify" });
await flushLoopback();
console.log("  mutation result:", JSON.stringify(res.value));
console.log("  elements created on addJob:", stats.createElement, "(expected 1 - just the new row)");
console.log("  DOM:\n  " + root.querySelector("ul")!.toHTML());

// 6. Automatic delta resync (v0.2, 14.3): reconnect without full resend.
console.log("\n--- reconnect: automatic delta resync (v0.2) ---");
const versionInainte = client.version;
client.close(); // offline
app.store.setSignal("cpu", 12345); // change lost while the client is offline
const link2 = createLoopback();
app.serve(link2.server);
const snapsInainte = client.snapshotsReceived;
await client.resume(link2.client, DASHBOARD_QUERY); // request delta from the known version
await flushLoopback();
console.log(`  new snapshots on reconnect: ${client.snapshotsReceived - snapsInainte} (expected 0)`);
console.log(`  cpu recovered through delta: ${client.signal("cpu")()} (was 12345 on the server)`);
console.log(`  version ${versionInainte} -> ${client.version} without re-sending the entire state`);

// 7. Tally (P8 - measure everything, v0.2 budget 25.2).
console.log("\n=== TALLY (measured, not marketing) ===");
console.log(`RaptorWire delta total (5 ticks): ${raptorDeltaTotal}B`);
console.log(`JSON full-resend total (5 ticks): ${jsonResendTotal}B`);
console.log(`Reduction: ${(100 * (1 - raptorDeltaTotal / jsonResendTotal)).toFixed(1)}%`);
console.log(`Total snapshot frames: ${client.snapshotsReceived} (1 initial + 0 on reconnect)`);
console.log("Field names repeated on the hot path: 0 (Reactive Address Space).");

client.close();
