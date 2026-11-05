/**
 * Awaited mutations (v0.2.1).
 *
 * `run` was synchronous, so a short I/O-bound command - rename a conversation,
 * mark a reminder done - had to become fire-and-forget: enqueue, report the
 * deltas later, never return a validated result and never report failure. That
 * pattern is right for long work (a render job) and wrong for a round trip to a
 * database.
 *
 * What these tests pin down is the part that is easy to get wrong once a
 * handler can await: a rejected mutation must still answer, two mutations on
 * one connection must not interleave their store writes, and a synchronous
 * mutation must keep reaching the client as exactly one atomic frame.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AddressBook,
  FrameType,
  decodeMessage,
  decodeOpsFrame,
  encodeMessage,
  peekFrameType,
  type Message,
  type MutationResultMsg,
  type OpsMsg,
} from "../../src/core/index.ts";
import { raptorServer, type ServerConnection } from "../../src/server/index.ts";

/**
 * A connection that keeps raw bytes: OPS frames travel over the Reactive
 * Address Space, so they need the per-connection `AddressBook`, not
 * `decodeMessage`.
 */
interface FakeConn extends ServerConnection {
  deliver(msg: Message): void;
  /** Non-OPS frames, decoded. */
  messages(): Message[];
  /** OPS frames, decoded against this connection's address book. */
  opsFrames(): OpsMsg[];
  lastResult(): MutationResultMsg;
}

function fakeConn(): FakeConn {
  const raw: Uint8Array[] = [];
  const book = new AddressBook();
  let handler: ((data: Uint8Array) => void) | null = null;
  const messages = (): Message[] =>
    raw.filter((b) => peekFrameType(b) !== FrameType.OPS).map((b) => decodeMessage(b));
  return {
    send: (data) => void raw.push(data.slice()),
    onMessage: (fn) => void (handler = fn),
    close: () => {},
    deliver: (msg) => handler?.(encodeMessage(msg)),
    messages,
    opsFrames: () =>
      raw.filter((b) => peekFrameType(b) === FrameType.OPS).map((b) => decodeOpsFrame(book, b)),
    lastResult: () => {
      const last = messages().filter((m) => m.type === "mutationResult").at(-1);
      assert.ok(last, "a MUTATION_RESULT was sent");
      if (last.type !== "mutationResult") throw new Error("unreachable");
      return last;
    },
  };
}

/** A macrotask: enough for any chain of awaits inside a handler to settle. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mutation(name: string, input: unknown, requestId = 1): Message {
  return { type: "mutation", requestId, name, input: input as never };
}

/* -------------------------------------------------------- result + failure -- */

test("async mutation: an awaited run returns its validated result", async () => {
  const app = raptorServer({ build: "async-mutation" });
  app.mutation("rename", {
    run: async ({ input, store }) => {
      const { id, title } = input as { id: string; title: string };
      await Promise.resolve(); // stands in for the database round trip
      store.setField(`conv:${id}`, "title", title);
      return { id, title };
    },
  });
  const conn = fakeConn();
  app.serve(conn);

  conn.deliver(mutation("rename", { id: "7", title: "Groceries" }));
  await settle();

  const result = conn.lastResult();
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { id: "7", title: "Groceries" });
  assert.equal((app.store.doc.get("conv:7") as { title: string }).title, "Groceries");
});

test("async mutation: a rejected run answers ok:false instead of hanging the client", async () => {
  const app = raptorServer({ build: "async-mutation" });
  app.mutation("rename", {
    run: async () => {
      await Promise.resolve();
      throw new Error("title already taken");
    },
  });
  const conn = fakeConn();
  app.serve(conn);

  conn.deliver(mutation("rename", { id: "7" }));
  await settle();

  const result = conn.lastResult();
  assert.equal(result.ok, false);
  assert.match(String(result.value), /title already taken/);
});

