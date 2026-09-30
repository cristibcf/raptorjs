import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, stats, resetStats } from "@raptorstack/raptorjs/dom/testing";
import { createLoopback, flushLoopback, RaptorClient } from "@raptorstack/wire/client";
import { buildDashboardApp, DASHBOARD_QUERY } from "../src/app.ts";
import { renderDashboard } from "../src/view.ts";

installMiniDom();
const doc = (globalThis as any).document;

// --- Automatic delta resync (v0.2, 14.3) ----------------------------------
test("reconnect recovers state through delta, WITHOUT full resend", async () => {
  const app = buildDashboardApp();
  const link1 = createLoopback();
  app.serve(link1.server);
  const client = new RaptorClient(link1.client);
  await client.connect();
  client.subscribe(DASHBOARD_QUERY);
  await flushLoopback();

  assert.equal(client.snapshotsReceived, 1);
  const versionAtDisconnect = client.version;

  // Simulate offline: close the connection.
  client.close();

  // The server makes changes while the client is offline (lost on the dead link).
  app.store.setSignal("cpu", 88);
  app.store.patch("job:2", { progress: 99 });

  // Reconnect on a new transport: resume requests only the delta from the known version.
  const link2 = createLoopback();
  app.serve(link2.server);
  await client.resume(link2.client, DASHBOARD_QUERY);
  await flushLoopback();

  assert.equal(client.snapshotsReceived, 1, "no new snapshot on reconnect (zero full resend)");
  assert.ok(client.opsFramesReceived >= 1, "state arrived through delta ops");
  assert.equal(client.signal("cpu")(), 88, "the lost value was recovered through delta");
  assert.equal((client.signal("job:2")() as any).progress, 99);
  assert.ok(client.version >= versionAtDisconnect);
});

// --- Network transaction / single DOM commit (v0.2, 16.1) -----------------
test("atomic frame with 2 ops on the same binding -> a SINGLE UI commit", async () => {
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
  // Two writes to cpu within a single atomic transaction.
  app.store.transaction(() => {
    app.store.setSignal("cpu", 1);
    app.store.setSignal("cpu", 2);
  });
  await flushLoopback();

  assert.match(root.querySelector("main").toHTML(), /CPU: 2%/);
  assert.equal(stats.textUpdate, 1, "intermediate states coalesce into a single commit");
});

// --- RAS on the wire: field names negotiated only once (25.2) -------------
test("steady-state: the second tick is smaller (names negotiated, only addresses)", async () => {
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

  assert.ok(tick2 < tick1, `tick2 (${tick2}B) < tick1 (${tick1}B) after address negotiation`);
});
