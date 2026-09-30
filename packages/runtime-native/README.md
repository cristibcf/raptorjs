# RaptorRuntime — native host

The `raptor-runtime` binary, written in Rust. This is where §3 stage 1 of the
roadmap is met: **it starts without Node.js installed**.

## What runs now

| Command | Without engine (default) | With `--features quickjs` |
|---|---|---|
| `doctor` | native | native |
| `init`, `pack`, `explain` | native | native |
| `run` | exit 3: "not in this milestone" | **executes the module** |
| `test`, `trace` | exit 3 | exit 3 |

## Build

```bash
cargo build --release --features full
```

| Feature | What it adds | Binary |
|---|---|---|
| (default) | `doctor`, `init`, `pack`, `explain`, HTTP — **zero dependencies** | 964 KB |
| `quickjs` | evaluation of JavaScript modules | 2.1 MB |
| `typescript` | type stripping, via oxc | — |
| `full` | both — the runtime that can take the place of `node` | 4.4 MB |

The default build has **no** external dependency (`cargo tree` shows only the
two local crates): the §12 requirement of a license and vulnerability review
for every native dependency is passed in the cheapest way. The engine and the
stripper are the only exceptions, and they are opt-in.

## Verification: does it really run without Node?

```bash
cargo build --release --features quickjs
./target/release/raptor-runtime run --cwd ../../examples/native-hello
```

In an environment with no Node installed (verified in WSL Ubuntu, `which node` empty):

```
aplicatia a rulat in 13.7ms
  proiect    native-hello@0.1.0
  motor      quickjs
  exporturi  default, izolat, motorChiarRuleaza, rezultat, runtime
```

`--json` shows the exports read from the module — proof that it was **evaluated**, not
just parsed:

```json
{
  "rezultat": "suma(1+2+3+4+5) = 15",
  "runtime": "raptor:observe",
  "motorChiarRuleaza": true
}
```

## Why QuickJS before V8

Spec §13 requires V8 "through a narrow adapter", and that remains the target. But
the adapter (`engine.rs`) exists precisely so that the engine can be swapped without
touching anything in the applications. QuickJS compiles from C source in ~60s and gives a
2.1 MB binary, so it proves independence from Node **now**; V8 comes in
later through the same door.

The isolate lives on **its own thread** and receives commands over a channel. It's not a
workaround: `rquickjs::Runtime` cannot be shared between threads, and `EngineAdapter`
requires `Send + Sync`. The solution is not an `unsafe impl` — it's the correct
architecture; an isolate really does belong to a single thread.

## The `raptor:` modules are native functions

`HostModule` now carries constants **and functions**: every call from JavaScript
comes back into Rust, goes through the **capability broker** and only then touches the disk
or the environment. Here the security model stops being a declaration:

| Module | State |
|---|---|
| `observe` | `log`, `metric` — no capability (own telemetry is not external access) |
| `files` | `readText`, `write`, `exists`, `list` — each through the broker |
| `process` | `args`, `platform`, `env` (through `env.read`) |
| `kv` | `get`, `set`, `delete`, `keys` |
| `capabilities` | `check`, `diagnostics` — the app asks without trying |
| `net` | `fetch`, `allows` — through `net.connect`; own HTTP/1.1, without TLS |
| `serve` | `listen`, `next`, `respond`, `status`, `close` — real HTTP server |
| `tasks` | honestly reports that it is not implemented |

Run on `examples/native-hello`, with `files.read` declared only for `./src`:

```json
{
  "octetiCititi": 1449,
  "fisiereInSrc": ["main.js"],
  "refuzInAfaraDomeniului": "raptor:capability/denied",
  "potCiti": true,
  "potScrie": false
}
```

The broker's audit trail, from the same run:

```
files.read  src          -> PERMIS
files.read  main.js      -> PERMIS
files.read  package.json -> REFUZAT
files.write nou.txt      -> REFUZAT
```

The denied file **exists on disk** — so if the denial didn't work, the read would
succeed. Raptor errors cross the boundary as JavaScript exceptions with the same code,
so the app can tell "you're not allowed" from "I couldn't".

## TypeScript run natively

`.ts` and `.tsx` go through **oxc** — the same toolchain already used by
`integrations/rolldown` on the JavaScript side — before reaching the engine.
Pipeline: parser → semantic → transformer → codegen.

Why not a stripper with regular expressions: `a < b > c` is a comparison,
`f<T>(c)` is a generic call, and the difference is visible only with a real parser.
There is an exact test for this case.

Verified on a real `.ts`, with interfaces, aliases, generics (`primul<T>`),
`!` and `as` — in an environment without Node **and without `tsc`**:

```
motor    quickjs, cu TypeScript
aplicatia a rulat in 24.7ms
```

What it does **not** do: it doesn't type-check and it doesn't lower modern
syntax. Type checking remains `tsc`'s job at development time — the runtime executes, it
doesn't judge.

One difference from Node is worth knowing: Node accepts only **erasable syntax**
(no `enum`, `namespace`, parameter properties). oxc transforms all of them, so the
native binary accepts a superset. Code that works here may not work under
`node --experimental-strip-types`.

## A Raptor server, native

§3 stage 3 — *"An example Raptor server runs on the native runtime"*.
[`examples/native-server`](../../examples/native-server) is clean TypeScript,
run by the binary, without Node and without `tsc`. Real `curl` requests:

```
{"status":"ok","note":0}                    <- 200
{"salvate":1}                               <- 201
[{"text":"prima nota"},{"text":"a doua"}]   <- 200
{"eroare":"campul 'text' este obligatoriu"} <- 400
```

**The accept loop belongs to the application**, and that is a direct consequence of the
synchronous engine — we cannot hold a JavaScript function as a handler and call it
from another thread without an event loop:

```ts
const server = serve.listen({ port: 8787 });
const cerere = serve.next({ timeoutMs: 5000 });   // null = no request
if (cerere) serve.respond(cerere.id, { status: 200, body: "salut" });
```

The `serve({ fetch })` form from the TypeScript runtime arrives together with the event
loop; the contract there does not change, it is added on top of this.

The accept thread lives beside the isolate, not in it: a connection waits for the
application's response and gets a 504 if it doesn't come within 30s, instead of hanging.

### Limits of the HTTP stack

Written on top of `std::net`, without dependencies. What it **does not** have, and says so explicitly:

- **TLS.** `https://` passes the capability check (the destination is correct)
  and then fails cleanly. A client that silently downgraded to `http://` would be a
  security hole, not a convenience.
- **`transfer-encoding: chunked`** — refused, not silently truncated.
- HTTP/2, keep-alive, bodies over 8 MB.

## What's missing

1. **Event loop and promises** — would bring asynchronous `fetch` and
   `serve({ fetch })`.
2. **TLS**, for `https`.
3. **`tasks`** — the task fabric exists natively, but is not yet wired to the isolate.
4. **`test` and `trace`** wait on the points above.

## Environment note (Windows)

On this machine `rustc.exe` is blocked while loading the DLL
(`0xC0E90002`) by Smart App Control + Bitdefender; `cargo.exe` starts, `rustc`
doesn't. The build was done in **WSL2 Ubuntu**, where the toolchain is clean. See
the section in `docs/NATIVE-HOSTS.md`.
