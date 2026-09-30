import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, stats, resetStats } from "@raptorstack/raptorjs/dom/testing";
import { createLoopback, flushLoopback, RaptorClient } from "@raptorstack/wire/client";
import { buildDashboardApp, DASHBOARD_QUERY } from "../src/app.ts";
import { renderDashboard } from "../src/view.ts";

installMiniDom();
const doc = (globalThis as any).document;

async function setup() {
  const app = buildDashboardApp();
  const link = createLoopback();
  app.serve(link.server);
  const client = new RaptorClient(link.client);
  await client.connect();
  client.subscribe(DASHBOARD_QUERY);
  await flushLoopback();
  return { app, link, client };
}

test("handshake establishes a session", async () => {
  const { client } = await setup();
  assert.ok(client.sessionId.length > 0);
  assert.equal(client.epoch, 1);
});

test("snapshot populates the client's reactive replica", async () => {
  const { client } = await setup();
  assert.equal(client.signal("cpu")(), 12);
  assert.equal(client.signal("memory")(), 40);
  assert.deepEqual(client.signal("jobs")(), [1, 2, 3]);
  assert.deepEqual(client.signal("job:1")(), { name: "build", progress: 10 });
});

test("delta ops update ONLY the affected text node (end-to-end)", async () => {
  const { app, client } = await setup();
  const root = doc.createElement("div");
  renderDashboard(client, doc, root);
  assert.match(root.querySelector("main").toHTML(), /CPU: 12%/);

  resetStats();
  app.store.setSignal("cpu", 99);
  await flushLoopback();

  assert.match(root.querySelector("main").toHTML(), /CPU: 99%/);
  assert.equal(stats.createElement, 0, "no new element");
  assert.equal(stats.textUpdate, 1, "exactly one text update");
});

test("patch on a job touches only its row", async () => {
  const { app, client } = await setup();
  const root = doc.createElement("div");
  renderDashboard(client, doc, root);

  resetStats();
  app.store.patch("job:2", { progress: 77 });
  await flushLoopback();

  assert.match(root.querySelector("ul").toHTML(), /#2 test - 77%/);
  assert.equal(stats.createElement, 0);
  assert.equal(stats.textUpdate, 1); // only row #2
});

test("addJob mutation adds exactly one new row", async () => {
  const { client } = await setup();
  const root = doc.createElement("div");
  renderDashboard(client, doc, root);

  resetStats();
  const res = await client.mutate("addJob", { id: 9, name: "notify" });
  await flushLoopback();

  assert.equal(res.ok, true);
  assert.deepEqual(client.signal("jobs")(), [1, 2, 3, 9]);
  assert.match(root.querySelector("ul").toHTML(), /#9 notify - 0%/);
  assert.equal(stats.createElement, 1, "exactly one new <li>");
});

test("end-to-end THESIS: delta batch << re-sending the document as JSON", async () => {
  const { app, link, client } = await setup();
  const jsonSize = () => {
    const ids = client.signal<number[]>("jobs")() as number[];
    return new TextEncoder().encode(
      JSON.stringify({
        cpu: client.signal("cpu")(),
        memory: client.signal("memory")(),
        jobs: ids.map((id) => client.signal(`job:${id}`)()),
      }),
    ).length;
  };

  const before = link.stats.serverToClientBytes;
  app.store.transaction(() => {
    app.store.setSignal("cpu", 30);
    app.store.patch("job:1", { progress: 50 });
  });
  await flushLoopback();
  const deltaBytes = link.stats.serverToClientBytes - before;

  assert.ok(deltaBytes < jsonSize(), `delta=${deltaBytes} json=${jsonSize()}`);
});

test("sequence numbers increase per subscription", async () => {
  const { app, client } = await setup();
  let gap = false;
  (client as any).onGap = () => (gap = true);
  for (let i = 0; i < 5; i++) {
    app.store.setSignal("cpu", i);
    await flushLoopback();
  }
  assert.equal(gap, false, "no sequence gaps over ordered loopback");
});
