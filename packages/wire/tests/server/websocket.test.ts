/**
 * Tests for the WebSocket transport: a real HTTP server, real clients over the
 * global `WebSocket`, so the handshake, framing and mask actually run - not an
 * in-memory loopback.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { raptorServer, serveOverWebSocket, type RaptorServer } from "../../src/server/index.ts";
import { RaptorClient, connectWebSocket } from "@raptor/wire/client";

const QUERY = "todos";
const PREFIXES = ["order", "todo:"];

/** The same app as in examples/todo-realtime, trimmed to what we test here. */
function buildApp(): RaptorServer {
  const app = raptorServer({ build: "ws-test" });
  let counter = 0;
  app.query(QUERY, { select: () => PREFIXES });
  app.mutation("add", {
    run: ({ input, store }) => {
      const { text } = input as { text: string };
      const id = ++counter;
      store.setField(`todo:${id}`, "text", text);
      store.setField(`todo:${id}`, "done", false);
      store.append("order", id);
      return { id };
    },
  });
  app.mutation("toggle", {
    run: ({ input, store }) => {
      const { id } = input as { id: number };
      const current = (store.doc.get(`todo:${id}`) as { done: boolean } | undefined)?.done ?? false;
      store.patch(`todo:${id}`, { done: !current });
      return { id, done: !current };
    },
  });
  return app;
}

async function withServer(run: (url: string, app: RaptorServer) => Promise<void>): Promise<void> {
  const app = buildApp();
  const http: Server = createServer((_req, res) => res.end("ok"));
  const ws = serveOverWebSocket(app, http, { pingIntervalMs: 0 });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const { port } = http.address() as AddressInfo;
  try {
    await run(`ws://127.0.0.1:${port}/raptor`, app);
  } finally {
    // Order matters: upgraded sockets no longer belong to the HTTP server.
    ws.close();
    http.close();
  }
}

/** Wait until `check` becomes true or it times out - network, not microtasks. */
async function until(check: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function connect(url: string, build: string): Promise<RaptorClient> {
  const client = new RaptorClient(await connectWebSocket(url), { build });
  await client.connect();
  client.subscribe(QUERY);
  return client;
}

test("WebSocket: handshake, subscribe and snapshot reach the client", async () => {
  await withServer(async (url, app) => {
    app.store.transaction(() => {
      app.store.setField("todo:seed", "text", "exists from the start");
      app.store.append("order", "seed");
    });

    const client = await connect(url, "a");
    await until(() => client.snapshotsReceived > 0, "snapshot");
    assert.deepEqual(client.signal("order")(), ["seed"]);
    assert.equal((client.signal("todo:seed")() as { text: string }).text, "exists from the start");
    client.close();
  });
});

test("WebSocket: one client's mutation reaches the other as operations", async () => {
  await withServer(async (url) => {
    const ana = await connect(url, "ana");
    const bob = await connect(url, "bob");
    await until(() => ana.snapshotsReceived > 0 && bob.snapshotsReceived > 0, "both snapshots");

    const added = await ana.mutate("add", { text: "buy milk" });
    assert.equal(added.ok, true);
    const id = (added.value as { id: number }).id;

    // Bob asked for nothing: he receives an OPS frame, not a new snapshot.
    await until(() => bob.opsFramesReceived > 0, "ops at bob");
    assert.deepEqual(bob.signal("order")(), [id]);
    assert.equal((bob.signal(`todo:${id}`)() as { text: string }).text, "buy milk");
    assert.equal(bob.snapshotsReceived, 1, "the state arrives as a delta, not a full resend");

    // And the reverse: Bob checks it off, Ana sees it.
    await bob.mutate("toggle", { id });
    await until(() => (ana.signal(`todo:${id}`)() as { done: boolean })?.done === true, "toggle at ana");

    ana.close();
    bob.close();
  });
});

test("WebSocket: after reconnecting, resume asks only for the delta", async () => {
  await withServer(async (url) => {
    const client = await connect(url, "reconnect");
    await until(() => client.snapshotsReceived > 0, "initial snapshot");

    const first = await client.mutate("add", { text: "before the drop" });
    const firstId = (first.value as { id: number }).id;
    await until(() => (client.signal("order")() as number[])?.length === 1, "the first todo");
    const snapshotsBefore = client.snapshotsReceived;

    // The connection drops; another client writes while we are offline.
    client.close();
    const other = await connect(url, "other");
    await until(() => other.snapshotsReceived > 0, "snapshot other");
    await other.mutate("add", { text: "while we were offline" });
    await until(() => (other.signal("order")() as number[])?.length === 2, "the second todo");

    // Reconnect: the old replica is kept, only what changed is requested.
    await client.resume(await connectWebSocket(url), QUERY);
    await until(() => (client.signal("order")() as number[])?.length === 2, "convergence after resume");

    const order = client.signal("order")() as number[];
    assert.equal(order[0], firstId, "what the client knew before was not lost");
    assert.equal(order.length, 2, "it also caught what was written while disconnected");
    assert.equal(client.snapshotsReceived, snapshotsBefore, "incremental resync: no new snapshot");

    client.close();
    other.close();
  });
});

test("WebSocket: a closed connection no longer receives broadcasts", async () => {
  await withServer(async (url, app) => {
    const ana = await connect(url, "ana");
    const bob = await connect(url, "bob");
    await until(() => ana.snapshotsReceived > 0 && bob.snapshotsReceived > 0, "snapshots");

    bob.close();
    await until(() => app.store.subscriptionCount === 1, "bob's subscription was cleaned up");

    // The server must not throw writing to the dead socket.
    const res = await ana.mutate("add", { text: "after bob left" });
    assert.equal(res.ok, true);
    ana.close();
  });
});
