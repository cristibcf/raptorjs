/**
 * Dropping a subscription (v0.2.1).
 *
 * `addSubscription` had no counterpart: closing the connection was the only
 * way to stop a subscription. On one long-lived socket an application that
 * navigates between screens therefore kept every subscription it had ever
 * opened, and `broadcast` walked all of them on every mutation - a leak that
 * grows with session length, and the per-user projections added in the same
 * release make per-screen subscriptions the natural thing to write.
 *
 * The three things worth pinning: the server really stops broadcasting, a
 * frame already in flight is not applied by a client that let the subscription
 * go, and an UNSUBSCRIBE for something already gone is not an error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AddressBook,
  Document,
  FrameType,
  decodeMessage,
  decodeOpsFrame,
  encodeMessage,
  encodeOpsFrame,
  peekFrameType,
  type Message,
  type OpsMsg,
  type WireValue,
} from "../../src/core/index.ts";
import { raptorServer, type ServerConnection } from "../../src/server/index.ts";
import { RaptorClient, createLoopback, flushLoopback } from "@raptorstack/wire/client";

interface FakeConn extends ServerConnection {
  deliver(msg: Message): void;
  messages(): Message[];
  opsFrames(): OpsMsg[];
}

function fakeConn(): FakeConn {
  const raw: Uint8Array[] = [];
  const book = new AddressBook();
  let handler: ((data: Uint8Array) => void) | null = null;
  return {
    send: (data) => void raw.push(data.slice()),
    onMessage: (fn) => void (handler = fn),
    close: () => {},
    deliver: (msg) => handler?.(encodeMessage(msg)),
    messages: () => raw.filter((b) => peekFrameType(b) !== FrameType.OPS).map((b) => decodeMessage(b)),
    opsFrames: () => raw.filter((b) => peekFrameType(b) === FrameType.OPS).map((b) => decodeOpsFrame(book, b)),
  };
}

const hello: Message = { type: "hello", protocolVersion: 1, clientBuild: "test", capabilities: [] };
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A SNAPSHOT payload, framed the way the server frames one. */
function snapshotOf(handles: Record<string, WireValue>): Uint8Array {
  const doc = new Document();
  doc.version = 1;
  for (const [handle, value] of Object.entries(handles)) doc.set(handle, value);
  return doc.encodeSnapshot();
}

/* ------------------------------------------------------------- the frame -- */

test("unsubscribe: the frame round-trips through the codec", () => {
  const encoded = encodeMessage({ type: "unsubscribe", queryId: 9 });
  assert.equal(peekFrameType(encoded), FrameType.UNSUBSCRIBE);
  assert.equal(FrameType.UNSUBSCRIBE, 0x15, "a free code in the query family, so 0.2.0 frames are untouched");
  assert.deepEqual(decodeMessage(encoded), { type: "unsubscribe", queryId: 9 });
});

/* ------------------------------------------------------------- the server - */

test("unsubscribe: the server stops broadcasting, and only to that subscription", () => {
  const app = raptorServer({ build: "unsubscribe-test" });
  app.query("inbox", { select: () => ["inbox/"] });
  app.query("jobs", { select: () => ["jobs/"] });
  const conn = fakeConn();
  app.serve(conn);

  conn.deliver({ type: "query", queryId: 1, name: "inbox", args: null });
  conn.deliver({ type: "query", queryId: 2, name: "jobs", args: null });
  assert.equal(app.store.subscriptionCount, 2);

  app.store.setField("inbox/1", "subject", "first");
  app.store.setField("jobs/1", "state", "queued");
  assert.equal(conn.opsFrames().length, 2);

  // The screen holding `inbox` is torn down.
  conn.deliver({ type: "unsubscribe", queryId: 1 });
  assert.equal(app.store.subscriptionCount, 1, "the subscription is gone, not just muted");

  app.store.setField("inbox/2", "subject", "second");
  assert.equal(conn.opsFrames().length, 2, "nothing more for the dropped projection");

  app.store.setField("jobs/2", "state", "queued");
  assert.equal(conn.opsFrames().length, 3, "the other subscription is untouched");
});

test("unsubscribe: an id that is already gone is a no-op, not an error", () => {
  const app = raptorServer({ build: "unsubscribe-test" });
  app.query("inbox", { select: () => ["inbox/"] });
  const conn = fakeConn();
  app.serve(conn);
  conn.deliver({ type: "query", queryId: 1, name: "inbox", args: null });

  conn.deliver({ type: "unsubscribe", queryId: 1 });
  conn.deliver({ type: "unsubscribe", queryId: 1 }); // again
  conn.deliver({ type: "unsubscribe", queryId: 404 }); // never existed

  assert.equal(app.store.subscriptionCount, 0);
  assert.ok(
    conn.messages().every((m) => m.type !== "error"),
    "cleanup code should not have to be conditional",
  );
});

