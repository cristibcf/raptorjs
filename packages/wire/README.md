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
- `@raptorstack/wire/server` — authoritative reactive store SDK, `query`/`mutation`/subscription, snapshot + delta, op-log, own WebSocket server.

## Usage

```ts
import { Document } from "@raptorstack/wire";
import { RaptorClient, connectWebSocket } from "@raptorstack/wire/client";
```

## License

MIT
