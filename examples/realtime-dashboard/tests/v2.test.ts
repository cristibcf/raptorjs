import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, stats, resetStats } from "raptorjs/dom/testing";
import { createLoopback, flushLoopback, RaptorClient } from "@raptor/wire/client";
import { buildDashboardApp, DASHBOARD_QUERY } from "../src/app.ts";
import { renderDashboard } from "../src/view.ts";

installMiniDom();
const doc = (globalThis as any).document;

// --- Automatic delta resync (v0.2, 14.3) ----------------------------------
test("reconnect recupereaza starea prin delta, FARA full resend", async () => {
  const app = buildDashboardApp();
  const link1 = createLoopback();
  app.serve(link1.server);
  const client = new RaptorClient(link1.client);
  await client.connect();
  client.subscribe(DASHBOARD_QUERY);
  await flushLoopback();

  assert.equal(client.snapshotsReceived, 1);
  const versionAtDisconnect = client.version;

  // Simuleaza offline: inchide conexiunea.
  client.close();

  // Serverul face schimbari cat clientul e offline (pierdute pe link-ul mort).
  app.store.setSignal("cpu", 88);
  app.store.patch("job:2", { progress: 99 });

  // Reconnect pe transport nou: resume cere doar delta de la versiunea cunoscuta.
  const link2 = createLoopback();
  app.serve(link2.server);
  await client.resume(link2.client, DASHBOARD_QUERY);
  await flushLoopback();

  assert.equal(client.snapshotsReceived, 1, "niciun snapshot nou la reconnect (zero full resend)");
  assert.ok(client.opsFramesReceived >= 1, "starea a venit prin ops delta");
  assert.equal(client.signal("cpu")(), 88, "valoarea pierduta a fost recuperata prin delta");
  assert.equal((client.signal("job:2")() as any).progress, 99);
  assert.ok(client.version >= versionAtDisconnect);
});

// --- Network transaction / single DOM commit (v0.2, 16.1) -----------------
test("frame atomic cu 2 op-uri pe acelasi binding -> UN singur commit UI", async () => {
  const app = buildDashboardApp();
  const link = createLoopback();
  app.serve(link.server);
  const client = new RaptorClient(link.client);
  await client.connect();
  client.subscribe(DASHBOARD_QUERY);
  await flushLoopback();

  const root = doc.createElement("div");
  renderDashboard(client, doc, root);

  resetStats();
  // Doua scrieri pe cpu intr-o singura tranzactie atomica.
  app.store.transaction(() => {
    app.store.setSignal("cpu", 1);
    app.store.setSignal("cpu", 2);
  });
  await flushLoopback();

  assert.match(root.querySelector("main").toHTML(), /CPU: 2%/);
  assert.equal(stats.textUpdate, 1, "starile intermediare coalesc intr-un singur commit");
});

// --- RAS pe fir: nume de field negociate o singura data (25.2) -------------
test("steady-state: al doilea tick e mai mic (nume negociate, doar adrese)", async () => {
  const app = buildDashboardApp();
  const link = createLoopback();
  app.serve(link.server);
  const client = new RaptorClient(link.client);
  await client.connect();
  client.subscribe(DASHBOARD_QUERY);
  await flushLoopback();

  const before1 = link.stats.serverToClientBytes;
  app.store.transaction(() => {
    app.store.setSignal("cpu", 30);
    app.store.setSignal("memory", 50);
  });
  await flushLoopback();
  const tick1 = link.stats.serverToClientBytes - before1;

  const before2 = link.stats.serverToClientBytes;
  app.store.transaction(() => {
    app.store.setSignal("cpu", 31);
    app.store.setSignal("memory", 51);
  });
  await flushLoopback();
  const tick2 = link.stats.serverToClientBytes - before2;

  assert.ok(tick2 < tick1, `tick2 (${tick2}B) < tick1 (${tick1}B) dupa negociere adrese`);
});