test("async mutation: authorize stays synchronous and still denies before any write", async () => {
  const app = raptorServer({ build: "async-mutation" });
  let ran = false;
  app.mutation("rename", {
    authorize: ({ input }) => (input as { id: string }).id === "mine",
    run: async () => {
      ran = true;
      return null;
    },
  });
  const conn = fakeConn();
  app.serve(conn);

  conn.deliver(mutation("rename", { id: "theirs" }));
  await settle();

  assert.equal(conn.lastResult().ok, false);
  assert.equal(conn.lastResult().value, "unauthorized");
  assert.equal(ran, false, "the handler never ran");
});

/* --------------------------------------------------------------- ordering -- */

test("async mutation: two in order on one connection do not interleave their writes", async () => {
  const app = raptorServer({ build: "async-mutation" });
  const timeline: string[] = [];
  let release = (): void => {};
  const slow = new Promise<void>((resolve) => (release = resolve));

  app.mutation("slow", {
    run: async ({ store }) => {
      timeline.push("slow:start");
      store.append("log", "slow-1");
      await slow;
      store.append("log", "slow-2");
      timeline.push("slow:end");
      return null;
    },
  });
  app.mutation("fast", {
    run: ({ store }) => {
      timeline.push("fast");
      store.append("log", "fast");
      return null;
    },
  });

  const conn = fakeConn();
  app.serve(conn);

  conn.deliver(mutation("slow", null, 1));
  conn.deliver(mutation("fast", null, 2));
  await settle();

  // The fast mutation has NOT run: it is queued behind the awaited one.
  assert.deepEqual(timeline, ["slow:start"]);
  assert.deepEqual(app.store.doc.get("log"), ["slow-1"]);

  release();
  await settle();

  assert.deepEqual(timeline, ["slow:start", "slow:end", "fast"]);
  assert.deepEqual(app.store.doc.get("log"), ["slow-1", "slow-2", "fast"], "arrival order, not completion order");
  // Both answered, in request order.
  const results = conn.messages().filter((m) => m.type === "mutationResult");
  assert.deepEqual(
    results.map((m) => (m.type === "mutationResult" ? m.requestId : 0)),
    [1, 2],
  );
});

/* -------------------------------------------------------------- atomicity -- */

test("async mutation: a synchronous run still reaches the client as one atomic frame", async () => {
  const app = raptorServer({ build: "async-mutation" });
  app.query("all", { select: () => ["item:"] });
  app.mutation("addTwo", {
    run: ({ store }) => {
      store.setField("item:1", "n", 1);
      store.setField("item:2", "n", 2);
      return null;
    },
  });
  const conn = fakeConn();
  app.serve(conn);
  conn.deliver({ type: "query", queryId: 1, name: "all", args: null });
  conn.deliver(mutation("addTwo", null));
  await settle();

  const frames = conn.opsFrames();
  assert.equal(frames.length, 1, "one OPS frame, not one per write");
  assert.equal(frames[0]!.batch.atomic, true, "a single DOM commit on the client (16.1)");
  assert.equal(frames[0]!.batch.ops.length, 2);
});

test("async mutation: writes grouped in store.transaction after the await stay atomic", async () => {
  const app = raptorServer({ build: "async-mutation" });
  app.query("all", { select: () => ["item:"] });
  app.mutation("addTwoLater", {
    run: async ({ store }) => {
      await Promise.resolve();
      // The documented pattern: an async `run` is not implicitly atomic past
      // its first await, so the write block says so itself.
      store.transaction(() => {
        store.setField("item:1", "n", 1);
        store.setField("item:2", "n", 2);
      });
      return null;
    },
  });
  const conn = fakeConn();
  app.serve(conn);
  conn.deliver({ type: "query", queryId: 1, name: "all", args: null });
  conn.deliver(mutation("addTwoLater", null));
  await settle();

  const frames = conn.opsFrames();
  assert.equal(frames.length, 1);
  assert.equal(frames[0]!.batch.atomic, true);
  assert.equal(frames[0]!.batch.ops.length, 2);
  assert.equal(conn.lastResult().ok, true);
});
