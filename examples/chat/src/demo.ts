/**
 * Demo chat: doi clienti conectati la acelasi server. O mutatie de la un client
 * se difuzeaza ca operatii catre ambii (stare partajata, whitepaper 26.2).
 *
 *   node examples/chat/src/demo.ts
 */
import { createLoopback, flushLoopback, RaptorClient } from "@raptor/wire-client";
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

console.log("=== RaptorWire chat (stare partajata, 2 clienti) ===\n");

// Ana trimite un mesaj -> ambii clienti il vad (APPEND difuzat).
const sent = await ana.mutate("send", { from: "Ana", text: "Salut Bob!" });
await flushLoopback();
const msgId = (sent.value as { id: number }).id;
console.log("Dupa ce Ana trimite:");
console.log("  Ecranul lui Bob:\n" + renderChat(bob));

// Serverul marcheaza livrat apoi citit (PATCH pe status).
await ana.mutate("setStatus", { id: msgId, status: "delivered" });
await flushLoopback();
await bob.mutate("setStatus", { id: msgId, status: "read" });
await flushLoopback();
console.log("\nDupa delivered + read (PATCH status):");
console.log("  Ecranul lui Ana:\n" + renderChat(ana));

// Bob raspunde.
await bob.mutate("send", { from: "Bob", text: "Salut Ana!" });
await flushLoopback();
console.log("\nDupa raspunsul lui Bob:");
console.log("  Ecranul lui Ana:\n" + renderChat(ana));

// Ana sterge primul mesaj (REMOVE difuzat).
await ana.mutate("deleteMessage", { id: msgId });
await flushLoopback();
console.log("\nDupa ce Ana sterge primul mesaj:");
console.log("  Ecranul lui Bob:\n" + renderChat(bob));

ana.close();
bob.close();
