/**
 * The first tests for `@raptor/wire-client`.
 *
 * The package went without a single test until the 2026-09-24 audit (S10),
 * even though it is exactly the component that takes bytes from a peer and
 * applies them to the local state. Direct consequence: fix #3 from the
 * September 21 audit - the client failing closed on corrupt frames - had
 * nothing to protect it from a refactor.
 *
 * The tests use a fake server written directly on top of `Transport`, not
 * `@raptor/server`: here we care about what the CLIENT does when it receives
 * something, including something an honest server would never send.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { effect, createRoot } from "raptorjs";
import { Document, encodeMessage, encodeOpsFrame, AddressBook, type Operation } from "@raptor/wire";
import { RaptorClient, createLoopback, flushLoopback, type Transport } from "../../src/client/index.ts";

/**
 * The other end of the wire, under the test's control.
 *
 * `received` keeps everything the client sent, so we can also check what it did
 * NOT send - for example that it does not acknowledge a frame it dropped.
 */
interface Peer {
  readonly client: RaptorClient;
  readonly received: Uint8Array[];
  send(bytes: Uint8Array): void;
  close(): void;
}

function peer(options: ConstructorParameters<typeof RaptorClient>[1] = {}): Peer {
  const loop = createLoopback();
  const received: Uint8Array[] = [];
  loop.server.onMessage((bytes) => received.push(bytes));
  const client = new RaptorClient(loop.client, options);
  return {
    client,
    received,
    send: (bytes) => loop.server.send(bytes),
    close: () => {
      loop.client.close();
      loop.server.close();
    },
  };
}

/** A minimal WELCOME, so the handshake can complete. */
function welcome(sessionId = "s1", epoch = 1): Uint8Array {
  return encodeMessage({ type: "welcome", sessionId, epoch, serverBuild: "test" });
}

async function connected(options: ConstructorParameters<typeof RaptorClient>[1] = {}): Promise<Peer> {
  const p = peer(options);
  const handshake = p.client.connect();
  await flushLoopback();
  p.send(welcome());
  await handshake;
  return p;
}

/* ------------------------------------------------------------- handshake -- */

test("the handshake completes only at WELCOME, not when HELLO is sent", async () => {
  const p = peer();
  try {
    let gata = false;
    const handshake = p.client.connect().then(() => (gata = true));

    await flushLoopback();
    assert.equal(gata, false, "sending HELLO does not mean the session is open");
    assert.equal(p.received.length, 1, "the client sent exactly one HELLO");

    p.send(welcome("session-7", 3));
    await handshake;

    assert.equal(gata, true);
    assert.equal(p.client.sessionId, "session-7");
    assert.equal(p.client.epoch, 3);
  } finally {
    p.close();
  }
});

/* -------------------------------------------------- fail-closed (audit #3) -- */

test("a corrupt frame is ignored, not thrown (fail-closed, §21)", async () => {
  const p = await connected();
  const erori: unknown[] = [];
  const onUnhandled = (error: unknown): void => {
    erori.push(error);
  };
  process.on("unhandledRejection", onUnhandled);
  process.on("uncaughtException", onUnhandled);

  // `console.warn` is replaced so the test output stays clean, but also so we
  // can verify the rejection is actually reported, not swallowed silently.
  const avertismente: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => void avertismente.push(args.map(String).join(" "));

  try {
    // Three forms of garbage: meaningless bytes, a truncated frame, and an empty one.
    p.send(new Uint8Array([0xff, 0xfe, 0xfd, 0x07, 0x42]));
    p.send(new Uint8Array([0x01]));
    p.send(new Uint8Array([]));
    await flushLoopback();

    assert.deepEqual(erori, [], "no exception escaped into a microtask");
    assert.ok(avertismente.length >= 1, "the dropped frame is reported, not swallowed");
    assert.ok(avertismente.every((line) => line.includes("[raptor]")), avertismente.join(" | "));
  } finally {
    console.warn = realWarn;
    process.off("unhandledRejection", onUnhandled);
    process.off("uncaughtException", onUnhandled);
    p.close();
  }
});

test("after a corrupt frame, the session stays usable", async () => {
  const realWarn = console.warn;
  console.warn = () => {};
  const p = await connected();
  try {
    p.send(new Uint8Array([0xff, 0xff, 0xff]));
    await flushLoopback();

    // The same client now receives a valid snapshot and applies it.
    const doc = new Document();
    doc.set("cpu", 41);
    const queryId = p.client.subscribe("metrics");
    await flushLoopback();
    p.send(encodeMessage({ type: "snapshot", queryId, snapshot: doc.encodeSnapshot() }));
    await flushLoopback();

    assert.equal(p.client.signal("cpu")(), 41, "a dropped frame does not poison the session");
  } finally {
    console.warn = realWarn;
    p.close();
  }
});

/* ------------------------------------------------------------- replica ---- */

test("the snapshot fills the replica, and signals requested beforehand update", async () => {
  const p = await connected();
  try {
    // The signal is requested BEFORE the value exists: the real case of a
    // component mounted before the snapshot arrives.
    const cpu = p.client.signal<number>("cpu");
    assert.equal(cpu(), undefined);

    const doc = new Document();
    doc.set("cpu", 12);
    doc.set("mem", 64);
    const queryId = p.client.subscribe("metrics");
    await flushLoopback();
    p.send(encodeMessage({ type: "snapshot", queryId, snapshot: doc.encodeSnapshot() }));
    await flushLoopback();

    assert.equal(cpu(), 12);
    assert.equal(p.client.signal("mem")(), 64);
    assert.equal(p.client.snapshotsReceived, 1);
  } finally {
    p.close();
  }
});

