# @raptorstack/wire

**RaptorWire** — a state-aware binary protocol. After the initial snapshot, the
network carries **semantic delta operations** (`SET`, `INC`, `APPEND`, `PATCH`,
`MOVE`, …) over a known base state, not re-serialized documents. Own WebSocket
server (RFC 6455), no `ws` dependency. Zero runtime dependencies.

Part of [**RaptorStack**](https://github.com/cristibcf/raptorjs).

## Install

```bash
npm install @raptorstack/wire
```

## Subpaths

- `@raptorstack/wire` — opcodes, versioned `Document`, snapshot, message protocol, Reactive Address Space, adaptive encoding.
- `@raptorstack/wire/codec` — varint, zig-zag, float64, length-prefixed string/bytes primitives.
- `@raptorstack/wire/client` — session, reactive replica (each handle = one signal), subscribe/unsubscribe, loopback + WebSocket transports, reconnect with delta resync.
- `@raptorstack/wire/server` — authoritative reactive store SDK, `query`/`mutation`/subscription, per-connection sessions, snapshot + delta, op-log, own WebSocket server.
- `@raptorstack/wire/sse` — Server-Sent Events, both ends: a reader that turns a `fetch` body into an async iterable of typed events, and a writer that frames events and heartbeats. Isomorphic, nothing from `node:`.

## Usage

```ts
import { Document } from "@raptorstack/wire";
import { RaptorClient, connectWebSocket } from "@raptorstack/wire/client";
```

## Per-connection sessions

A query's projection must come from **who is asking**, never from `args` — the
client is untrusted (spec §21). `onConnect` runs once per connection, before
anything is served, and whatever it returns is the `session` both contexts
carry:

```ts
import { raptorServer } from "@raptorstack/wire/server";

interface Session { userId: string }

const app = raptorServer<Session>({
  onConnect: (conn) => {
    const token = new URL(conn.handshake?.url ?? "/", "http://x").searchParams.get("token");
    const userId = verify(token); // throws -> ERROR 401 and the connection closes
    return { userId };
  },
});

app.query("jobs", { select: ({ session }) => [`users/${session.userId}/jobs/`] });
app.mutation("rename", {
  run: ({ input, store, session }) => {
    const { id, title } = input as { id: string; title: string };
    store.setField(`users/${session.userId}/jobs/${id}`, "title", title);
    return { ok: true };
  },
});
```

- `TSession` defaults to `undefined`, so a server without `onConnect` keeps the
  0.2.0 context shape and compiles unchanged.
- Declaring `onConnect` turns the gate on: until it resolves, QUERY is answered
  with ERROR `401` and MUTATION with `ok: false`, so nothing is ever served
  against an absent session. A second HELLO is refused with `400`.
- `conn.handshake` carries the transport's `url`, `headers` and
  `remoteAddress` when it has them — `serveOverWebSocket` fills it from the
  upgrade request, which is the only place a cookie or bearer token still
  exists by the time frames start arriving.

The wire format is unchanged: this is the existing HELLO/WELCOME/ERROR
vocabulary, used as the spec already described.

## Dropping a subscription

`subscribe()` returns a `queryId`; `unsubscribe(queryId)` gives it back. Until
0.2.1 closing the connection was the only way to stop a subscription, so a
client that navigates between screens on one socket accumulated every
subscription it had ever opened — and the server broadcast to all of them.

```ts
const queryId = client.subscribe("inbox", { folder });
onCleanup(() => client.unsubscribe(queryId)); // or client.unsubscribeAll()
```

- The server drops it (`ReactiveStore.removeSubscription`) and stops
  broadcasting; other subscriptions on the same connection are untouched, and
  `queryId` is per connection so one session cannot drop another's.
- Idempotent: an id the server no longer holds is ignored rather than refused,
  so teardown code needs no conditions.
- The client stops applying frames for a dropped subscription that were already
  in flight, and does not acknowledge them.
- `client.subscriptionCount` makes cleanup checkable in a test.

This is the one change in 0.2.1 that touches the wire format — a new frame type
at a previously unassigned code (`0x15`), so every 0.2.0 frame is
byte-identical and neither side has to use it.

## Awaited mutations

`run` may return a promise, so a short I/O-bound command can return a
validated result or report failure instead of being pushed into
enqueue-and-report-deltas (which stays the right shape for long work):

```ts
app.mutation("rename", {
  run: async ({ input, store, session }) => {
    const { id, title } = input as { id: string; title: string };
    const saved = await db.renameConversation(session.userId, id, title); // may throw
    store.transaction(() => {
      store.setField(`conv:${id}`, "title", saved.title);
      store.setField(`conv:${id}`, "updatedAt", saved.updatedAt);
    });
    return saved;
  },
});
```

- A rejected `run` answers `MUTATION_RESULT ok: false` with the message; the
  client never waits forever.
- Two mutations arriving in order **on one connection** cannot interleave their
  store writes: frames are handled in strict arrival order, so the second
  waits for the first. Across connections they run concurrently, as before.
- A synchronous `run` is still wrapped in one `store.transaction` and arrives
  as a single atomic frame — unchanged from 0.2.0. An async `run` is wrapped
  only up to its first `await` (an open transaction spanning an await would
  absorb other connections' writes into this one's batch), so group the writes
  you want delivered together in `store.transaction()` yourself, as above.
- `authorize` stays synchronous on purpose: it decides against state the server
  already holds, and an awaitable check would open a gap between "allowed" and
  "applied". Put async checks in `run`.

## Server-Sent Events

RaptorWire carries state. A token stream from a model is not state — it is a
one-shot, one-way byte stream with no base to delta against, started by a POST
with a body, which is exactly where `EventSource` is unusable (GET only, no
headers). So `@raptorstack/wire/sse` has the frame parser nobody should write
twice:

```ts
// Browser
import { openEventStream } from "@raptorstack/wire/sse";

const events = await openEventStream("/api/chat", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt }),
}, { doneSentinel: "[DONE]" });

for await (const event of events) reply.update((t) => t + JSON.parse(event.data).delta);
```

```ts
// Node
import { writeEventStream } from "@raptorstack/wire/sse";

const stream = writeEventStream(res); // a node:http ServerResponse fits structurally
for await (const token of model.stream(prompt)) stream.send({ delta: token });
stream.close("[DONE]");
```

- A frame split across two chunks, a multi-line `data:` and the comment lines
  proxies need are all handled; so is a multi-byte character straddling a chunk
  boundary.
- `doneSentinel` ends the iteration without yielding the sentinel.
- Breaking out of the `for await` cancels the body, so an abort mid-stream
  releases the connection.
- An event the stream never terminated with a blank line is discarded, as the
  protocol requires.
- The writer heartbeats every 15s by default (`heartbeatMs`), splits a payload
  with newlines into several `data:` lines, and sends
  `x-accel-buffering: no` — without which nginx buffers the whole stream and
  delivers it at the end.

## License

MIT
