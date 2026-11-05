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
- `@raptorstack/wire/client` — session, reactive replica (each handle = one signal), loopback + WebSocket transports, reconnect with delta resync.
- `@raptorstack/wire/server` — authoritative reactive store SDK, `query`/`mutation`/subscription, per-connection sessions, snapshot + delta, op-log, own WebSocket server.

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

## License

MIT
