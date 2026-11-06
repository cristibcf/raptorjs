# Changelog

All notable changes to the `@raptorstack/*` packages are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

All six packages are versioned in lockstep (`@raptorstack/raptorjs`, `/wire`,
`/engine`, `/runtime`, `/host`, `/test`), so one version number covers the set.

> **Alpha.** Nothing here is production-ready yet. The API can still change
> between alpha releases.

## [Unreleased]

Six gaps a real application hit against 0.2.0. **Everything here is additive
and backwards compatible**: an existing consumer upgrades without touching a
line, and all six packages still have zero runtime dependencies.

### Added
- **`@raptorstack/wire/server` — per-connection sessions.** `QueryContext` and
  `MutationContext` now carry `session` and `conn`;
  `raptorServer<TSession>({ onConnect })` establishes the session once per
  connection, before anything is served. New
  `ServerConnection.handshake?: ConnectionHandshake` (`url`, `headers`,
  `remoteAddress`), filled by `serveOverWebSocket` from the upgrade request, so
  a cookie or bearer token is still reachable when the first frame arrives.
  - *Backwards compatible.* `TSession` defaults to `undefined`, so a server
    that declares no `onConnect` keeps the 0.2.0 context shape, keeps its
    synchronous timing, and keeps serving a query that arrives before HELLO.
    Declaring `onConnect` is what turns the gate on.
  - *Wire format unchanged.* Only the existing HELLO/WELCOME/ERROR vocabulary
    is used; `SPEC-RaptorWire-v0.2.md` gains a "Session establishment"
    subsection describing the codes (401 for no session, 400 for a second
    HELLO) and saying explicitly that framing did not change.
- **`@raptorstack/wire/server` — awaited mutations.** `MutationDef.run` may
  return `WireValue | Promise<WireValue>`, so a short I/O-bound command can
  return a validated result or report failure instead of being pushed into
  enqueue-and-report-deltas. A rejected `run` answers
  `MUTATION_RESULT ok: false`. Two mutations arriving in order on one
  connection cannot interleave their store writes. A synchronous `run` is still
  one atomic frame; an async `run` is wrapped only up to its first `await`, so
  group post-I/O writes in `store.transaction()` yourself. `authorize` stays
  synchronous.
  - *Backwards compatible* (a widened return type). *Wire format unchanged.*
- **`@raptorstack/engine/bundle` — a browser bundle is no longer resolved like
  Node.** `BundleOptions.platform` (`"browser"` by default, or `"node"`) and
  `raptor-bundle build --platform browser|node`; `classifySpecifier` and
  `resolveSpecifier` take `{ conditions }`, with `BROWSER_CONDITIONS` and
  `NODE_CONDITIONS` exported.
  - **Fixes a blocker.** Bare specifiers went through
    `createRequire().resolve()`, which is Node's CJS resolver: it applies the
    `node` and `require` conditions and there is no API to tell it otherwise.
    Any dependency publishing a `node` branch therefore had its **Node build**
    packed into the browser bundle. With `@firebase/firestore` that pulled in
    `@grpc/grpc-js` and `protobufjs`, whose `require("net")` / `require("http2")`
    / `require("tls")` reached the browser as `modules["net"]` — `undefined` —
    and the page died inside the loader with "Cannot read properties of
    undefined (reading 'call')", after a build that reported success.
  - Bare specifiers are now resolved here, against the package's own `exports`
    map, asking for `browser`/`module`/`import`/`default` in **our** priority
    order rather than the order the map happens to list (Firebase lists `node`
    first). The legacy top-level `browser` field is honoured too, as a
    replacement for `main` and as a per-file redirect, since many older
    packages give only that. Node's resolver remains the last-resort fallback
    for layouts this does not model.
  - A Node builtin reached from a browser graph is now a **build error naming
    the importer and the specifier**, instead of an external that becomes a
    runtime `TypeError` with no file and no clue. With `platform: "node"` it
    stays a legitimate external.
  - *Backwards compatible for this repo and for any browser app* — a browser
    bundle is what `bundleApp` has always documented itself as emitting, and
    the `@raptorstack/*` packages have no `node`/`browser` split, so they
    resolve to the same `.ts` sources as before (there is a regression test).
    A consumer who was *relying* on getting Node builds in a bundle now passes
    `--platform node`.

