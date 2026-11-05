/**
 * Per-connection sessions (v0.2.1).
 *
 * Before this, `select()` saw only `args` - bytes the client chose - so a
 * multi-tenant server was not writable: a client could subscribe asking for
 * `users/<someone-else>/jobs` and `authorize` had nothing to refuse with. The
 * SPEC already said "authorization is done per query/mutation on the server,
 * not just at handshake" (21); these tests are what makes that true.
 *
 * They drive `app.serve()` over a fake connection and raw frames, because the
 * point is what the SERVER does with a frame an honest client would not send:
 * a query before HELLO, a second HELLO, args pointing at another tenant.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Document, encodeMessage, decodeMessage, type Message } from "../../src/core/index.ts";
import {
  raptorServer,
  serveOverWebSocket,
  type ConnectionHandshake,
  type ServerConnection,
} from "../../src/server/index.ts";
import { RaptorClient, connectWebSocket } from "@raptorstack/wire/client";

/** The other end of the wire, under the test's control. */
interface FakeConn extends ServerConnection {
  /** Everything the server sent, decoded. */
  readonly sent: Message[];
  /** Hand the server a frame, as a client would. */
  deliver(msg: Message): void;
  readonly closes: () => number;
}

function fakeConn(handshake?: ConnectionHandshake): FakeConn {
  const sent: Message[] = [];
  let handler: ((data: Uint8Array) => void) | null = null;
  let closes = 0;
  return {
    sent,
    ...(handshake ? { handshake } : {}),
    send: (data) => void sent.push(decodeMessage(data)),
    onMessage: (fn) => void (handler = fn),
    close: () => void closes++,
    deliver: (msg) => handler?.(encodeMessage(msg)),
    closes: () => closes,
  };
}

const hello: Message = { type: "hello", protocolVersion: 1, clientBuild: "test", capabilities: [] };

function query(name: string, args: unknown, queryId = 1): Message {
  return { type: "query", queryId, name, args: args as never };
}

function snapshotHandles(msg: Message): string[] {
  assert.equal(msg.type, "snapshot");
  if (msg.type !== "snapshot") throw new Error("unreachable");
  return Document.decodeSnapshot(msg.snapshot).handles().sort();
}

/** The last frame, asserted to be an ERROR, so the code can be compared. */
function lastError(conn: FakeConn): { code: number; message: string } {
  const msg = conn.sent.at(-1);
  assert.ok(msg, "the server answered");
  assert.equal(msg.type, "error");
  if (msg.type !== "error") throw new Error("unreachable");
  return { code: msg.code, message: msg.message };
}

/** The last frame, asserted to be a MUTATION_RESULT. */
function lastResult(conn: FakeConn): { ok: boolean; value: unknown } {
  const msg = conn.sent.at(-1);
  assert.ok(msg, "the server answered");
  assert.equal(msg.type, "mutationResult");
  if (msg.type !== "mutationResult") throw new Error("unreachable");
  return { ok: msg.ok, value: msg.value };
}

/**
 * Lets the per-connection handler chain settle. A macrotask, not a couple of
 * microtasks: `onConnect` may await anything, and the chain forms behind it.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface Session {
  userId: string;
}

/**
 * A two-tenant app. `select` ignores `args` entirely and projects from the
 * session - which is the whole point: the prefix is not negotiable.
 */
function tenantApp(resolve: (hello: Message) => Session | Promise<Session>) {
  const app = raptorServer<Session>({
    build: "session-test",
    onConnect: (_conn, helloMsg) => resolve(helloMsg),
  });
  app.query("jobs", { select: ({ session }) => [`users/${session.userId}/jobs/`] });
  app.query("jobsFromArgs", {
    // The naive version a 0.2.0 consumer was forced to write, kept honest by
    // an `authorize` that can finally see who is asking.
    authorize: ({ args, session }) => (args as { userId: string }).userId === session.userId,
    select: ({ args }) => [`users/${(args as { userId: string }).userId}/jobs/`],
  });
  app.mutation("rename", {
    run: ({ input, store, session }) => {
      const { id, title } = input as { id: string; title: string };
      store.setField(`users/${session.userId}/jobs/${id}`, "title", title);
      return { ok: true };
    },
  });
  app.store.setField("users/alice/jobs/1", "title", "alice job");
  app.store.setField("users/bob/jobs/1", "title", "bob job");
  return app;
}

