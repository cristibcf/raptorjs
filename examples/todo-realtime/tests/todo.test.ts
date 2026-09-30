/**
 * The example's tests. The business rules run over loopback (fast, no ports);
 * the last test starts the real server and goes through exactly what a reader
 * of the tutorial walks through: the page, the bundle and two windows that sync
 * over WebSocket.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoopback, flushLoopback, RaptorClient, connectWebSocket } from "@raptor/wire/client";
import { buildTodoApp, TODO_QUERY, type Todo } from "../src/app.ts";
import { startTodoServer } from "../src/server.ts";

async function loopbackClient(app: ReturnType<typeof buildTodoApp>, build: string): Promise<RaptorClient> {
  const link = createLoopback();
  app.serve(link.server);
  const client = new RaptorClient(link.client, { build });
  await client.connect();
  client.subscribe(TODO_QUERY);
  await flushLoopback();
  return client;
}

const todoOf = (client: RaptorClient, id: number): Todo | undefined =>
  client.signal(`todo:${id}`)() as Todo | undefined;
const orderOf = (client: RaptorClient): number[] => (client.signal<number[]>("order")() ?? []) as number[];

test("add / toggle / remove change the shared state", async () => {
  const app = buildTodoApp();
  const client = await loopbackClient(app, "solo");

  const added = await client.mutate("add", { text: "buy milk" });
  await flushLoopback();
  const id = (added.value as { id: number }).id;
  assert.deepEqual(orderOf(client), [id]);
  assert.equal(todoOf(client, id)?.text, "buy milk");
  assert.equal(todoOf(client, id)?.done, false);

  await client.mutate("toggle", { id });
  await flushLoopback();
  assert.equal(todoOf(client, id)?.done, true, "toggle flips done");

  await client.mutate("remove", { id });
  await flushLoopback();
  assert.deepEqual(orderOf(client), [], "remove drops the id from the order");
});

test("the server rejects empty text, however polite the client is", async () => {
  const app = buildTodoApp();
  const client = await loopbackClient(app, "rude");

  const blank = await client.mutate("add", { text: "   " });
  assert.equal(blank.ok, false, "whitespace is not a todo");

  const wrongType = await client.mutate("add", { text: 42 });
  assert.equal(wrongType.ok, false, "authorize rejects another type");

  await flushLoopback();
  assert.deepEqual(orderOf(client), [], "nothing entered the state");
});

test("two clients see the same list without re-requesting it", async () => {
  const app = buildTodoApp();
  const ana = await loopbackClient(app, "ana");
  const bob = await loopbackClient(app, "bob");

  const added = await ana.mutate("add", { text: "walk the dog" });
  await flushLoopback();
  const id = (added.value as { id: number }).id;

  assert.deepEqual(orderOf(bob), [id], "Bob received the operation, not a new snapshot");
  assert.equal(bob.snapshotsReceived, 1, "a single snapshot: the one from subscribing");
  assert.ok(bob.opsFramesReceived > 0, "the rest arrived as delta");

  await bob.mutate("toggle", { id });
  await flushLoopback();
  assert.equal(todoOf(ana, id)?.done, true, "and the other way around");
});

test("end-to-end: the real server serves the page and syncs two windows", async () => {
  const server = await startTodoServer(0);
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /bundle\.js/, "index.html was rewritten to point at the bundle");

    const bundle = await fetch(base + "/bundle.js");
    assert.equal(bundle.status, 200);
    const code = await bundle.text();
    assert.match(code, /raptor/i, "the client actually compiled");

    // Two "windows" on the same wire URL.
    const url = `ws://127.0.0.1:${server.port}/raptor`;
    const open = async (build: string): Promise<RaptorClient> => {
      const client = new RaptorClient(await connectWebSocket(url), { build });
      await client.connect();
      client.subscribe(TODO_QUERY);
      return client;
    };
    const until = async (check: () => boolean, label: string): Promise<void> => {
      const deadline = Date.now() + 3000;
      while (!check()) {
        if (Date.now() > deadline) throw new Error(`timeout: ${label}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    };

    const w1 = await open("window-1");
    const w2 = await open("window-2");
    await until(() => w1.snapshotsReceived > 0 && w2.snapshotsReceived > 0, "snapshots");

    const added = await w1.mutate("add", { text: "write the tutorial" });
    const id = (added.value as { id: number }).id;
    await until(() => orderOf(w2).length === 1, "window 2 received the todo");
    assert.equal(todoOf(w2, id)?.text, "write the tutorial");

    await w2.mutate("toggle", { id });
    await until(() => todoOf(w1, id)?.done === true, "window 1 saw the check");

    w1.close();
    w2.close();
  } finally {
    await server.close();
  }
});
