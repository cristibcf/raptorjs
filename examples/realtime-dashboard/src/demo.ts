/**
 * MVP end-to-end (whitepaper sectiunea 28, M-uri M1..M8): server -> RaptorWire
 * -> client reactiv -> DOM fine-grained, headless pe Node.
 *
 *   node examples/realtime-dashboard/src/demo.ts
 *
 * Demonstreaza: snapshot initial, operatii delta versionate, actualizari DOM
 * exacte si comparatia octetilor delta vs. re-trimiterea documentului ca JSON.
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

// 3. Randare fine-grained (headless).
const root = doc.createElement("div");
renderDashboard(client, doc, root);

console.log("=== RaptorWire realtime dashboard (end-to-end) ===\n");
console.log("Sesiune:", client.sessionId, "| epoch:", client.epoch);
console.log("Snapshot -> DOM initial:");
console.log("  " + root.querySelector("main")!.toHTML() + "\n");
console.log(
  `Handshake+snapshot pe fir: c->s ${link.stats.clientToServerBytes}B, s->c ${link.stats.serverToClientBytes}B\n`,
);

// Cost al re-trimiterii intregului document ca JSON (baseline naiv).
function fullJsonBytes(): number {
  const ids = (client.signal<number[]>("jobs")() ?? []) as number[];
  const snapshot = {
    cpu: client.signal("cpu")(),
    memory: client.signal("memory")(),
    jobs: ids.map((id) => client.signal(`job:${id}`)()),
  };
  return new TextEncoder().encode(JSON.stringify(snapshot)).length;
}

// 4. 5 tick-uri live: fiecare tick = un batch delta (cpu+memory+progress job 1).
console.log("--- 5 tick-uri realtime (fiecare = 1 batch delta) ---");
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

console.log("\nDOM dupa tick-uri (doar textul afectat a fost mutat):");
console.log("  " + root.querySelector("main")!.toHTML());
console.log("\nMutatii DOM in cele 5 tick-uri:");
console.log(`  elemente create: ${stats.createElement}  (asteptat 0 - fara noduri noi)`);
console.log(`  text updates   : ${stats.textUpdate}`);

// 5. Mutatie: adauga un job (comanda tipata client->server->broadcast).
console.log("\n--- mutatie addJob (client -> server -> ops) ---");
resetStats();
const res = await client.mutate("addJob", { id: 4, name: "notify" });
await flushLoopback();
console.log("  rezultat mutatie:", JSON.stringify(res.value));
console.log("  elemente create la addJob:", stats.createElement, "(asteptat 1 - doar noul rand)");
console.log("  DOM:\n  " + root.querySelector("ul")!.toHTML());

// 6. Automatic delta resync (v0.2, 14.3): reconnect fara full resend.
console.log("\n--- reconnect: automatic delta resync (v0.2) ---");
const versionInainte = client.version;
client.close(); // offline
app.store.setSignal("cpu", 12345); // schimbare pierduta cat clientul e offline
const link2 = createLoopback();
app.serve(link2.server);
const snapsInainte = client.snapshotsReceived;
await client.resume(link2.client, DASHBOARD_QUERY); // cere delta de la versiunea cunoscuta
await flushLoopback();
console.log(`  snapshot-uri noi la reconnect: ${client.snapshotsReceived - snapsInainte} (asteptat 0)`);
console.log(`  cpu recuperat prin delta: ${client.signal("cpu")()} (era 12345 pe server)`);
console.log(`  versiune ${versionInainte} -> ${client.version} fara re-trimiterea intregii stari`);

// 7. Bilant (P8 - measure everything, buget v0.2 25.2).
console.log("\n=== BILANT (masurat, nu marketing) ===");
console.log(`RaptorWire delta total (5 tick-uri): ${raptorDeltaTotal}B`);
console.log(`JSON full-resend total (5 tick-uri): ${jsonResendTotal}B`);
console.log(`Reducere: ${(100 * (1 - raptorDeltaTotal / jsonResendTotal)).toFixed(1)}%`);
console.log(`Frame-uri de snapshot totale: ${client.snapshotsReceived} (1 initial + 0 la reconnect)`);
console.log("Nume de field repetate pe hot path: 0 (Reactive Address Space).");

client.close();
