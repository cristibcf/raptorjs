# Architecture for a web app on the Raptor stack — "where to start"

A practical guide for someone who wants to **build a web app** with
RaptorJS / RaptorWire / RaptorEngine. It doesn't repeat the theory from the
whitepaper — it tells you which topology to choose, what's ready to use, what you
implement yourself, and the concrete steps from zero to a running page.

> **Honest status (README §Status):** it's a **prototype** per whitepaper §0, not a
> product. Reactivity, the delta protocol, the compiler, SSR and HMR work and are
> tested. The gaps (network transport, persistence, auth) are marked explicitly
> below — they aren't hidden. You cover them with small adapters over stable APIs.

## TL;DR — choose your path

```
Do you need realtime / state shared between clients?
│
├─ NO  → Path A: pure RaptorJS (client-only)
│         JSX + RaptorBundle + raptorjs/dom. Fine-grained reactivity, zero server.
│         Start from: examples/counter
│
└─ YES → A single page / simulated feed, or want to run right now?
         │
         ├─ YES → Path B: RaptorWire in-process (loopback)
         │         server + client in the same process, loopback transport.
         │         Simplest to start; good for tests and demos.
         │         Start from: examples/realtime-dashboard, examples/chat
         │
         └─ NO (I want client ↔ server over the network) →
                   Path B over WebSocket: `connectWebSocket` + `serveOverWebSocket`
                   Start from: examples/todo-realtime
                   OR
                   Path C: full RaptorEngine (.raptor → SSR + HMR + runtime)
                   Start from: examples/raptorengine-app
```

**Recommendation for most apps:** start with **Path B** (server
`@raptor/wire/server` + client `@raptor/wire/client` over loopback), put your domain
logic in mutations/queries, bind the UI with `client.signal(...)`. When you need
real networking, you add a `Transport` adapter over WebSocket — the rest of the code
stays unchanged. Move to **Path C** only if you want SSR/resume, state-preserving
HMR and semantic-graph optimization.

---

## What's ready vs. what you implement

| Concern | Status | Where / how |
|---|---|---|
| Fine-grained reactivity | ✅ ready | `raptorjs`, `raptorjs/dom` |
| DOM bindings + control flow (`For`/`Show`) | ✅ ready | `raptorjs/dom` |
| Two authoring surfaces over the same runtime: JSX (compiled) and `R` (hyperscript, no build step) | ✅ ready | `raptorjs/dom` |
| Reusable components (`Table`, `DropdownMenu`) with separate styles | ✅ ready | `raptorjs/ui` |
| Headless primitives (Portal, focusTrap, resizable, virtualizer, sortable, hotkeys...) | ✅ ready | `raptorjs/ui` |
| ⚡ components with DOM-mutation tests (virtualized DataGrid, Combobox, Slider, SplitPane, Sparkline, Progress) | ✅ ready | `raptorjs/ui` |
| SVG support in the runtime (`createElementNS` for SVG tags) | ✅ ready | `raptorjs/dom` |
| Form core (derived validation) and overlays (Dialog/Popover/Tooltip/Toast) | ✅ ready | `raptorjs/ui` |
| Layout, typography, display, controls, state primitives (persistedState/undoRedo/selectionState) | ✅ ready | `raptorjs/ui` |
| Date/time, navigation, files, trees and basic charts (139 components: all of T1+T2) | ✅ ready | `raptorjs/ui` |
| T3: specialized charts, editors, media, QRCode (own ISO 18004 generator), Kanban, Wizard | ✅ ready | `raptorjs/ui` |
| 36 entry points (subpath exports) | ✅ ready | `raptorjs/ui` |
| Tree-shaking on the ESM source, driven by the requested exports (barrel: 58 modules → 9, 527 KB → 39 KB) | ✅ ready | `@raptor/engine/bundle` |
| JSX in the browser | ✅ ready | `@raptor/engine/bundle` (own bundler, zero-dep, no Vite) |
| Dev server + live-reload (client-only) | ✅ ready | `@raptor/engine/bundle` `raptor-bundle dev` |
| State-aware delta protocol + RAS | ✅ ready | `@raptor/wire` |
| Authoritative server, query/mutation/subscription | ✅ ready | `@raptor/wire/server` |
| Client with reactive replica, delta reconnect | ✅ ready | `@raptor/wire/client` |
| Network transport (WebSocket) | ✅ ready | `connectWebSocket` (client) + `serveOverWebSocket` (server), own RFC 6455, zero-dep. Loopback stays for tests. |
| SSR + resume | ✅ ready (Path C) | `@raptor/engine/run` |
| Dev server + state-preserving HMR | ✅ ready (Path C) | `@raptor/engine/run`, `@raptor/engine` |
| Routing | ✅ basic | `@raptor/engine/run` `matchRoute` |
| **Persistence (DB)** | ⚠️ **you** | the store is in-memory; you feed it from your DB in `mutation.run` |
| **Authentication / authorization** | ⚠️ **you** | the `authorize()` hook on the mutation + `QueryContext` — the logic is yours |
| Semantic-graph optimization (DSE/Fusion) | ✅ ready (Path C) | `@raptor/engine` |
| Autonomous testing | ✅ ready | `@raptor/test` |