test("unsubscribe: one connection cannot drop another's subscription", () => {
  const app = raptorServer({ build: "unsubscribe-test" });
  app.query("inbox", { select: () => ["inbox/"] });
  const ana = fakeConn();
  const bob = fakeConn();
  app.serve(ana);
  app.serve(bob);

  // Both pick queryId 1 - the id is per connection, not global.
  ana.deliver({ type: "query", queryId: 1, name: "inbox", args: null });
  bob.deliver({ type: "query", queryId: 1, name: "inbox", args: null });
  assert.equal(app.store.subscriptionCount, 2);

  ana.deliver({ type: "unsubscribe", queryId: 1 });
  assert.equal(app.store.subscriptionCount, 1);

  app.store.setField("inbox/1", "subject", "first");
  assert.equal(ana.opsFrames().length, 0);
  assert.equal(bob.opsFrames().length, 1, "Bob still has his");
});

test("unsubscribe: it is gated by the session, like every other query frame", async () => {
  const app = raptorServer<{ userId: string }>({
    build: "unsubscribe-test",
    onConnect: () => ({ userId: "ana" }),
  });
  app.query("mine", { select: ({ session }) => [`u/${session.userId}/`] });
  const conn = fakeConn();
  app.serve(conn);

  conn.deliver({ type: "unsubscribe", queryId: 1 });
  await settle();
  const refusal = conn.messages().at(-1)!;
  assert.equal(refusal.type, "error");
  assert.equal(refusal.type === "error" ? refusal.code : 0, 401);

  conn.deliver(hello);
  await settle();
  conn.deliver({ type: "query", queryId: 1, name: "mine", args: null });
  await settle();
  assert.equal(app.store.subscriptionCount, 1);
  conn.deliver({ type: "unsubscribe", queryId: 1 });
  await settle();
  assert.equal(app.store.subscriptionCount, 0);
});

/* ------------------------------------------------------------- the client - */

test("unsubscribe: the client stops tracking it and tells the server", async () => {
  const loop = createLoopback();
  const received: Message[] = [];
  loop.server.onMessage((bytes) => {
    if (peekFrameType(bytes) !== FrameType.OPS) received.push(decodeMessage(bytes));
  });
  const client = new RaptorClient(loop.client, { build: "unsubscribe-client" });
  const handshake = client.connect();
  await flushLoopback();
  loop.server.send(encodeMessage({ type: "welcome", sessionId: "s1", epoch: 1, serverBuild: "test" }));
  await handshake;

  const inbox = client.subscribe("inbox");
  const jobs = client.subscribe("jobs");
  assert.equal(client.subscriptionCount, 2);

  assert.equal(client.unsubscribe(inbox), true);
  assert.equal(client.unsubscribe(inbox), false, "dropping it twice is not a second message");
  await flushLoopback();

  const sent = received.filter((m) => m.type === "unsubscribe");
  assert.deepEqual(
    sent.map((m) => (m.type === "unsubscribe" ? m.queryId : 0)),
    [inbox],
  );
  assert.equal(client.subscriptionCount, 1);

  client.unsubscribeAll();
  await flushLoopback();
  assert.equal(client.subscriptionCount, 0);
  assert.deepEqual(
    received.filter((m) => m.type === "unsubscribe").map((m) => (m.type === "unsubscribe" ? m.queryId : 0)),
    [inbox, jobs],
  );
  loop.client.close();
  loop.server.close();
});

test("unsubscribe: a frame already in flight is not applied, and not acknowledged", async () => {
  const loop = createLoopback();
  const received: Message[] = [];
  loop.server.onMessage((bytes) => {
    if (peekFrameType(bytes) !== FrameType.OPS) received.push(decodeMessage(bytes));
  });
  const client = new RaptorClient(loop.client, { build: "unsubscribe-client" });
  const handshake = client.connect();
  await flushLoopback();
  loop.server.send(encodeMessage({ type: "welcome", sessionId: "s1", epoch: 1, serverBuild: "test" }));
  await handshake;

  const queryId = client.subscribe("inbox");
  loop.server.send(
    encodeMessage({ type: "snapshot", queryId, snapshot: snapshotOf({ "inbox/1": { subject: "first" } }) }),
  );
  await flushLoopback();
  assert.equal((client.signal("inbox/1")() as { subject: string }).subject, "first");

  // Dropped, and only then does the server's next frame arrive.
  client.unsubscribe(queryId);
  const book = new AddressBook();
  loop.server.send(
    encodeOpsFrame(book, {
      type: "ops",
      queryId,
      sequence: 1,
      batch: {
        baseVersion: 1,
        resultVersion: 2,
        atomic: false,
        ops: [{ kind: "set", handle: "inbox/1", field: "subject", value: "changed" }],
      },
    }),
  );
  loop.server.send(
    encodeMessage({ type: "snapshot", queryId, snapshot: snapshotOf({ "inbox/9": { subject: "late" } }) }),
  );
  await flushLoopback();

  assert.equal(
    (client.signal("inbox/1")() as { subject: string }).subject,
    "first",
    "the replica did not move for a subscription the application let go",
  );
  assert.equal(client.signal("inbox/9")(), undefined, "and a late snapshot is dropped too");
  assert.ok(
    !received.some((m) => m.type === "ack"),
    "acknowledging would tell the server we are still listening",
  );
  loop.client.close();
  loop.server.close();
});