/* ----------------------------------------------------- per-user projection -- */

test("session: a connection cannot select another session's prefixes", async () => {
  const app = tenantApp(() => ({ userId: "alice" }));
  const conn = fakeConn();
  app.serve(conn);

  conn.deliver(hello);
  await settle();
  assert.equal(conn.sent.at(-1)!.type, "welcome");

  // Alice asks for the jobs query: the projection comes from the session.
  conn.deliver(query("jobs", null, 1));
  await settle();
  assert.deepEqual(snapshotHandles(conn.sent.at(-1)!), ["users/alice/jobs/1"]);

  // Alice now points `args` at Bob. The projection is unchanged, because
  // `select` never reads `args`.
  conn.deliver(query("jobs", { userId: "bob" }, 2));
  await settle();
  assert.deepEqual(snapshotHandles(conn.sent.at(-1)!), ["users/alice/jobs/1"]);

  // And the args-driven query is refused outright, which is what was
  // impossible to write before: `authorize` can compare args to the session.
  conn.deliver(query("jobsFromArgs", { userId: "bob" }, 3));
  await settle();
  assert.equal(lastError(conn).code, 403);

  // Her own id still passes, so the check denies the tenant, not the query.
  conn.deliver(query("jobsFromArgs", { userId: "alice" }, 4));
  await settle();
  assert.deepEqual(snapshotHandles(conn.sent.at(-1)!), ["users/alice/jobs/1"]);
});

test("session: a mutation writes under the caller's own prefix", async () => {
  const app = tenantApp(() => ({ userId: "bob" }));
  const conn = fakeConn();
  app.serve(conn);
  conn.deliver(hello);
  await settle();

  conn.deliver({ type: "mutation", requestId: 1, name: "rename", input: { id: "1", title: "renamed" } });
  await settle();
  assert.equal(lastResult(conn).ok, true);
  assert.equal((app.store.doc.get("users/bob/jobs/1") as { title: string }).title, "renamed");
  // Alice's record is untouched: the handle came from the session, not the input.
  assert.equal((app.store.doc.get("users/alice/jobs/1") as { title: string }).title, "alice job");
});

/* ------------------------------------------------------------- the gate ---- */

test("session: an unauthenticated connection is denied every query and mutation", async () => {
  const app = tenantApp(() => {
    throw new Error("no cookie");
  });
  const conn = fakeConn();
  app.serve(conn);

  // Before HELLO: the session does not exist yet, so nothing is served.
  conn.deliver(query("jobs", null, 1));
  conn.deliver({ type: "mutation", requestId: 1, name: "rename", input: { id: "1", title: "x" } });
  await settle();
  assert.equal(conn.sent.length, 2);
  const earlyQuery = conn.sent[0];
  const earlyMutation = conn.sent[1];
  assert.equal(earlyQuery?.type === "error" ? earlyQuery.code : null, 401);
  assert.equal(earlyMutation?.type === "mutationResult" ? earlyMutation.ok : null, false);
  assert.equal(app.store.subscriptionCount, 0, "no subscription was created");

  // After a refused HELLO: still nothing, and no WELCOME was ever sent.
  conn.deliver(hello);
  await settle();
  assert.equal(lastError(conn).code, 401);
  assert.ok(
    conn.sent.every((m) => m.type !== "welcome"),
    "a refused connection is never welcomed",
  );
});

test("session: onConnect throwing closes the connection and leaves nothing half-open", async () => {
  const app = tenantApp(async () => {
    await Promise.resolve();
    throw new Error("expired token");
  });
  const conn = fakeConn();
  app.serve(conn);

  conn.deliver(hello);
  await settle();

  assert.equal(conn.closes(), 1, "the connection was closed, not left open");
  assert.equal(app.store.subscriptionCount, 0);
  assert.equal(lastError(conn).code, 401);

  // Frames that arrive after the refusal are dropped, not answered.
  const after = conn.sent.length;
  conn.deliver(query("jobs", null, 9));
  conn.deliver(hello);
  await settle();
  assert.equal(conn.sent.length, after, "a closed connection gets no further replies");
});