The two remaining ⚠️ are **small adapters over stable interfaces**, not rewrites. Examples below.

---

## Path A — pure RaptorJS (client-only)

For dashboards, internal tools, forms, any reactive UI without a shared backend.
It's the simplest and 100% ready.

### Structure

```
my-app/
├─ index.html            # <div id="app"></div> + <script type="module" src="/src/main.tsx">
├─ tsconfig.json         # jsx: "react-jsx", jsxImportSource: "raptorjs/dom"
├─ package.json          # deps: raptorjs, raptorjs/dom ; devDep: @raptor/engine/bundle
└─ src/
   ├─ main.tsx           # render(App, #app)
   ├─ components/        # .tsx components
   └─ state/             # shared signals/deriveds (state stores)
```

There is no bundler config file: `@raptor/engine/bundle` has `jsxImportSource:
"raptorjs/dom"` built in. There is no Vite, esbuild or Rolldown in the dependency
graph.

### Wiring (exactly like `examples/counter`)

`package.json` (scripts):
```json
{
  "scripts": {
    "dev": "raptor-bundle dev src/main.tsx --root . --port 5173",
    "build": "raptor-bundle build src/main.tsx --out dist/bundle.js --html index.html"
  },
  "devDependencies": { "@raptor/engine/bundle": "workspace:*" }
}
```

`index.html` (the same file works in dev and build — the script is rewritten
automatically to the bundle):
```html
<div id="app"></div>
<script type="module" src="/src/main.tsx"></script>
```

