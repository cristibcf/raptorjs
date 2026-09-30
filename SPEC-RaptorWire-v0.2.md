# RaptorWire v0.2 — preliminary specification (as implemented)

Starting point for the reference codec implementation, not a final specification
(whitepaper §31). Describes exactly the format produced by [`@raptor/wire-core`](packages/wire-core).

## Codec primitives (`@raptor/wire-codec`)

| Type | Encoding |
|---|---|
| `u8` | 1 byte |
| `bool` | `u8` (0/1) |
| unsigned int | varint LEB128 (up to 2^53-1) |
| signed int | zig-zag → varint |
| `float64` | IEEE 754, little-endian, 8 bytes |
| `bytes` | `varint(len)` + raw bytes |
| `string` | `bytes` with UTF-8 content |

## Tagged values (generic fallback, §12)

`u8(tag)` + payload: `0=NULL 1=FALSE 2=TRUE 3=INT(zigzag) 4=FLOAT(float64) 5=STRING 6=ARRAY(varint len + values) 7=OBJECT(varint len + [string(key)+value]) 8=BYTES`.

## Adaptive encoding (§13.2, optional)

`SchemaCodec` chooses a more compact representation when the schema provides constraints:
`percentage`→`u8`; `uint range`→`u8`/2 bytes/varint; `int range`→offset `u8`/2 bytes; `money(scale)`→scaled integer zig-zag; `enum`→index; otherwise fallback.

## Operation opcodes (§13)

`0x01 SET · 0x02 INC · 0x03 APPEND · 0x04 INSERT · 0x05 REMOVE · 0x06 MOVE · 0x07 PATCH · 0x08 CLEAR · 0x09 REPLACE`

The body of an operation (`writeOpBody`), after opcode + target:
- `SET`   `string(field) value`
- `INC`   `string(field) float64(delta)`
- `APPEND`/`REPLACE` `value`
- `INSERT` `varint(index) value`
- `REMOVE` `varint(index)`
- `MOVE`  `varint(from) varint(to)`
- `PATCH` `varint(n) [string(field) value]×n`
- `CLEAR` —

## Frame types (§31.2)

`0x01 HELLO · 0x02 WELCOME · 0x03 SCHEMA · 0x10 QUERY · 0x11 SNAPSHOT · 0x12 OPS · 0x13 ACK · 0x14 RESYNC · 0x20 MUTATION · 0x21 MUTATION_RESULT · 0x30 PING · 0x7F ERROR`

Each frame = `u8(frameType)` + payload. Non-OPS messages: `encodeMessage`/`decodeMessage`.

- **HELLO** `varint(protocolVersion) string(clientBuild) varint(n)+string×n(capabilities) bool+string?(resumeToken) bool+varint?(lastAck)`
- **WELCOME** `string(sessionId) varint(epoch) string(serverBuild)`
- **QUERY** `varint(queryId) string(name) value(args) varint(sinceVersion)` — `sinceVersion>0` requests a delta resync
- **SNAPSHOT** `varint(queryId) bytes(snapshot)` — snapshot = `varint(version) varint(count) [string(handle) value]×count`
- **ACK** `varint(queryId) varint(sequence)`
- **MUTATION** `varint(requestId) string(name) value(input)`
- **MUTATION_RESULT** `varint(requestId) bool(ok) value`
- **ERROR** `varint(code) string(message)`

## OPS on the Reactive Address Space (§5.2, hot path)

`encodeOpsFrame`/`decodeOpsFrame` — operations reference **compact addresses**, not string handles.
A handle's name is sent only once, when the address is introduced (per-frame dictionary).

```
u8(0x12 OPS)
varint(queryId)
varint(sequence)
varint(dictCount)  [ varint(address) string(handle) ] × dictCount   # only new addresses
bool(hasTx) varint(transactionId)?
bool(atomic)                                   # network transaction → a single DOM commit (§16.1)
varint(baseVersion) varint(resultVersion)
varint(opCount)
[ u8(opcode) varint(address) <opBody> ] × opCount
```

Address space = **session-scoped, per connection** (whitepaper §5.2: "session-scoped or versioned; not ambiguously reused"). On reconnect, the new session renegotiates the addresses, but the state (the replica) is preserved.

## Session, sequences, resync (§14)

- Each subscription has monotonic **sequence** numbers; the client detects gaps (`onGap`) and acknowledges with `ACK`.
- **Idempotency** (§14.2): `INC` is not idempotent → batches carry a `transactionId` for deduplication.
- **Automatic delta resync** (§14.3): the server keeps an op-log. On reconnect with `sinceVersion`, if the history continuously covers everything from that version, it sends **only the missing operations** (no snapshot). Otherwise, it falls back to a full snapshot. "Zero full resend" is conditioned on the same epoch and sufficient history.

## Safety rules (§21)

The client is untrusted; format obscurity is not security. The decoder validates lengths and
stops reading past the buffer (fail-closed for impossible messages). Authorization is done
per query/mutation on the server, not just at handshake.
