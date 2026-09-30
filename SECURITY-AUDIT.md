# Security — Raptor

The current state of the security model and of all findings. Three
rounds of audit, **25 findings**, all closed. Last review:
**2026-09-24 (round 3)**.

The audit reports, with the method and the proof-of-concepts:

- [`AUDIT-2026-09-24.md`](AUDIT-2026-09-24.md) — full audit (code, documentation,
  site content, native runtime). 24 packages + the Rust crate.
- The 2026-09-21 audit covered ~10 packages. Its findings are in the table
  below (#1–#3); the rest of the document has been absorbed here.

## The security surfaces, in brief

The project has **three** distinct boundaries. They are easily confused, and each has a different
level of maturity.

| Boundary | What it protects | State |
|---|---|---|
| **RaptorWire** (`wire-core`, `server`, `wire-client`) | local state against a peer on the wire | audited twice; the WebSocket transport verifies `Origin` since 2026-09-24 |
| **Capability broker** (`runtime`, `runtime-cli`) | the host system against application code | audited 2026-09-24; **on the bootstrap engine it is advisory**, see below |
| **The host bridge** (`host` + the six adapters) | the operating system against the application | contract + double verification; in the browser it provides portability, not isolation |

### The clarification that must not be lost

On the **bootstrap engine** (Node), the capability broker is **advisory, not
a boundary**. Application code can write `import fs from "node:fs"` and reach
the disk without the broker being consulted. The real boundary belongs to the native host
in Rust, where `node:*` simply does not exist.

Until then, the defense lives in the tooling, not in the engine:
`raptor-runtime doctor` reports every bypass, and `raptor-runtime run`
**refuses to start** under the `production` policy and writes the bypass to the
audit log under `development` (`packages/runtime-cli/src/bypass.ts`).

## Findings

| # | Finding | Severity | State | Regression |
|---|---|---|---|---|
| 1 | Prototype pollution when decoding data off the wire (CWE-1321) | Medium | ✅ fixed 2026-09-21 | `wire-core/tests/security.test.ts` |
| 2 | Prefix matching without a delimiter → exposure of neighboring handles | Medium | ✅ fixed 2026-09-21 | `server/tests/store.test.ts` |
| 3 | The client was not fail-closed on corrupt frames | Low | ✅ fixed 2026-09-21 | `wire-client/tests/client.test.ts` (added 2026-09-24) |
| S1 | `process.spawn`: `env` and `cwd` bypassed the broker → arbitrary code execution | **High** | ✅ fixed 2026-09-24 | `runtime/tests/escapes.test.ts` |
| S2 | `net.fetch` did not re-verify the destination after a redirect → SSRF | **High** | ✅ fixed 2026-09-24 | `runtime/tests/escapes.test.ts` |
| S3 | RaptorBundle dev-server: prefix without a delimiter + bind on all interfaces | Medium | ✅ fixed 2026-09-24 | `bundle/tests/dev-server-scope.test.ts` |
| S4 | `serve` opened ports without a capability, in TS and in Rust | Medium | ✅ fixed 2026-09-24 | `runtime/tests/escapes.test.ts`, `modules.rs` |
| S5 | The `node:` bypass was reported only by `doctor`, not by `run` | Medium | ✅ fixed 2026-09-24 | `runtime-cli/tests/bypass.test.ts` |
| S6 | Path containment is purely lexical (symlink) | Medium | ✅ fixed 2026-09-24 | `runtime/tests/symlinks.test.ts`, `paths.rs`, `capabilities.rs` |
| S7 | WebSocket without `Origin` verification, without a connection quota | Low-Medium | ✅ fixed 2026-09-24 | `server/tests/websocket-origin.test.ts` |
| S8 | `spawn`: unbounded buffers, stop without escalation | Low | ✅ fixed 2026-09-24 | `runtime/tests/escapes.test.ts` |
| S9 | `plain()` from the host bridge is shallow | Low | ✅ fixed 2026-09-24 | `host/tests/bridge.test.ts` |
| S10 | `@raptor/wire-client` has no tests at all | Low | ✅ fixed 2026-09-24 | 11 tests in `wire-client/tests/client.test.ts` |
| R1 | The anti-bypass gate is evaded with a computed `import()` | **High** | ✅ fixed (round 2) | `runtime-cli/tests/bypass.test.ts` |
| R2 | The bypass check was fail-open when the graph could not be built | Medium | ✅ fixed (round 2) | `runtime-cli/tests/bypass.test.ts` |
| R3 | The list of variables that load code was incomplete; `env.set` appeared | Medium | ✅ fixed (round 2) | `runtime/tests/escapes.test.ts` |
| R4 | `Authorization` / `Cookie` carried over to another host after a redirect | Medium | ✅ fixed (round 2) | `runtime/tests/escapes.test.ts` |
| R5 | Recursive `sanitize` without a depth limit | Low | ✅ fixed (round 2) | `host/tests/bridge.test.ts` |
| U7 | `javascript:` / `vbscript:` / `data:text/html` passed through in `href`, `src`, `formaction` | Medium | ✅ fixed (round 3) | `dom/tests/url-schemes.test.ts` |

### The three findings from 2026-09-21

**#1 — Prototype pollution on decode.** A `__proto__` key coming off the wire
was written with `obj[key] = value`, invoking the prototype setter. Fix: the
`setOwn()` helper (`wire-core/safe.ts`) via `Object.defineProperty` — always writes an
own property.

**#2 — Prefix matching without a delimiter.** `handle.startsWith(prefix)` without
a boundary: a query authorized on `"cpu"` also exposed `"cpuSecret"`. Fix: a prefix
exposes children only if it ends with a delimiter (`:`, `/`, `.`).

**#3 — Client was not fail-closed.** An invalid frame threw an uncaught
exception in a microtask. Fix: `try/catch` in `bindTransport`.

### The findings from 2026-09-24

The complete description, with the proof-of-concept for each, is in
[`AUDIT-2026-09-24.md`](AUDIT-2026-09-24.md) §1. In short, what changed in the code:

- **S1 + R3** — setting a child's environment requires the **`env.set`** capability,
  separate from `env.read` and empty by default: reading a variable tells you something,
  setting it for a child can change what code that child runs. On top of it,
  a blocklist of variables that load code (`NODE_OPTIONS`, `NODE_PATH`,
  `LD_*`, `DYLD_*`, `JAVA_TOOL_OPTIONS`, `CLASSPATH`, `RUBYOPT`, `PYTHON*`,
  `BASH_ENV`, `GIT_SSH_COMMAND`, `PATH`, …) rejected **even with `env.set`
  granted**. A `cwd` outside the project requires `files.read` on that path.
- **S2 + R4** — `redirect: "manual"` plus `broker.require` on every hop, with
  a hop limit; and on a hop to another destination it leaves without
  `Authorization`, `Cookie` and `Proxy-Authorization`. The native HTTP client did not
  follow redirects at all, so it was already correct.
- **S3** — segment-based containment (`resolveAsset`), path decoding, refusal on
  hidden files and on sources, `listen` defaulting to `127.0.0.1` with `--host`
  for explicit exposure.
- **S4** — `net.listen` entered the capability vocabulary, in TS and in
  Rust, with the `host:port` target matched by the same function as `net.connect`.
  The check is done **before** `bind`.
- **S5 + R1 + R2** — the rule lives in a single place (`runtime-cli/src/bypass.ts`)
  and both `doctor` and `run` use it. Its contract is not "the list of bypasses", but
  *what I know* and *what I cannot know*: an `import()` with a computed
  specifier, or a graph that cannot be built, means **the absence of a proof**, and in
  strict mode the absence of proof is not enough.
- **S8** — the child's streams are capped at 8 MB, with `truncated` in the
  result; `abort` escalates to SIGKILL after 2 s.

## What remains open

**No security findings.** All 18 are closed, each with a regression
test.

Still open, named in [`AUDIT-2026-09-24.md`](AUDIT-2026-09-24.md):
`@raptor/test` is the least tested package in the repo (R9); `parseCapsule`
validates two fields of a format designed as a shareable artifact (R10);
and `@raptor/ui` was checked on two axes — reactive leakage and injection
through `href` — but **not** on ARIA correctness, cleanup of global
listeners, or per-component keyboard navigation (round 3).

Separately from security, round 3 found **five correctness defects in the
compilation pillar** — three of them made the compiler emit code that
throws or that computes something other than what the source says. They are described in
the report (U1-U5) and have regressions in `engine/tests/optimizer-safety.test.ts`; they do
not appear in the table above because they are not security holes, but they hit
directly at the claim "adaptive strategies, not adaptive correctness".
What remains are the assumed limits below — which are choices, not oversights — and
a race that not even S6 fully closes, described just below.

### The lesson of the second round

The second pass looked specifically in **the fixes of the first**, and found five
findings there — including one (R1) that bypassed a fresh fix almost
completely. A fix is a claim about the code; claims are audited in
turn. Three of the five were in code written a day earlier.

### S6 — symlink, and what exactly was closed

`packages/runtime/src/paths.ts` and `crates/.../paths.rs` now have **two**
levels, with the same names on both sides:

- `containsPath` — purely lexical, does not touch the disk. For diagnostics and tests,
  where the answer must not depend on what exists on disk.
- `realPath` / `containsPathReal` — resolve the links. These are what the
  broker uses.

`realPath` works even for a path that **does not exist yet** — necessary,
because `files.write` decides about a file that is about to be created: it climbs to
the deepest parent that actually exists, resolves it, and glues back
the remaining segments. A write to `./date/link/nou.txt` thus ends up where
`open` ends up: through the link, not around it.

The scope is resolved as well, not just the target — otherwise on macOS, where `/tmp` is a
link to `/private/tmp`, access within one's own directory would be denied.

A refusal now also carries `resolved`: **where the path actually ended up**, when it differs
from the one requested. A log that shows only `./date/spre-parola` and not
`/tmp/secrete/parola.txt` tells the truth and yet is misleading.

**What is NOT closed: the TOCTOU race.** Between the check and the actual `open`,
whoever can write in the scope can replace a directory with a link. Closing it
completely requires `openat2(RESOLVE_BENEATH)` on Linux or its equivalent, which
Node does not expose. What was closed is the real case: a link **already present** in
the scope no longer takes access outside.

The tests build real links on disk. On Windows an ordinary symlink requires
Developer Mode, but a directory **junction** requires nothing and is resolved by
`realpath` the same way — so the main case is verified everywhere, while the one with
a link to a file is skipped with the reason written when it cannot be built.

### How the others were closed

**S7 — WebSocket.** `serveOverWebSocket` now verifies `Origin` before
`101`, defaulting to **same-origin only** (the authority from `Origin` compared with
`Host`, not the string). An explicit list of origins replaces it; `"any"`
disables the check, spelled out in letters so it does not happen by inattention. A
request without `Origin` passes — it does not come from a browser, so it carries no
ambient authority. Plus a connection cap (default 1024) that responds 503 instead
of hanging.

The rest of the RFC 6455 parser was already solid: mandatory mask, caps of 16 MB
per frame and per reassembled message, unknown opcode → close.

**S9 — `plain()`** now cleans recursively, including through arrays. The test verifies
not only that the keys disappeared, but also that an `Object.assign({}, …)` over any
sub-object does not touch the prototype — which was the real exploitation mechanism.

**S10 — `wire-client`** has 11 tests, written against a fake server that can
also send what an honest server would never send. Fix #3 (fail-closed)
finally has a regression, and the test also verifies that the session stays usable
after a dropped frame.

## Assumed limits, not bugs

- **No TLS**, anywhere: neither in the RaptorWire transport, nor in the native HTTP
  client (where `https://` passes the capability check and then **fails
  clearly**, instead of silently downgrading to `http`). TLS termination is done
  in front.
- **No rate limiting.** There is a cap on simultaneous connections on WebSocket
  (default 1024), but no rate limit: a client that reconnects in
  a loop remains the application's problem.
- **No schema validation on decode.** `SchemaCodec` is optional; the generic
  codec accepts any shape, so a mutation must validate its input.
- **`@raptor/ui` has not been reviewed for injection through props.** The only HTML
  sink in the library is `RichTextEditor`, which **does not sanitize** and says so
  both in the source and on its catalog page.
- **RAS is session-scoped**; the exact format of the identifiers remains open.
- **No penetration testing.**

## Standards verified (2026-09-24)

- **Zero external runtime dependencies** — measured, not asserted: `pnpm stats`
  counts the non-`@raptor/*` dependencies of the published packages and yields 0.
  `typescript`/`@types/node` are devDependencies.
- **No `eval` or `Function` constructor in `packages/*/src`.** They appear only in
  tests and in the site's Playground, which deliberately runs the code written by the
  visitor, in their own page.
- **System access, where it is:** 9 of 24 packages import
  `node:fs`/`http`/`net`/`child_process` — `bundle`, `engine`, `forge`,
  `profile`, `run`, `runtime`, `runtime-cli`, `server`, `service-host`. They are
  build tools and runtimes, not application libraries; the reactive core and the
  wire layer do not touch the system.
- **No secrets in the code.**
- **Determinism:** the reactive core does not use `Math.random` or the wall clock
   — which is what makes replay from RaptorTest possible.
- **Bounds:** `Reader` checks the buffer bounds, `varint` rejects values
  that are too large, WebSocket frames are capped at 16 MB, `VirtualClock` has
  `maxSteps`, RaptorTest exploration has `maxDepth`, and the streams of a child
  process are capped at 8 MB.
- **Authorization:** `authorize` hooks per query/mutation; operations go only
  server → client, so a client cannot inject state into another's replica.
