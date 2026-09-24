/**
 * Testele exemplului. Regulile de business merg pe loopback (rapid, fara
 * porturi); ultimul test porneste serverul adevarat si trece prin exact ce
 * parcurge un cititor al tutorialului: pagina, bundle-ul si doua ferestre care
 * se sincronizeaza peste WebSocket.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoopback, flushLoopback, RaptorClient, connectWebSocket } from "@raptor/wire-client";
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

test("add / toggle / remove modifica starea partajata", async () => {
  const app = buildTodoApp();
  const client = await loopbackClient(app, "solo");

  const added = await client.mutate("add", { text: "cumpara lapte" });
  await flushLoopback();
  const id = (added.value as { id: number }).id;
  assert.deepEqual(orderOf(client), [id]);
  assert.equal(todoOf(client, id)?.text, "cumpara lapte");
  assert.equal(todoOf(client, id)?.done, false);

  await client.mutate("toggle", { id });
  await flushLoopback();
  assert.equal(todoOf(client, id)?.done, true, "toggle intoarce done");

  await client.mutate("remove", { id });
  await flushLoopback();
  assert.deepEqual(orderOf(client), [], "remove scoate id-ul din ordine");
});

test("serverul refuza textul gol, oricat de politicos ar fi clientul", async () => {
  const app = buildTodoApp();
  const client = await loopbackClient(app, "rude");

  const blank = await client.mutate("add", { text: "   " });
  assert.equal(blank.ok, false, "spatiile nu sunt un todo");

  const wrongType = await client.mutate("add", { text: 42 });
  assert.equal(wrongType.ok, false, "authorize respinge alt tip");

  await flushLoopback();
  assert.deepEqual(orderOf(client), [], "nimic nu a intrat in stare");
});

test("doi clienti vad aceeasi lista fara sa o ceara din nou", async () => {
  const app = buildTodoApp();
  const ana = await loopbackClient(app, "ana");
  const bob = await loopbackClient(app, "bob");

  const added = await ana.mutate("add", { text: "plimba cainele" });
  await flushLoopback();
  const id = (added.value as { id: number }).id;

  assert.deepEqual(orderOf(bob), [id], "Bob a primit operatia, nu un snapshot nou");
  assert.equal(bob.snapshotsReceived, 1, "un singur snapshot: cel de la abonare");
  assert.ok(bob.opsFramesReceived > 0, "restul a venit ca delta");

  await bob.mutate("toggle", { id });
  await flushLoopback();
  assert.equal(todoOf(ana, id)?.done, true, "si invers");
});

test("end-to-end: serverul real serveste pagina si sincronizeaza doua ferestre", async () => {
  const server = await startTodoServer(0);
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /bundle\.js/, "index.html a fost rescris catre bundle");

    const bundle = await fetch(base + "/bundle.js");
    assert.equal(bundle.status, 200);
    const code = await bundle.text();
    assert.match(code, /raptor/i, "clientul chiar s-a compilat");

    // Doua "ferestre" pe acelasi URL de wire.
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

    const w1 = await open("fereastra-1");
    const w2 = await open("fereastra-2");
    await until(() => w1.snapshotsReceived > 0 && w2.snapshotsReceived > 0, "snapshot-uri");

    const added = await w1.mutate("add", { text: "scrie tutorialul" });
    const id = (added.value as { id: number }).id;
    await until(() => orderOf(w2).length === 1, "fereastra 2 a primit todo-ul");
    assert.equal(todoOf(w2, id)?.text, "scrie tutorialul");

    await w2.mutate("toggle", { id });
    await until(() => todoOf(w1, id)?.done === true, "fereastra 1 a vazut bifa");

    w1.close();
    w2.close();
  } finally {
    await server.close();
  }
});
