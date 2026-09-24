/**
 * Teste pentru transportul WebSocket: un server HTTP real, clienti reali peste
 * globalul `WebSocket`, deci handshake-ul, framing-ul si mask-ul chiar se executa
 * - nu loopback in-memory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { raptorServer, serveOverWebSocket, type RaptorServer } from "../src/index.ts";
import { RaptorClient, connectWebSocket } from "@raptor/wire-client";

const QUERY = "todos";
const PREFIXES = ["order", "todo:"];

/** Acelasi app ca in examples/todo-realtime, redus la ce testam aici. */
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
    // Ordinea conteaza: socket-urile upgradate nu mai sunt ale serverului HTTP.
    ws.close();
    http.close();
  }
}

/** Asteapta pana cand `check` devine adevarat sau expira - retea, nu microtask-uri. */
async function until(check: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timeout asteptand: ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function connect(url: string, build: string): Promise<RaptorClient> {
  const client = new RaptorClient(await connectWebSocket(url), { build });
  await client.connect();
  client.subscribe(QUERY);
  return client;
}

test("WebSocket: handshake, subscribe si snapshot ajung la client", async () => {
  await withServer(async (url, app) => {
    app.store.transaction(() => {
      app.store.setField("todo:seed", "text", "exista de la inceput");
      app.store.append("order", "seed");
    });

    const client = await connect(url, "a");
    await until(() => client.snapshotsReceived > 0, "snapshot");
    assert.deepEqual(client.signal("order")(), ["seed"]);
    assert.equal((client.signal("todo:seed")() as { text: string }).text, "exista de la inceput");
    client.close();
  });
});

test("WebSocket: mutatia unui client ajunge la celalalt ca operatii", async () => {
  await withServer(async (url) => {
    const ana = await connect(url, "ana");
    const bob = await connect(url, "bob");
    await until(() => ana.snapshotsReceived > 0 && bob.snapshotsReceived > 0, "ambele snapshot-uri");

    const added = await ana.mutate("add", { text: "cumpara lapte" });
    assert.equal(added.ok, true);
    const id = (added.value as { id: number }).id;

    // Bob nu a cerut nimic: primeste un frame OPS, nu un snapshot nou.
    await until(() => bob.opsFramesReceived > 0, "ops la bob");
    assert.deepEqual(bob.signal("order")(), [id]);
    assert.equal((bob.signal(`todo:${id}`)() as { text: string }).text, "cumpara lapte");
    assert.equal(bob.snapshotsReceived, 1, "starea vine ca delta, nu ca re-trimitere completa");

    // Si invers: Bob bifeaza, Ana vede.
    await bob.mutate("toggle", { id });
    await until(() => (ana.signal(`todo:${id}`)() as { done: boolean })?.done === true, "toggle la ana");

    ana.close();
    bob.close();
  });
});

test("WebSocket: dupa reconectare, resume cere doar delta", async () => {
  await withServer(async (url) => {
    const client = await connect(url, "reconnect");
    await until(() => client.snapshotsReceived > 0, "snapshot initial");

    const first = await client.mutate("add", { text: "inainte de cadere" });
    const firstId = (first.value as { id: number }).id;
    await until(() => (client.signal("order")() as number[])?.length === 1, "primul todo");
    const snapshotsBefore = client.snapshotsReceived;

    // Cade conexiunea; un alt client scrie cat timp suntem offline.
    client.close();
    const other = await connect(url, "other");
    await until(() => other.snapshotsReceived > 0, "snapshot other");
    await other.mutate("add", { text: "cat timp eram offline" });
    await until(() => (other.signal("order")() as number[])?.length === 2, "al doilea todo");

    // Reconectare: replica veche se pastreaza, se cere doar ce s-a schimbat.
    await client.resume(await connectWebSocket(url), QUERY);
    await until(() => (client.signal("order")() as number[])?.length === 2, "convergenta dupa resume");

    const order = client.signal("order")() as number[];
    assert.equal(order[0], firstId, "ce stia clientul inainte nu s-a pierdut");
    assert.equal(order.length, 2, "a prins si ce s-a scris cat era deconectat");
    assert.equal(client.snapshotsReceived, snapshotsBefore, "resync incremental: niciun snapshot nou");

    client.close();
    other.close();
  });
});

test("WebSocket: o conexiune inchisa nu mai primeste broadcast", async () => {
  await withServer(async (url, app) => {
    const ana = await connect(url, "ana");
    const bob = await connect(url, "bob");
    await until(() => ana.snapshotsReceived > 0 && bob.snapshotsReceived > 0, "snapshot-uri");

    bob.close();
    await until(() => app.store.subscriptionCount === 1, "subscriptia lui bob a fost curatata");

    // Serverul nu trebuie sa arunce scriind catre socket-ul mort.
    const res = await ana.mutate("add", { text: "dupa plecarea lui bob" });
    assert.equal(res.ok, true);
    ana.close();
  });
});