test("session: a query racing a slow onConnect waits for it instead of slipping through", async () => {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const app = tenantApp(async () => {
    await gate;
    return { userId: "alice" };
  });
  const conn = fakeConn();
  app.serve(conn);

  conn.deliver(hello);
  conn.deliver(query("jobs", null, 1)); // arrives while onConnect is still pending
  await settle();
  assert.equal(conn.sent.length, 0, "nothing is answered before the session exists");

  release();
  await settle();
  assert.equal(conn.sent.length, 2);
  assert.equal(conn.sent[0]?.type, "welcome", "WELCOME comes first, in arrival order");
  assert.deepEqual(snapshotHandles(conn.sent[1]!), ["users/alice/jobs/1"]);
});

test("session: a second HELLO cannot re-authenticate a connection mid-flight", async () => {
  let calls = 0;
  const app = tenantApp(() => ({ userId: ++calls === 1 ? "alice" : "bob" }));
  const conn = fakeConn();
  app.serve(conn);

  conn.deliver(hello);
  await settle();
  conn.deliver(hello);
  await settle();

  assert.equal(calls, 1, "onConnect runs once per connection");
  assert.equal(lastError(conn).code, 400);
});

/* ------------------------------------------- 0.2.0 compatibility + metadata - */

test("session: a server without onConnect keeps the 0.2.0 contexts", async () => {
  const seen: { session: unknown; sameConn: boolean }[] = [];
  const app = raptorServer({ build: "no-session" });
  const conn = fakeConn();
  app.query("all", {
    select: (ctx) => {
      seen.push({ session: ctx.session, sameConn: ctx.conn === conn });
      return ["n"];
    },
  });
  app.store.setField("n", "v", 1);
  app.serve(conn);

  // No HELLO first, exactly as a 0.2.0 server allowed: there is no identity
  // to wait for, so the gate stays off and the reply is synchronous.
  conn.deliver(query("all", null));
  assert.deepEqual(snapshotHandles(conn.sent.at(-1)!), ["n"], "answered without awaiting a tick");
  assert.deepEqual(seen, [{ session: undefined, sameConn: true }]);
});

test("session: the WebSocket transport surfaces the upgrade handshake", async () => {
  interface User {
    name: string;
  }
  const app = raptorServer<User>({
    build: "ws-session",
    onConnect: (conn) => {
      // What a real deployment does: read the token off the HTTP handshake,
      // which no longer exists by the time the first frame arrives. Here the
      // query string, because a browser `WebSocket` cannot set headers; a
      // `cookie` header off the same `handshake.headers` reads the same way.
      const token = new URL(conn.handshake?.url ?? "/", "http://x").searchParams.get("token");
      if (!token) throw new Error("no token on the handshake");
      return { name: token };
    },
  });
  app.query("mine", { select: ({ session }) => [`u/${session.name}/`] });
  app.store.setField("u/alice/profile", "name", "Alice");
  app.store.setField("u/bob/profile", "name", "Bob");

  const http: Server = createServer((_req, res) => res.end("ok"));
  const ws = serveOverWebSocket(app, http, { pingIntervalMs: 0 });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const { port } = http.address() as AddressInfo;
  try {
    const client = new RaptorClient(await connectWebSocket(`ws://127.0.0.1:${port}/raptor?token=alice`), {
      build: "ws-session-client",
    });
    await client.connect();
    client.subscribe("mine");
    const deadline = Date.now() + 3000;
    while (client.snapshotsReceived === 0) {
      if (Date.now() > deadline) throw new Error("timeout waiting for the snapshot");
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal((client.signal("u/alice/profile")() as { name: string }).name, "Alice");
    assert.equal(client.signal("u/bob/profile")(), undefined, "the other tenant is not in the projection");
    client.close();
  } finally {
    ws.close();
    http.close();
  }
});
