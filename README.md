# RaptorJS + RaptorWire + RaptorTest + RaptorEngine

[![npm](https://img.shields.io/npm/v/@raptorstack/raptorjs?logo=npm&label=%40raptorstack%2Fraptorjs)](https://www.npmjs.com/package/@raptorstack/raptorjs)
[![CI](https://github.com/cristibcf/raptorjs/actions/workflows/ci.yml/badge.svg)](https://github.com/cristibcf/raptorjs/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@raptorstack/raptorjs)](LICENSE)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen)](#run-it-now-zero-build-zero-runtime-dependencies)

MVP implementation of the Raptor ecosystem described in the whitepapers under [`design/`](design/).
Four pillars: **execution**, **communication**, **verification**, **compilation/build**.

- **RaptorJS** — a compiler-centric TypeScript framework/compiler with **fine-grained reactivity** (signals): a state change propagates directly to the affected DOM binding, with no Virtual DOM and no component re-render. *(execution)*
- **RaptorWire** — a **state-aware** binary protocol: after the initial snapshot, the network carries **semantic operations** (`SET`, `INC`, `APPEND`, `PATCH`, `MOVE`, ...) over a known base state, not re-serialized documents. *(communication)*
- **RaptorTest** — **autonomous** behavioral testing + a digital-twin backend: it discovers the application's behavior on its own, synthesizes a stateful fake backend, and explores the state space (observe → infer → synthesize → explore → verify → replay). *(verification)*
- **RaptorEngine** — the **semantic-aware** build/dev/runtime platform: it parses `.raptor` into a **Raptor IR** with stable IDs, builds a **Semantic Application Graph** and optimizes over it (Dead Signal Elimination, Dependency Fusion), generates **browser + server + wire from a single graph**, with **Stateful Reactive HMR** (state-preserving patch) and reproducible caching. *(compilation/build)*

> Thesis (whitepaper §1): the advantage does not come from a performance trick, but from **eliminating redundant work** between the compiler, runtime, serialization, cache and UI — because every layer knows the same schema and the same state graph.

Direction for v0.2: **reactive end-to-end** — `DB → reactive query → server signal → RaptorWire op → client signal → DOM binding`.

## Install from npm

The six packages are published under the [`@raptorstack`](https://www.npmjs.com/org/raptorstack) scope (**0 runtime dependencies**):

```bash
npm install @raptorstack/raptorjs     # reactivity + DOM + UI (the framework)
npm install @raptorstack/wire         # state-aware binary protocol
npm install @raptorstack/host         # host contract + platform adapters
npm install -D @raptorstack/engine    # compiler, bundler, dev/server runtime (CLI: raptor, raptor-create, …)
npm install -D @raptorstack/runtime   # runtime contracts + launcher (CLI: raptor-runtime)
npm install -D @raptorstack/test      # autonomous behavioral testing
```

A minimal counter — fine-grained, no Virtual DOM:

```ts
import { state, derived, render } from "@raptorstack/raptorjs";
import { R } from "@raptorstack/raptorjs/dom";

function Counter() {
  const count = state(0);
  const doubled = derived(() => count() * 2);
  return R.button({ "on:click": () => count.update((n) => n + 1) }, () => `${count()} · doubled ${doubled()}`);
}

render(Counter, document.getElementById("app")!);
```

Subpaths expose the internal granularity: `@raptorstack/raptorjs/dom`, `@raptorstack/raptorjs/ui` (components), `@raptorstack/wire/client`, `@raptorstack/wire/server`, `@raptorstack/engine/bundle`, `@raptorstack/host/web`, … — see the [package table](#architecture-monorepo) below.

## Run it now (zero build, zero runtime dependencies)

Everything runs directly on **Node ≥ 22** (native TypeScript via type-stripping). No bundler is needed for the demos or tests.

```bash
pnpm install          # only links the workspace (+ optional devDeps)
pnpm test             # 875 tests
pnpm typecheck        # tsc --noEmit over everything

pnpm demo:counter     # fine-grained DOM bindings (headless)
pnpm demo:dashboard   # end-to-end MVP: server ↔ RaptorWire ↔ client ↔ DOM
pnpm demo:chat        # state shared between 2 clients (APPEND/PATCH/REMOVE)
pnpm demo:raptortest  # autonomously discovers bugs (stale-read RT-184 + fault)
pnpm demo:engine      # RaptorEngine: .raptor → IR → optimize → codegen → HMR
pnpm demo:run         # RaptorRun: SSR + server signal ↔ RaptorWire ↔ reactive client
pnpm demo:profile     # RaptorProfile: telemetry → PGO plan → profile-guided rebuild
pnpm demo:desktop     # a RaptorJS app inside a native desktop host (capability bridge)
pnpm demo:mobile      # the same app inside a mobile host: navigation comes from the adapter
pnpm demo:web-host    # the same app with the browser acting as the host (headless)
pnpm demo:service     # the same app as an HTTP service: sockets, config, drain on SIGTERM
pnpm demo:cli         # the same app as a CLI tool: argv, TTY, confirmations, exit codes
pnpm demo:device      # on a board: declared pins and buses, sleep, a watchdog that resets
```

The `raptor` CLI (RaptorEngine whitepaper §5, Appendix A):

```bash
pnpm raptor build   examples/raptorengine-app/src/App.raptor --report
pnpm raptor inspect graph examples/raptorengine-app/src/App.raptor
pnpm raptor analyze examples/raptorengine-app/src/App.raptor
pnpm raptor:run info examples/raptorengine-app/src/App.raptor    # RaptorRun (server runtime)
pnpm raptor:run ssr  examples/raptorengine-app/src/App.raptor    # SSR HTML
pnpm raptor toolchain                                            # detects Rolldown/Oxc
pnpm raptor:dev examples/raptorengine-app/src/App.raptor         # live server: fs.watch → HMR (SSE)
```

**RaptorRuntime** — an application runtime with declared capabilities, and a native binary that runs
JavaScript and TypeScript **without Node installed**:

```bash
pnpm raptor:runtime init exemplu-app      # new project with raptor.runtime.json
pnpm raptor:runtime doctor                # manifest, policies, static graph, broker bypasses
pnpm raptor:runtime run                   # runs with the declared capabilities
pnpm raptor:runtime pack                  # reproducible unit with a lockfile

pnpm native -- build --features full      # the Rust binary (via WSL, see the environment note)
pnpm native:test                          # the Rust tests (default and with all features)
```

What it denies, concretely: with `files.read: ["./src"]` in the manifest, a read from `./src` succeeds, while one
from `../../package.json` gets `raptor:capability/denied` — even though the file exists on disk.
With `--policy production`, an `import` of `node:fs` **stops startup**, because on the bootstrap
engine it would bypass the broker entirely (see [SECURITY-AUDIT.md](SECURITY-AUDIT.md)).

New projects, for the web and for native hosts (see [`docs/NATIVE-HOSTS.md`](docs/NATIVE-HOSTS.md)):

```bash
pnpm raptor:create targets                                       # web, desktop, mobile
pnpm raptor:create "Notes Desk" --target desktop --bundle-id com.exemplu.notite
```

The low-level **Rolldown/Oxc** engine is optional (whitepaper §37 "progressive ownership"): it is not a
workspace dependency, it is detected dynamically at runtime, and without it the build falls back gracefully to the
naive zero-dep engine. The real integration (isolated, like `benchmarks/`) is verified with:

```bash
cd integrations/rolldown && npm install && npm run verify
# semantic RaptorEngine → Rolldown bundle → Oxc minify (e.g. 955B naive → 463B minified)
```

Example output from `demo:dashboard` (numbers **measured from the run**, not marketing — whitepaper P8 / §25.2):

```
tick 1: RaptorWire 39B  |  JSON full-resend 123B
...
Reduction: 68.3%
reconnect: 0 new snapshots, cpu recovered via delta   (automatic delta resync)
Repeated field names on the hot path: 0 (Reactive Address Space)
```

### Browser variants (TSX, via RaptorBundle — no Vite)

`examples/counter` and `examples/realtime-dashboard` also have a `.tsx` variant that uses the
developer API from whitepaper §9 (JSX + `on:click` + `{signal}`), compiled by
**RaptorBundle**, the project's own zero-dep bundler (not Vite/esbuild):

```bash
pnpm dev:counter      # or: cd examples/counter && pnpm dev  (live-reload, :5173)
pnpm dev:dashboard    # realtime dashboard in the browser
pnpm dev:web-shell    # web-shell in a real browser: History API, localStorage, notifications
cd examples/counter && pnpm build   # emits dist/bundle.js + dist/index.html (static)
```

## Architecture (monorepo)

| Package | Role | Whitepaper |
|---|---|---|
| [`@raptorstack/raptorjs`](packages/raptorjs) | **Application framework** (reactivity + DOM + UI). Root: `state`, `derived`, `effect`, `batch`, `untracked`, ownership — glitch-free graph, lazy memo, eager effects. **`@raptorstack/raptorjs/dom`**: fine-grained DOM runtime + **jsx-runtime**, keyed `For`, `Show`, `R` hyperscript, headless mini-DOM (`@raptorstack/raptorjs/dom/testing`). **`@raptorstack/raptorjs/ui`**: a component library over the fine-grained bindings — **198 implemented** (the site catalog has **211 catalog entries**), layout/typography, forms, overlay, data (virtualized `DataGrid`, `TreeView`, `Kanban`), **15 chart types**, editors, media (own `QRCode`), 19 headless primitives; separate styles, **36 entry points**. Zero dependencies. See [UI ROADMAP](packages/raptorjs/src/ui/ROADMAP.md). | §6, §7, §9 |
| [`@raptorstack/wire`](packages/wire) | **RaptorWire** (state-aware binary protocol). Root: opcodes, versioned `Document`, snapshot, message protocol, **Reactive Address Space**, **adaptive encoding**. **`/codec`**: varint, zig-zag, float64, length-prefixed string/bytes primitives. **`/server`**: authoritative reactive store SDK, `query`/`mutation`/subscription, snapshot+delta, op-log, own WebSocket server (RFC 6455). **`/client`**: session, reactive replica (each handle = one signal), loopback + WebSocket transports, reconnect with delta resync. | §11–17, §24, §31 |
| [`@raptorstack/engine`](packages/engine) | **RaptorEngine**. Root: optimizer (DSE, Fusion), browser/server/wire codegen, Stateful Reactive HMR, reproducible caching, build manifest, `raptor` CLI. **`/compiler`**: `.raptor` parser, **Raptor IR**, Semantic Application Graph, graph diff. **`/bundle`**: **RaptorBundle** — own TSX/ESM bundler, tree-shaking on ESM source, dev server (`raptor-bundle`). **`/run`**: **RaptorRun** — server runtime, routing + SSR/resume (`raptor-run`). **`/profile`**: **RaptorProfile** — PGO, strategy hints (`raptor-profile`). **`/forge`**: **RaptorForge** — project generator (`raptor-create`). | RaptorEngine §5–§24, §34 |
| [`@raptorstack/runtime`](packages/runtime) | **RaptorRuntime**. Root: an application runtime with **capabilities as a product function**, the `raptor:` namespace (`files`, `net`, `serve`, `process`, `kv`, `observe`, `capabilities`, `tasks`), a capability broker with a target per path / `host:port` / variable / command, explicit revocation and delegation, a task factory with deadlines, structured observability, an engine adapter. **`/cli`**: the `raptor-runtime` launcher — `init`, `run`, `doctor`, `test`, `pack` (reproducible unit), `trace` (OpenTelemetry). On the bootstrap engine the broker is **advisory** — see [SECURITY-AUDIT](SECURITY-AUDIT.md). | RaptorRuntime §4–§8 |
| [`@raptorstack/host`](packages/host) | **The host contract + platform adapters**. Root: the capability matrix, the `raptor.host.json` manifest, the JS↔host bridge (correlated requests + events), the lifecycle machine and the packaging plan. **`/web`** (History/`localStorage`/Notification/Geolocation), **`/desktop`** (WebView2/WKWebView/WebKitGTK, menus, deep links, msi/nsis/dmg/deb/AppImage installers), **`/mobile`** (Android/iOS, secure storage, optional native modules), **`/service`** (supervisor, listening sockets, SIGTERM **drain**), **`/cli`** (terminal, confirmation refusal with no TTY), **`/device`** (firmware, declared pins, OTA with rollback, **watchdog**). | Roadmap §3–§8 |
| [`@raptorstack/test`](packages/test) | **RaptorTest**: VirtualClock, RaptorProbe, Semantic UI, Behavior Graph, RaptorTwin (digital-twin backend), Explorer, Oracle, Chaos, Replay, Coverage. | RaptorTest §6–§21 |
| [`packages/runtime-native`](packages/runtime-native) | **The native binary, in Rust** (not published to npm): runs JavaScript **and TypeScript without Node installed**. QuickJS engine (`--features quickjs`), TypeScript transformed with oxc (`--features typescript`), the `raptor:` modules as native functions, own HTTP/1.1 over `std::net`. Default build is **zero dependencies** (964 KB); full build 4.4 MB. See the [environment note](#notes). | RaptorRuntime §3, §13 |

Examples: [`counter`](examples/counter), [`realtime-dashboard`](examples/realtime-dashboard) (headline MVP), [`chat`](examples/chat), [`raptortest-crud`](examples/raptortest-crud) (autonomous bug discovery), [`raptorengine-app`](examples/raptorengine-app) (end-to-end compilation: `.raptor` → code that runs on the real runtime), [`site`](examples/site) (**a presentation + documentation site built WITH the Raptor stack**: RaptorJS UI, a RaptorWire realtime demo in the page, compiled with RaptorBundle — `pnpm dev:site`), [`desktop-shell`](examples/desktop-shell) (**a RaptorJS app running inside a native desktop host**: window, menu, local storage, deep links and notifications, all through the capability bridge — `pnpm demo:desktop`), [`mobile-shell`](examples/mobile-shell) (**the same app, a mobile host**: adapter-driven navigation, secure storage, suspend and resume, optional native modules — `pnpm demo:mobile`), [`web-shell`](examples/web-shell) (**the same app a third time, with the browser acting as the host**: History API and the back button, `localStorage`, notifications with permission — `pnpm dev:web-shell`), [`service-shell`](examples/service-shell) (**a fourth time, as an HTTP service**: a real `node:http` server, configuration from the supervisor, clean drain — `pnpm demo:service`), [`cli-shell`](examples/cli-shell) (**a fifth time, as a command-line tool**: `raptor-notes add/list/clear`, refusing to confirm when there is no terminal — `pnpm demo:cli`), [`device-shell`](examples/device-shell) (**a sixth time, on a board**: a sensor logger with an LED, I2C, sleep between reads and a watchdog — `pnpm demo:device`), [`native-hello`](examples/native-hello) (**TypeScript run by the native binary**, without Node and without tsc: types, generics, interfaces — plus proof that a capability denial really blocks a file that exists), [`native-server`](examples/native-server) (**an HTTP server written in TypeScript that answers a real `curl`**, on the native binary).

> `@raptorstack/test` maps the package structure from the RaptorTest whitepaper (§32: probe, semantic-ui, behavior-graph, twin-core, explorer, oracle, chaos, replay, coverage) into a single package, as submodules.

## What it demonstrates (mapped to the whitepaper)

**RaptorJS — fine-grained (§6):** a click updates **exactly** one text node; zero elements
recreated, zero components re-executed. `For` reuses nodes on reorder (minimal moves).
Verified through `mini-dom`, which counts every mutation (see `demo:counter` and the dom tests).

**RaptorWire — state-aware (§13):** delta operations over a versioned `Document`. The thesis test shows
that an `INC` on a field is >10× smaller than re-serializing the object as JSON.

**End-to-end MVP (§28, M1–M8):** `realtime-dashboard` ties it all together: handshake → snapshot →
versioned delta operations → client signals → exact DOM binding, with byte measurement.

**RaptorTest — autonomous verification (RaptorTest §4, §28, §31):** `demo:raptortest` runs the
`observe → infer → synthesize → explore → verify → replay` cycle over a CRUD cart application, **with no
hand-written tests**. It discovers action sequences on its own (coverage-guided BFS), synthesizes
a stateful digital-twin backend, injects network scenarios (RaptorChaos) and checks invariants
(RaptorOracle). It autonomously finds:
- the **stale-read bug RT-184** (Appendix A): `Add to cart` → immediate navigation → a delayed `GET /cart` overwrites the UI with the old state (UI shows 0, the server has 1). Minimized to 2 actions, reproduced deterministically from a `.raptorcap` capsule.
- a **robustness bug**: on `POST 500`, the application blindly reads `.count` from an error response.

Everything is deterministic through **virtual time** (`VirtualClock` = a discrete event scheduler): the same
capsule produces exactly the same execution (whitepaper §14, §20).

### New in v0.2

| Feature | Where | Whitepaper |
|---|---|---|
| **Reactive Address Space** — compact, session-scoped IDs on the hot path (a field name sent only once) | `AddressBook`, `encodeOpsFrame`/`decodeOpsFrame` | §5.2, §5.3 |
| **Network transaction / single DOM commit** — an atomic batch applied with a single UI commit | `atomic` flag on `OpsBatch`, `batch()` on the client | §5.4, §16.1 |
| **Automatic delta resync** — reconnect without full resend (op-log + `resume(sinceVersion)`) | `ReactiveStore.resyncSince`, `RaptorClient.resume` | §14.3 |
| **Adaptive encoding** — schema-aware codec (percentage→1B, money→scaled int, enum→index) | `SchemaCodec` | §13.2 |
| **Performance budgets** — verified as tests (0 repeated field names, 1 atomic commit/frame, 0 snapshots on eligible reconnect) | `examples/realtime-dashboard/tests/v2.test.ts` | §25.2 |

### RaptorEngine (separate whitepaper: `RaptorEngine_Build_Runtime_Platform`)

The fourth pillar: the build/dev/runtime platform that **owns the application's semantics**, not just the
modules. The low-level engine (bundling/minify) remains a swappable adapter behind a small
interface (§37 "progressive ownership") — in v0.1 it is a naive engine; the thesis is that the
valuable optimization is done on the **semantic graph**, something a generic bundler cannot do.

| Capability | Where | Whitepaper |
|---|---|---|
| **Raptor IR + stable IDs** — the component decomposed into signals/deriveds/bindings/effects/wire, serializable for caching | `@raptorstack/engine/compiler` `ir.ts`, `parser.ts`, `expr.ts` | §7, Appendix C |
| **Semantic Application Graph** — module→component→signal→derived→DOM binding, serverSignal→schema→RAS | `graph.ts` (`buildGraph`, liveness) | §8 |
| **Dead Signal Elimination** — removes reactives with no path to an observable output (not just textually unused variables) | `@raptorstack/engine` `optimize.ts` (`runDSE`) | §14.1 |
| **Dependency Fusion** — collapses a derived with a single consumer; **blocked at `@debug`** | `optimize.ts` (`fuseComponent`) | §14.2, §24 |
| **Multi-target codegen from one graph** — browser (runs on `@raptorstack/raptorjs`+`@raptorstack/raptorjs/dom`), server producers, wire schema + RAS manifest | `codegen.ts` | §9, §15 |
| **Stateful Reactive HMR** — graph diff → state-preserving patch; explicit fallback to remount with a reason | `@raptorstack/engine/compiler` `diff.ts`, `@raptorstack/engine` `dev.ts` | §11, §12 |
| **Reproducible caching** — cache key = source + compiler version + profile + target + schema compat | `cache.ts`, `manifest.ts` (Appendix B) | §21 |
| **Build profiles + chunking** — `realtime` isolates components with server signals into a separate chunk | `config.ts`, `build.ts` | §16, §18 |
| **Inspect/analyze** — graph dump, invalidation trace (blast radius), optimization trace | `inspect.ts`, CLI `raptor inspect/analyze` | §12, §27, §5 |
| **RaptorRun** — server runtime: `serverSignal`→store→RaptorWire→client, SSR/resume, sessions, observability, real Node HTTP target + memory | `@raptorstack/engine/run` `runtime.ts`, `ssr.ts`, `router.ts`, `node.ts` | §19–§21 |
| **RaptorDev live server** — `fs.watch` → incremental recompilation → diff → HMR push via SSE + SSR refresh; HMR client that swaps on `#raptor-root` | `@raptorstack/engine/run` `dev-server.ts`, CLI `raptor:dev` | §10–§12 |
| **RaptorProfile** — technical telemetry + PGO build planner; **adaptive strategies, not adaptive correctness** (§24): what does not appear in the profile is kept, not removed | `@raptorstack/engine/profile` `collector.ts`, `scenario.ts`, `planner.ts` | §22–§24 |
| **Rolldown/Oxc** — a real low-level engine through the `LowLevelEngine` seam (bundle + tree-shake + minify), detected dynamically, optional, naive zero-dep fallback | `@raptorstack/engine` `lowlevel.ts`, `buildModuleAsync`, `integrations/rolldown` | §2, §37 |

**Demonstrated end-to-end** (`examples/raptorengine-app`): the `.raptor` source is compiled, and the
generated browser code **runs on the real runtime** (mini-dom), with verified fine-grained updates
(0 elements recreated on click). DSE removes `unused`, Fusion collapses `label`, `price` becomes a
RAS address `0x18A1` with a `money` schema — all from a single graph. **RaptorRun** (`pnpm demo:run`)
closes the loop: the same graph → SSR on the server (with the live value of `price`) + a RaptorWire client that
reactively tracks the updates produced by the server (`produce("BTC.price", …)` → client signal), plus a
real Node HTTP server tested with `fetch`.

## Status

A prototype per whitepaper §0: proposed architecture, not a product. All the performance targets
are **design budgets validated experimentally**, not marketing comparisons. The wire numbers are
measured locally; the comparisons with React/Preact/Solid are in [`benchmarks/`](benchmarks) — including
the signals microbenchmark, **where RaptorJS loses** to `@preact/signals-core`.
See [`SPEC-RaptorWire-v0.2.md`](SPEC-RaptorWire-v0.2.md).

### Notes

- **Zero runtime dependencies.** `typescript`/`@types/node` are only for typecheck and for
  the build transform of `@raptorstack/engine/bundle`. The production code of the packages imports nothing external.
  **There is no Vite/esbuild** in the dependency graph: the browser variant is compiled by `@raptorstack/engine/bundle`.
- **Rolldown/Oxc are optional** and isolated in `integrations/rolldown` (outside the pnpm workspace, like
  `benchmarks/`), detected dynamically at runtime. The `@raptorstack/*` packages stay zero-dep; `raptor build`
  falls back gracefully to the naive engine when they are not installed (whitepaper §37).
- For the browser variants: `pnpm dev:counter` / `pnpm dev:dashboard` (RaptorBundle dev server with
  live-reload) or `pnpm build` in the example's directory (emits a static `dist/bundle.js`). No external toolchain.
- Code convention: **erasable TS syntax** (no `enum`/runtime-`namespace`/parameter properties)
  so it runs natively on Node. The native binary accepts a **superset**: oxc also transforms `enum`/`namespace`,
  so code that works natively may not work under `node --experimental-strip-types`.
- **The Rust build on Windows**: `rustc.exe` won't start when **Smart App Control** is enabled
  (`0xC0E90002`, while loading `rustc_driver-*.dll`). `cargo.exe` works, which is misleading.
  Reinstalling the toolchain does not fix it. The workaround used here: build in **WSL2 Ubuntu**, via
  `pnpm native` / `pnpm native:test`. Do **not** disable Smart App Control — it is irreversible without
  a Windows reinstall.

### What is NOT done (so it isn't presented as done)

- **An event loop and promises in the native binary.** Without them there is no async `fetch` and no
  `serve({ fetch })` form; the accept loop belongs to the application, deliberately and by documentation.
- **TLS**, anywhere. `https://` passes the capability check and then fails clearly, instead of
  silently downgrading to `http`.
- **`tasks`, `test` and `trace` wired to the native isolate** — they exist in the TS runtime, they are `pending` in the native one.
- **The full native shell** (WebView2/WKWebView/WebKitGTK + launcher) and the `raptor-package` command.
  Without them, the criterion "start a windowed app without Node installed" is not met — even though
  the *binary* already runs JS and TS without Node.
- **Minify in `@raptorstack/engine/bundle`.** For that there is the optional Rolldown/Oxc path.
- **The TOCTOU race in path checking.** The container now follows symbolic links, so a link
  already present in the granted scope no longer leaks access out — but between the check and `open`, someone
  who can write into the scope can replace a directory with a link. Closing this fully requires
  `openat2(RESOLVE_BENEATH)`, which Node does not expose. See [SECURITY-AUDIT.md](SECURITY-AUDIT.md).

## License

MIT — see [LICENSE](LICENSE).
