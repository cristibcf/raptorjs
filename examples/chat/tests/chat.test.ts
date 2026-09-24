import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoopback, flushLoopback, RaptorClient } from "@raptor/wire-client";
import { buildChatApp, CHAT_QUERY } from "../src/app.ts";

async function connect(app: ReturnType<typeof buildChatApp>): Promise<RaptorClient> {
  const link = createLoopback();
  app.serve(link.server);
  const client = new RaptorClient(link.client);
  await client.connect();
  client.subscribe(CHAT_QUERY);
  await flushLoopback();
  return client;
}

test("send difuzeaza APPEND catre toti clientii", async () => {
  const app = buildChatApp();
  const ana = await connect(app);
  const bob = await connect(app);

  const res = await ana.mutate("send", { from: "Ana", text: "hei" });
  await flushLoopback();
  const id = (res.value as { id: number }).id;

  assert.deepEqual(ana.signal("messages")(), [id]);
  assert.deepEqual(bob.signal("messages")(), [id]);
  assert.deepEqual(bob.signal(`message:${id}`)(), { from: "Ana", text: "hei", status: "sent" });
});

test("setStatus difuzeaza PATCH (sent -> delivered -> read)", async () => {
  const app = buildChatApp();
  const ana = await connect(app);
  const bob = await connect(app);

  const res = await ana.mutate("send", { from: "Ana", text: "x" });
  await flushLoopback();
  const id = (res.value as { id: number }).id;

  await bob.mutate("setStatus", { id, status: "delivered" });
  await flushLoopback();
  assert.equal((ana.signal(`message:${id}`)() as any).status, "delivered");

  await ana.mutate("setStatus", { id, status: "read" });
  await flushLoopback();
  assert.equal((bob.signal(`message:${id}`)() as any).status, "read");
});

test("deleteMessage difuzeaza REMOVE", async () => {
  const app = buildChatApp();
  const ana = await connect(app);
  const bob = await connect(app);

  const a = (await ana.mutate("send", { from: "Ana", text: "1" })).value as { id: number };
  await flushLoopback();
  const b = (await ana.mutate("send", { from: "Ana", text: "2" })).value as { id: number };
  await flushLoopback();
  assert.deepEqual(bob.signal("messages")(), [a.id, b.id]);

  await ana.mutate("deleteMessage", { id: a.id });
  await flushLoopback();
  assert.deepEqual(bob.signal("messages")(), [b.id]);
});
