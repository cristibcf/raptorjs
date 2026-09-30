/**
 * Chat demo: two clients connected to the same server. A mutation from one
 * client is broadcast as operations to both (shared state, whitepaper 26.2).
 *
 *   node examples/chat/src/demo.ts
 */
import { createLoopback, flushLoopback, RaptorClient } from "@raptor/wire/client";
import { buildChatApp, CHAT_QUERY } from "./app.ts";

function renderChat(client: RaptorClient): string {
  const ids = (client.signal<number[]>("messages")() ?? []) as number[];
  return ids
    .map((id) => {
      const m = client.signal<{ from: string; text: string; status: string }>(`message:${id}`)() as any;
      return `    [${m.status}] ${m.from}: ${m.text}`;
    })
    .join("\n");
}

const app = buildChatApp();

async function connectClient(label: string): Promise<RaptorClient> {
  const link = createLoopback();
  app.serve(link.server);
  const client = new RaptorClient(link.client, { build: `chat-${label}` });
  await client.connect();
  client.subscribe(CHAT_QUERY);
  await flushLoopback();
  return client;
}

const ana = await connectClient("ana");
const bob = await connectClient("bob");

console.log("=== RaptorWire chat (shared state, 2 clients) ===\n");

// Ana sends a message -> both clients see it (broadcast APPEND).
const sent = await ana.mutate("send", { from: "Ana", text: "Hi Bob!" });
await flushLoopback();
const msgId = (sent.value as { id: number }).id;
console.log("After Ana sends:");
console.log("  Bob's screen:\n" + renderChat(bob));

// The server marks delivered then read (PATCH on status).
await ana.mutate("setStatus", { id: msgId, status: "delivered" });
await flushLoopback();
await bob.mutate("setStatus", { id: msgId, status: "read" });
await flushLoopback();
console.log("\nAfter delivered + read (PATCH status):");
console.log("  Ana's screen:\n" + renderChat(ana));

// Bob replies.
await bob.mutate("send", { from: "Bob", text: "Hi Ana!" });
await flushLoopback();
console.log("\nAfter Bob's reply:");
console.log("  Ana's screen:\n" + renderChat(ana));

// Ana deletes the first message (broadcast REMOVE).
await ana.mutate("deleteMessage", { id: msgId });
await flushLoopback();
console.log("\nAfter Ana deletes the first message:");
console.log("  Bob's screen:\n" + renderChat(bob));

ana.close();
bob.close();