test("an ops frame produces ONE commit, no matter how many handles it touches", async () => {
  const p = await connected();
  try {
    const queryId = p.client.subscribe("metrics");
    await flushLoopback();
    p.send(encodeMessage({ type: "snapshot", queryId, snapshot: new Document().encodeSnapshot() }));
    await flushLoopback();

    // We count effect runs over THREE signals touched by the same frame.
    let rulari = 0;
    const dispose = createRoot((dispose) => {
      effect(() => {
        p.client.signal("a")();
        p.client.signal("b")();
        p.client.signal("c")();
        rulari++;
      });
      return dispose;
    });
    const dupaMontare = rulari;

    const book = new AddressBook();
    // `replace` because these handles are scalars: `set` targets a FIELD of an
    // object (`handle.field`), not the handle itself.
    const ops: Operation[] = [
      { kind: "replace", handle: "a", value: 1 },
      { kind: "replace", handle: "b", value: 2 },
      { kind: "replace", handle: "c", value: 3 },
    ];
    p.send(
      encodeOpsFrame(book, {
        type: "ops",
        queryId,
        sequence: 1,
        batch: { baseVersion: 0, resultVersion: 3, atomic: true, ops },
      }),
    );
    await flushLoopback();

    assert.equal(p.client.signal("a")(), 1);
    assert.equal(p.client.signal("c")(), 3);
    assert.equal(
      rulari - dupaMontare,
      1,
      "the network transaction must be a single UI commit, not one per handle",
    );
    dispose();
  } finally {
    p.close();
  }
});

test("a sequence gap is reported, not hidden", async () => {
  const gauri: Array<{ expected: number; received: number }> = [];
  const p = await connected({ onGap: (_queryId, expected, received) => void gauri.push({ expected, received }) });
  try {
    const queryId = p.client.subscribe("metrics");
    await flushLoopback();
    p.send(encodeMessage({ type: "snapshot", queryId, snapshot: new Document().encodeSnapshot() }));
    await flushLoopback();

    const book = new AddressBook();
    const frame = (sequence: number, value: number, base: number): Uint8Array =>
      encodeOpsFrame(book, {
        type: "ops",
        queryId,
        sequence,
        batch: { baseVersion: base, resultVersion: base + 1, ops: [{ kind: "replace", handle: "a", value }] },
      });

    p.send(frame(1, 1, 0));
    await flushLoopback();
    // We skip 2: exactly the situation where the replica would silently diverge.
    p.send(frame(3, 3, 1));
    await flushLoopback();

    assert.deepEqual(gauri, [{ expected: 2, received: 3 }]);
  } finally {
    p.close();
  }
});

/* -------------------------------------------------------------- mutatii --- */

test("a mutation resolves with its correlated result, not the first one to arrive", async () => {
  const p = await connected();
  try {
    const prima = p.client.mutate("add", { text: "a" });
    const aDoua = p.client.mutate("add", { text: "b" });
    await flushLoopback();

    // The responses arrive REVERSED relative to the order of the requests.
    p.send(encodeMessage({ type: "mutationResult", requestId: 2, ok: true, value: "second" }));
    p.send(encodeMessage({ type: "mutationResult", requestId: 1, ok: false, value: "first" }));
    await flushLoopback();

    assert.deepEqual(await aDoua, { ok: true, value: "second" });
    assert.deepEqual(await prima, { ok: false, value: "first" }, "correlation is done by requestId, not by order");
  } finally {
    p.close();
  }
});

/* -------------------------------------------------------------- transport - */

test("a closed transport no longer delivers anything in either direction", async () => {
  const loop = createLoopback();
  const primite: Uint8Array[] = [];
  loop.server.onMessage((bytes) => primite.push(bytes));

  loop.client.send(new Uint8Array([1]));
  await flushLoopback();
  assert.equal(primite.length, 1);

  loop.client.close();
  loop.client.send(new Uint8Array([2]));
  await flushLoopback();
  assert.equal(primite.length, 1, "a closed end no longer sends");
});

test("the loopback copies the bytes, so a mutation after send is not seen at the other end", async () => {
  const loop = createLoopback();
  let vazut: Uint8Array | null = null;
  loop.server.onMessage((bytes) => (vazut = bytes));

  const bytes = new Uint8Array([1, 2, 3]);
  loop.client.send(bytes);
  bytes[0] = 99; // reusing the buffer after sending
  await flushLoopback();

  assert.deepEqual([...(vazut as unknown as Uint8Array)], [1, 2, 3], "the receiver sees what was sent, not what followed");
});

test("the stats count both directions separately", async () => {
  const loop = createLoopback();
  loop.server.onMessage(() => {});
  loop.client.onMessage(() => {});

  loop.client.send(new Uint8Array(10));
  loop.server.send(new Uint8Array(4));
  loop.server.send(new Uint8Array(6));
  await flushLoopback();

  assert.equal(loop.stats.clientToServerBytes, 10);
  assert.equal(loop.stats.clientToServerMessages, 1);
  assert.equal(loop.stats.serverToClientBytes, 10);
  assert.equal(loop.stats.serverToClientMessages, 2);
});

test("a custom transport needs exactly three methods", async () => {
  // The contract is small on purpose: whoever wants a real WebSocket, QUIC or a
  // worker channel implements this, not a base class.
  const trimise: Uint8Array[] = [];
  let livreaza: ((data: Uint8Array) => void) | null = null;
  const propriu: Transport = {
    send: (data) => void trimise.push(data),
    onMessage: (handler) => void (livreaza = handler),
    close: () => {},
  };

  const client = new RaptorClient(propriu);
  const handshake = client.connect();
  assert.equal(trimise.length, 1, "HELLO went out through the custom transport");

  (livreaza as unknown as (data: Uint8Array) => void)(welcome("via-custom-transport"));
  await handshake;
  assert.equal(client.sessionId, "via-custom-transport");
});
