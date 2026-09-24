# RaptorWire v0.2 — specificație preliminară (așa cum e implementată)

Punct de pornire pentru implementarea reference codec, nu specificație finală
(whitepaper §31). Descrie exact formatul produs de [`@raptor/wire-core`](packages/wire-core).

## Primitive de codec (`@raptor/wire-codec`)

| Tip | Encoding |
|---|---|
| `u8` | 1 octet |
| `bool` | `u8` (0/1) |
| unsigned int | varint LEB128 (până la 2^53-1) |
| signed int | zig-zag → varint |
| `float64` | IEEE 754, little-endian, 8 octeți |
| `bytes` | `varint(len)` + octeți bruți |
| `string` | `bytes` cu conținut UTF-8 |

## Valori tagged (fallback generic, §12)

`u8(tag)` + payload: `0=NULL 1=FALSE 2=TRUE 3=INT(zigzag) 4=FLOAT(float64) 5=STRING 6=ARRAY(varint len + valori) 7=OBJECT(varint len + [string(cheie)+valoare]) 8=BYTES`.

## Adaptive encoding (§13.2, opțional)

`SchemaCodec` alege o reprezentare mai compactă când schema oferă constrângeri:
`percentage`→`u8`; `uint range`→`u8`/2 octeți/varint; `int range`→offset `u8`/2 octeți; `money(scale)`→scaled integer zig-zag; `enum`→index; altfel fallback.

## Opcodes de operație (§13)

`0x01 SET · 0x02 INC · 0x03 APPEND · 0x04 INSERT · 0x05 REMOVE · 0x06 MOVE · 0x07 PATCH · 0x08 CLEAR · 0x09 REPLACE`

Corpul unei operații (`writeOpBody`), după opcode + țintă:
- `SET`   `string(field) value`
- `INC`   `string(field) float64(delta)`
- `APPEND`/`REPLACE` `value`
- `INSERT` `varint(index) value`
- `REMOVE` `varint(index)`
- `MOVE`  `varint(from) varint(to)`
- `PATCH` `varint(n) [string(field) value]×n`
- `CLEAR` —

## Tipuri de frame (§31.2)

`0x01 HELLO · 0x02 WELCOME · 0x03 SCHEMA · 0x10 QUERY · 0x11 SNAPSHOT · 0x12 OPS · 0x13 ACK · 0x14 RESYNC · 0x20 MUTATION · 0x21 MUTATION_RESULT · 0x30 PING · 0x7F ERROR`

Fiecare frame = `u8(frameType)` + payload. Mesajele non-OPS: `encodeMessage`/`decodeMessage`.

- **HELLO** `varint(protocolVersion) string(clientBuild) varint(n)+string×n(capabilities) bool+string?(resumeToken) bool+varint?(lastAck)`
- **WELCOME** `string(sessionId) varint(epoch) string(serverBuild)`
- **QUERY** `varint(queryId) string(name) value(args) varint(sinceVersion)` — `sinceVersion>0` cere delta resync
- **SNAPSHOT** `varint(queryId) bytes(snapshot)` — snapshot = `varint(version) varint(count) [string(handle) value]×count`
- **ACK** `varint(queryId) varint(sequence)`
- **MUTATION** `varint(requestId) string(name) value(input)`
- **MUTATION_RESULT** `varint(requestId) bool(ok) value`
- **ERROR** `varint(code) string(message)`

## OPS pe Reactive Address Space (§5.2, hot path)

`encodeOpsFrame`/`decodeOpsFrame` — operațiile referă **adrese compacte**, nu handle-uri string.
Numele unui handle e trimis o singură dată, când adresa e introdusă (dicționar per frame).

```
u8(0x12 OPS)
varint(queryId)
varint(sequence)
varint(dictCount)  [ varint(address) string(handle) ] × dictCount   # doar adrese noi
bool(hasTx) varint(transactionId)?
bool(atomic)                                   # tranzacție de rețea → un singur DOM commit (§16.1)
varint(baseVersion) varint(resultVersion)
varint(opCount)
[ u8(opcode) varint(address) <opBody> ] × opCount
```

Address space = **session-scoped, per conexiune** (whitepaper §5.2: „session-scoped sau versionat; nu se reutilizează ambiguu"). La reconnect, sesiunea nouă renegociază adresele, dar starea (replica) e păstrată.

## Sesiune, secvențe, resync (§14)

- Fiecare subscription are numere de **secvență** monotone; clientul detectează găuri (`onGap`) și confirmă cu `ACK`.
- **Idempotență** (§14.2): `INC` nu e idempotent → batch-urile poartă `transactionId` pentru deduplicare.
- **Automatic delta resync** (§14.3): serverul ține un op-log. La reconnect cu `sinceVersion`, dacă istoricul acoperă continuu de la acea versiune, trimite **doar operațiile lipsă** (fără snapshot). Altfel, fallback la snapshot complet. „Zero full resend" e condiționat de aceeași epocă și istoric suficient.

## Reguli de siguranță (§21)

Clientul e neautorizat; obscuritatea formatului nu e securitate. Decoderul validează lungimi și
oprește citirea dincolo de buffer (fail-closed pentru mesaje imposibile). Autorizarea se face
per query/mutation pe server, nu doar la handshake.