`tsconfig.json` (only for typecheck in the editor; the runtime doesn't need it):
```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "raptorjs/dom",
    "allowImportingTsExtensions": true,
    "noEmit": true
  }
}
```

`src/main.tsx`:
```tsx
import { render, state, derived } from "raptorjs/dom";

function Counter() {
  const count = state(0);
  const parity = derived(() => (count() % 2 === 0 ? "even" : "odd"));
  return (
    <section>
      <h2>{count}</h2>              {/* {count} = accessor → fine-grained text-node */}
      <p>Value {parity}</p>
      <button on:click={() => count.update((n) => n + 1)}>+1</button>
    </section>
  );
}
render(Counter, document.getElementById("app"));
```

Run: `pnpm dev` (dev server with live-reload at `http://localhost:5173`) or
`pnpm build` (emits `dist/bundle.js` + `dist/index.html`, servable as static
files). See also ["How RaptorBundle works"](#how-raptorbundle-works).

**Shared "store" pattern:** put signals in a module and import them wherever you
need them — there's no provider/context, it's just reactivity.
```ts
// src/state/cart.ts
import { state, derived } from "raptorjs";
export const items = state<CartItem[]>([]);
export const total = derived(() => items().reduce((s, i) => s + i.price, 0));
export const add = (i: CartItem) => items.update((xs) => [...xs, i]);
```

### How RaptorBundle works

`@raptor/engine/bundle` is the project's own bundler — it fully replaces Vite,
in the stack's zero-dep / compiler-centric spirit. It has **zero runtime
dependencies**; it uses the TypeScript compiler (already in the repo, as
`typescript`) only as a build-time transform primitive.

What it does, in order:
1. **Transform** — each `.tsx`/`.ts` is transformed: JSX → calls to
   `raptorjs/dom/jsx-runtime` (fine-grained, no Virtual DOM), the types are stripped.
2. **Resolution** — the specifiers (`./x.ts`, `raptorjs/dom`, `raptorjs/dom/jsx-runtime`)
   are resolved with the Node resolver, including the `exports` map to the `.ts`
   source of the `@raptor/*` packages.
3. **Bundling** — the graph (closed and zero-dep) is gathered into a single file
   with a module registry and lazy `require` — a statically-servable `dist/bundle.js`.
4. **Dev** — `raptor-bundle dev` starts a `node:http` server that serves
   `index.html` (with the script rewritten to the bundle), rebuilds on demand and
   does **live-reload** over SSE on each `fs.watch`.

```bash
raptor-bundle build src/main.tsx --out dist/bundle.js --html index.html
raptor-bundle dev   src/main.tsx --root . --port 5173
```

You can also use the code API (`bundleApp`, `startDevServer`, `transpile`) — see
[`USAGE.md`](USAGE.md#raptorenginebundle--own-tsx-bundler-no-vite). It does
tree-shaking on the ESM source (unused re-exports from a barrel are cut before
transpilation). Current limitations (v0.1): no code-splitting, no minification (for
minification, switch to Path C, where the engine can optionally use Oxc), and
tree-shaking is at the module level, not the declaration level.

> Why it matters: the way you write JSX no longer hangs on an external toolchain.
> The bundler, the dev server and the basic HMR are Raptor code, ~400 lines, that
> you can read and modify.

---

## Path B — RaptorWire in-process (realtime, recommended to start)

Authoritative server + client with a reactive replica. The UI binds to
`client.signal(...)`; the server moves state through delta operations. **This is
where you put the domain logic.**

### Topology

```
┌─────────────────────────── the same process (v0.1) ─────────────────────────┐
│                                                                              │
│   @raptor/wire/server                    Transport                @raptor/wire/client
│   ┌───────────────┐   delta ops   ┌──────────┐   delta ops   ┌───────────────┐
│   │ ReactiveStore │ ────────────▶ │ loopback │ ────────────▶ │ replica (signals)│
│   │(authoritative)│ ◀──────────── │ (in-mem) │ ◀──────────── │  client.signal() │
│   │ query/mutation│   mutations    └──────────┘   subscribe   └───────┬───────┘
│   └───────────────┘                                                   │
│         ▲                                              raptorjs/dom     ▼
│         │ store.setSignal/patch/append           mountChild / For / {signal}
│    your domain logic                                       fine-grained DOM
│    (DB, rules, auth)                                                        │
└──────────────────────────────────────────────────────────────────────────────┘
       ⚠️ For client ↔ server on DIFFERENT MACHINES: replace `loopback`
          with a `Transport` adapter over WebSocket (see below). Nothing else changes.
```

### 1. The server (domain logic)

```ts
// server/app.ts
import { raptorServer, type RaptorServer, type ReactiveStore } from "@raptor/wire/server";

export function buildApp(): RaptorServer {
  const app = raptorServer({ build: "my-app-0.1.0" });

  // query = which key prefixes the client can see
  app.query("board", { select: () => ["cards", "card:"] });

  // mutation = typed command; HERE you validate, persist, authorize
  app.mutation("addCard", {
    authorize: ({ input }) => isAllowed(input),        // ⚠️ auth = your code
    run: ({ input, store }) => {
      const { id, title } = input as { id: number; title: string };
      db.insert("card", id, { title, done: false });    // ⚠️ persistence = your code
      store.transaction(() => {                          // atomic batch → 1 UI commit
        store.setField(`card:${id}`, "title", title);
        store.setField(`card:${id}`, "done", false);
        store.append("cards", id);
      });
      return { ok: true, id };
    },
  });

  app.mutation("toggle", {
    run: ({ input, store }) => {
      const { id, done } = input as { id: number; done: boolean };
      db.update("card", id, { done });
      store.patch(`card:${id}`, { done });               // minimal delta on the wire
      return { id, done };
    },
  });

  return app;
}
```

### 2. The client + UI

```tsx
// client/main.tsx
import { render, For } from "raptorjs/dom";
import { createLoopback, RaptorClient } from "@raptor/wire/client";
import { buildApp } from "../server/app.ts";

const app = buildApp();
const link = createLoopback();     // ⚠️ replaced with WebSocket for real networking
app.serve(link.server);

const client = new RaptorClient(link.client, { build: "web-0.1.0" });
await client.connect();
client.subscribe("board");

function Board() {
  return (
    <ul>
      <For each={() => (client.signal<number[]>("cards")() ?? []) as number[]}>
        {(id) => (
          <li>
            {() => {
              const c = client.signal(`card:${id}`)() as { title?: string; done?: boolean };
              return `${c?.done ? "✓" : "○"} ${c?.title ?? ""}`;
            }}
            <button on:click={() => client.mutate("toggle", { id, done: true })}>done</button>
          </li>
        )}
      </For>
    </ul>
  );
}
render(Board, document.getElementById("app"));
```

The golden rule of the UI: **don't keep state in the component**. The source of
truth is the server; the UI is a reactive projection of `client.signal(...)`. A
`mutate()` sends the command; the delta that comes back updates exactly the
affected bindings.

### 3. Moving to real networking — the `Transport` adapter

`Transport` has three methods. A WebSocket adapter is straightforward:

```ts
// shared/ws-transport.ts
import { type Transport } from "@raptor/wire/client";

export function wsTransport(ws: WebSocket): Transport {
  ws.binaryType = "arraybuffer";
  return {
    send: (data) => ws.send(data),
    onMessage: (handler) => {
      ws.addEventListener("message", (e) => handler(new Uint8Array(e.data as ArrayBuffer)));
    },
    close: () => ws.close(),
  };
}
```

Client:
```ts
const ws = new WebSocket("wss://api.exemplu.ro/raptor");
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
const client = new RaptorClient(wsTransport(ws));
await client.connect();
client.subscribe("board");
```

On the server (Node), you put the opposite end of the same interface over the WS
connection and hand it to `app.serve(serverTransport)`. On reconnect,
`client.resume(newTransport, "board")` requests the delta from the version the
client already knows (`this.version`), so the op-log gives you **reconnect without
a full resend** — see
[`USAGE.md`](USAGE.md#raptorwireclient--session--reactive-replica).

> Why it's worth it: even without a ready-made WebSocket, the boundary is a 3-method
> interface. All the rest of the app (server, client, UI, delta, reconnect) is unchanged.

### 4. Persistence

The RaptorWire store is the authoritative working memory, **not** your database.
The correct model:

- **Write:** in `mutation.run` you write to the DB first, then reflect it in the
  store (`setField`/`patch`/`append`). The store emits the delta to the clients.
- **Startup / rehydration:** at boot, you read from the DB and seed the store
  (`store.setSignal(...)`), exactly as `buildDashboardApp` does the initial seed.
- **Consistency:** `store.transaction(() => ...)` groups the writes into an atomic
  commit (a single frame on the client), matching the DB's transaction boundaries.

---

## Path C — full RaptorEngine (`.raptor` → SSR + HMR + runtime)

When you want the **compiler to own the semantics**: SSR/resume from the same graph,
state-preserving HMR, DSE/Fusion, browser+server+wire codegen from a single
source. More experimental, but it closes the loop end-to-end.

### Flow

```
App.raptor ──buildModule──▶ { browser, server, wire, graph, manifest, chunks }
                                   │
                RaptorRuntime.fromBuild(result)
                                   │
        ┌──────────────┬───────────┴────────────┬───────────────┐
        ▼              ▼                         ▼               ▼
     ssr("/")     produce("addr", v)        connect()      metrics/log
    HTML+resume   server signal → wire   reactive client  observability
                                   │
                RaptorDevServer: fs.watch → recompile → diff → HMR (SSE)
```

### Minimal

```ts
import { readFileSync } from "node:fs";
import { buildModule } from "@raptor/engine";
import { RaptorRuntime, renderDocument, createNodeServer, listen } from "@raptor/engine/run";

const source = readFileSync("src/App.raptor", "utf8");
const result = buildModule(source, "App.raptor");
const runtime = RaptorRuntime.fromBuild(result, { initial: { "BTC.price": 60000 } });

// SSR per request
const ssr = runtime.ssr("/");
const html = renderDocument(ssr, ssr.resume.component);

// server signal → subscribed RaptorWire clients
runtime.produce("BTC.price", 61000);

// real Node HTTP server
const server = createNodeServer(runtime);
await listen(server, 3000);
```

Dev with HMR: `pnpm raptor:dev src/App.raptor`. See
[`USAGE.md`](USAGE.md#raptorenginerun--server-runtime--ssr--dev-server) and
[`examples/raptorengine-app`](../examples/raptorengine-app).

> When Path C is worth it: large apps where graph optimization (you eliminate dead
> reactive nodes, fuse deriveds) and state-preserving HMR matter. For an MVP,
> Path B is less code and just as reactive.

---

## Reference structure for a realtime app (Path B)

```
my-app/
├─ package.json
├─ shared/
│  ├─ protocol.ts        # query names, key prefixes, input/output types
│  └─ ws-transport.ts    # the Transport adapter (client + server)
├─ server/
│  ├─ app.ts             # raptorServer: query + mutations (domain logic)
│  ├─ db.ts              # your DB access (Postgres/SQLite/…)
│  ├─ auth.ts            # authorize() + session context
│  └─ main.ts            # Node WS server → app.serve(transport) per connection
└─ web/
   ├─ index.html         # <script type="module" src="/main.tsx">
   ├─ main.tsx           # RaptorClient(wsTransport(ws)) + render(App, #app)
   └─ components/        # .tsx components bound to client.signal(...)
       # dev/build with `raptor-bundle` (no config file)
```

Organization rules:
- **`shared/protocol.ts`** holds the query names, the key prefixes and the
  input/output types of the mutations — a single source of truth for both ends
  (like `DASHBOARD_QUERY`/`DASHBOARD_PREFIXES` in the examples).
- **The server doesn't import UI code**; **the UI doesn't import `db`/`auth`**. The
  boundary runs through query/mutation + transport.
- **One `Transport` per connection** on the server; the store is shared between connections.

---

## "Production readiness" checklist

What you need to add on top of the prototype, in priority order:

1. **Real transport** — a `Transport` adapter over WebSocket (client + server).
   Without it you stay in-process. *(stable interface, ~40 lines)*
2. **Persistence** — a DB behind the mutations + seed at boot. The store is the
   working memory, not the durable truth.
3. **Auth** — implement `authorize()` on every mutation and put the identity in the
   session context. Don't expose queries without access control.
4. **Backpressure / limits** — validate the mutation input; limit collection size
   and op rate.
5. **Reconnect** — use `client.resume(newTransport, query)` (delta resync from the
   known version) instead of reconnecting with a full snapshot. The op-log is already there.
6. **Observability** — on Path C you have `runtime.metrics` / `runtime.log`; on
   Path B instrument around `app.serve` and the mutations.
7. **Testing** — use `@raptor/test` for autonomous bug discovery + budget tests
   (0 repeated field names, 1 commit/frame) as in
   `examples/realtime-dashboard/tests`.

---

## Where to start, concretely

1. **Run the demos first** to see each path live:
   `pnpm demo:counter` (A), `pnpm demo:dashboard` and `pnpm demo:chat` (B),
   `pnpm demo:run` (C).
2. **Copy the example closest** to your app:
   - simple reactive UI → `examples/counter`
   - realtime / shared state → `examples/realtime-dashboard` or `examples/chat`
   - end-to-end compilation → `examples/raptorengine-app`
3. **Replace the domain logic** in `mutation.run` / query `select`.
4. **Bind the UI** only through `client.signal(...)` (don't keep state in components).
5. When you need networking → **write the `Transport` adapter** and change a single
   instantiation line. The rest stays.

*API details for each step: [`USAGE.md`](USAGE.md). Conceptual architecture
and the design targets: [`README.md`](../README.md) + the whitepapers in
[`design/`](../design/).*