- **`@raptorstack/wire` — a subscription can be dropped.** New `UNSUBSCRIBE`
  frame (`0x15`, payload `varint(queryId)`), `ReactiveStore.removeSubscription(conn, queryId)`,
  and on the client `unsubscribe(queryId)`, `unsubscribeAll()` and
  `subscriptionCount`. `addSubscription` had no counterpart: closing the
  connection was the only way to stop a subscription, so a long-lived client
  navigating between screens kept every subscription it had ever opened and
  `broadcast` walked all of them on every mutation. The per-user projections
  above make per-screen subscriptions the natural pattern, which made this
  leak the next thing a consumer would hit.
  - *Backwards compatible, and this one does change the wire format* — by
    adding a frame type at a previously unassigned code, so every 0.2.0 frame
    is byte-identical and neither side has to send or understand the new one. A
    0.2.0 server receiving an `UNSUBSCRIBE` fails closed with `ERROR 400`
    (unknown frame type) and the session continues; a 0.2.0 client never sends
    one. `UNSUBSCRIBE` is gated by `onConnect` like every other query frame,
    and is idempotent, so teardown code needs no conditions.
  - The client also stops applying a `SNAPSHOT` or `OPS` frame for a
    subscription it has dropped, and does not acknowledge it — applying it
    would move the replica on behalf of a subscription the application let go.

- **`@raptorstack/raptorjs/i18n` — a new subpath: messages.** `locale()` is a
  signal, so `setLocale("ro")` re-binds exactly the text nodes that read `t()`
  — no component re-runs and no element is created, which is the claim
  fine-grained reactivity makes against a VDOM. Plural selection is
  `Intl.PluralRules`, so Romanian gets its three forms and Polish its four.
  `loadMessages` takes a catalogue or a loader (ten languages registered is not
  ten bundles loaded), `{name}` interpolation leaves unknown placeholders
  verbatim, a missing key returns the key and is reported once per locale
  (`setMissingKeyHandler`), and `withLocale(tag, fn)` renders one request or one
  email in another language without moving the global signal — no `window`
  assumption anywhere.
  - *New subpath only; nothing existing changed.* The formatting half
    (`formatDate`, `formatCurrency`, `formatDuration`, `formatSize`,
    `formatTime`, `groupDigits`) stays where it is in `ui/date` and
    `ui/input-extra`; numbers are interpolated as `String(value)` so an id is
    never silently grouped.
- **`@raptorstack/raptorjs/dom` — the router grew up.** `beforeEnter` guards
  (`true` renders, a string redirects, `false` denies into the `fallback`), a
  `component` that may return a promise plus `lazy()` for dynamic imports,
  nested `children` with `Outlet()`, `searchParams()` and `hash()` as reactive
  reads, and opt-in `scrollRestoration`. New exports: `Outlet`, `lazy`,
  `searchParams`, `hash`, `resolveRoute`, `routePatterns`, and the types
  `RouteResolution`, `LazyModule`, `GuardResult`. `RouteMatch` gains `chain`,
  `pattern` and `depthParams`.
  - *Backwards compatible.* A flat, synchronous route table behaves exactly as
    in 0.2.0; `matchRoutes` keeps its signature and its purity (it runs no
    guards, so a prerender is never redirected), and scroll restoration stays
    off until a `Router` asks for it. Each nesting level is its own dynamic
    region keyed on its own route and params, so a shell is not rebuilt when
    you move between its children. Route tables are now compiled once and
    cached per array instead of on every navigation.
  - `dom/prerender` enumerates the full nested patterns, so a nested table
    contributes `/app/inbox` and not just `/app`.
- **`@raptorstack/raptorjs/ui/form` — async validators.** `Validator<T>` may
  return `Promise<string | null>`. `Field` gains `validating` and `validate()`,
  `FormGroup` gains `validating` and `validate()`, `FieldOptions` gains
  `debounceMs` (default 300), and `FormField` puts a `rui-validating` class on
  the wrapper while a check is in flight. A stale verdict can never overwrite a
  newer one (sequence numbers on top of the debounce), and a rejecting rule is
  reported rather than treated as a failure.
  - *Backwards compatible.* `Form` now calls `group.validate()` instead of
    reading `group.valid()`, and both `validate()` methods answer
    **synchronously** when every rule is synchronous — so a form without async
    rules submits with the exact timing it had in 0.2.0. The built-in
    `validators.*` are typed as the new, narrow `SyncValidator<T>`, so calling
    one directly still gives `string | null`. Sync rules still answer on the
    keystroke; only async ones are debounced. The one behavioural change: a
    field now validates eagerly at creation instead of on the first read of
    `error()`, because an async verdict has to be written rather than
    recomputed.
  - New exported types: `SyncValidator`, `AsyncValidator`.
- **`@raptorstack/wire/sse` — a new subpath: Server-Sent Events, both ends.**
  `readEventStream(response)` turns a `fetch` body into an async iterable of
  typed events; `openEventStream(url, init)` does the POST too, which is what
  `EventSource` cannot (GET only, no headers) and the reason chat streaming
  ends up hand-parsed in every application. `writeEventStream(sink)` frames
  events and heartbeats on the server — a `node:http` ServerResponse satisfies
  the sink structurally. Handles a frame split across chunks, a multi-byte
  character straddling a chunk boundary, multi-line `data:`, comment
  heartbeats, `id`/`retry` as stream state, all three line terminators, an
  opt-in `[DONE]` sentinel, and an abort mid-stream that cancels the body.
  Exports `EVENT_STREAM_HEADERS`, including the `x-accel-buffering: no` that
  stops nginx from buffering the whole stream to the end.
  - *New subpath only; nothing existing changed.* Isomorphic — nothing from
    `node:` — so it bundles for the browser as-is, and still zero runtime
    dependencies.

- **`examples/i18n`** (`pnpm demo:i18n`) — ten registered languages, two of
  them lazy, and the DOM-mutation count across two full language switches
  (0 elements, 0 text nodes, 0 re-inserts, 8 text updates).

## [0.1.3] - 2026-10-03

Release tooling only — **no library or API changes** since 0.1.1.

### Added
- GitHub Actions release workflow: pushing a `vX.Y.Z` tag publishes all six
  packages to npm and creates a GitHub Release with auto-generated notes.
- `tools/bump.ts` — bumps the six package versions in lockstep
  (`pnpm bump <patch|minor|major|X.Y.Z>`).

### Fixed
- Pinned pnpm to v9 in the release workflow (matches CI) so the tag-triggered
  job sets up correctly.

> 0.1.2 was tagged but never published to npm; its changes are rolled into 0.1.3.

## [0.1.1] - 2026-09-30

Documentation and packaging polish — **no API changes**.

### Added
- A README for every package, so each one has install/usage docs on its npm page.
- npm version / CI / license badges and an "Install from npm" section in the
  root README.

## [0.1.0] - 2026-09-30

First public alpha on npm.

### Added
- **Consolidated 22 fine-grained packages into 6** under the `@raptorstack`
  scope. Granularity is preserved through subpath exports, e.g.
  `@raptorstack/raptorjs/ui`, `@raptorstack/wire/client`,
  `@raptorstack/engine/bundle`.
- **npm publishing**: each package ships a compiled `dist/` (`.js` + `.d.ts`)
  via `publishConfig`, while development stays TS-native (Node ≥ 22 type
  stripping). `pnpm -r publish` handles versions and `workspace:*` rewriting.
- **RaptorJS** — fine-grained, glitch-free reactivity (`state`, `derived`,
  `effect`, `batch`, ownership), a DOM runtime and JSX; no virtual DOM.
- **RaptorWire** — a state-aware binary protocol: opcodes, versioned document,
  snapshot + delta, a hand-written RFC 6455 WebSocket server (no `ws`).
- **RaptorEngine** — `.raptor` compiler, semantic optimizer, the project's own
  bundler (replaces Vite/esbuild), a profiler, and a server runtime with
  SSR/resume.
- **RaptorRuntime** — an application runtime where capabilities are a product
  feature: the `raptor:` namespace and a broker that denies everything
  undeclared.
- **Host adapters** — one contract across web, desktop, mobile, CLI, service
  and device.
- **RaptorTest** — autonomous behavioural testing with a backend digital twin.
- Presentation site with **search**, an **interactive tutorial**, a
  **showcase** and a **changelog** — all built with the stack.

### Changed
- `typescript` is a **build-time peer dependency** of `@raptorstack/engine`
  (the bundler's transform), so the libraries keep **zero runtime dependencies**.
- The entire codebase and documentation are in English.

### Fixed
- CI green on Node 22 and 24: `raptor:process` resolves spawned commands through
  the host `PATH` on Linux; stats are stable across platforms and read both the
  spec and TAP reporter output; removed a timer `unref` that left the Node 22
  test runner with a pending promise.

[0.1.3]: https://github.com/cristibcf/raptorjs/releases/tag/v0.1.3
[0.1.1]: https://github.com/cristibcf/raptorjs/releases/tag/v0.1.1
[0.1.0]: https://github.com/cristibcf/raptorjs/releases/tag/v0.1.0
