/** Learn section content: a guided tutorial, data-driven (rendered by ui.renderBlocks). */
import type { Block } from "../lib/ui.tsx";

export interface Lesson {
  slug: string;
  group: string;
  title: string;
  intro: string;
  blocks: Block[];
}

export const LESSONS: Lesson[] = [
  {
    slug: "quick-start",
    group: "Get started",
    title: "Quick start",
    intro: "Welcome to Raptor. This page gives you a feel for the stack in five minutes.",
    blocks: [
      { t: "p", text: "Raptor is a compiler-centric UI + data stack built on one idea: when the compiler, runtime, network protocol and cache all share the same state graph, you can delete the redundant work between them. It has four pillars — [RaptorJS](/learn/state-and-reactivity) (execution), [RaptorWire](/learn/realtime-with-raptorwire) (communication), RaptorTest (verification) and RaptorEngine (build)." },
      { t: "h", text: "Your first component" },
      { t: "p", text: "A component is a plain function that returns DOM. There is no Virtual DOM: `state` creates a reactive signal, and reading it inside markup wires that exact text node to it." },
      { t: "code", file: "Counter.tsx", code: `import { render, state, derived } from "@raptor/dom";

function Counter() {
  const count = state(0);
  const doubled = derived(() => count() * 2);
  return (
    <div>
      <h2>{count} · doubled {doubled}</h2>
      <button on:click={() => count.update(n => n + 1)}>+1</button>
    </div>
  );
}

render(Counter, document.getElementById("app"));` },
      { t: "p", text: "That is the whole model. A click updates one text node — no component re-runs, no diffing. Here it is running live:" },
      { t: "demo", key: "counter" },
      { t: "note", kind: "tip", text: "Pass an accessor (`{count}` or `{() => count()}`) to keep a binding reactive. Passing `{count()}` reads the value once — it will not update." },
      { t: "h", text: "Runnable examples" },
      { t: "p", text: "Six examples ship in the repository. Each one runs with a single command, and each exists to demonstrate one thing rather than to look like a product." },
      { t: "table",
        head: ["Example", "Run it", "What it shows"],
        rows: [
          ["**todo-realtime**", "`pnpm dev:todo`", "Two browser windows over a real WebSocket — the [full tutorial](/learn/todo-realtime)"],
          ["counter", "`pnpm demo:counter`", "The smallest complete app: signals and fine-grained bindings"],
          ["chat", "`pnpm demo:chat`", "`APPEND` / `PATCH` / `REMOVE` broadcast to several clients at once"],
          ["realtime-dashboard", "`pnpm demo:dashboard`", "Server signals through delta ops to a reactive client, with byte counts"],
          ["raptortest-crud", "`pnpm demo:raptortest`", "RaptorTest finding a stale-read bug on its own, with no test written for it"],
          ["raptorengine-app", "`pnpm demo:engine`", "`.raptor` → IR → optimise → codegen → running on the real runtime"],
        ],
        caption: "All six verified running at the time of writing. `dev:todo` and `dev:dashboard` open a browser; the rest print to the terminal.",
      },

      { t: "h", text: "Where to go next" },
      { t: "list", items: [
        "[Installation](/learn/installation) — set up a project with RaptorBundle.",
        "[What's ready, what's yours](/learn/whats-ready) — the whole surface, marked done or not done.",
        "[Realtime todo in 10 minutes](/learn/todo-realtime) — the tutorial that shows what the stack is for.",
        "[State & reactivity](/learn/state-and-reactivity) — signals, derived, effects.",
        "[Performance, measured](/learn/performance) — benchmarks against React, Preact and Solid.",
        "[Playground](/playground) — edit and run components in your browser.",
      ] },
    ],
  },
  {
    slug: "installation",
    group: "Get started",
    title: "Installation",
    intro: "Everything runs on Node ≥ 22 natively. Zero runtime dependencies, no external bundler.",
    blocks: [
      { t: "p", text: "The Raptor packages import nothing external. TypeScript runs natively on Node via type-stripping, and the browser build is produced by RaptorBundle — the project's own zero-dependency bundler." },
      { t: "h", text: "Project layout" },
      { t: "code", file: "structure", code: `my-app/
├─ index.html            # <div id="app"></div> + <script src="/src/main.tsx">
├─ tsconfig.json         # jsx: "react-jsx", jsxImportSource: "@raptor/dom"
├─ package.json          # deps: @raptor/core, @raptor/dom; dev: @raptor/bundle
└─ src/
   └─ main.tsx           # render(App, #app)` },
      { t: "h", text: "Scripts" },
      { t: "p", text: "There is no bundler config file — RaptorBundle has `jsxImportSource: \"@raptor/dom\"` built in." },
      { t: "code", file: "package.json", code: `{
  "scripts": {
    "dev":   "raptor-bundle dev src/main.tsx --root . --port 5173",
    "build": "raptor-bundle build src/main.tsx --out dist/bundle.js --html index.html"
  },
  "devDependencies": { "@raptor/bundle": "workspace:*" }
}` },
      { t: "p", text: "`pnpm dev` starts a dev server with live-reload; `pnpm build` emits a single static `bundle.js` plus a rewritten `index.html`." },
      { t: "note", kind: "info", title: "One tool, no config", text: "RaptorBundle transforms JSX to `@raptor/dom`'s runtime, resolves the module graph and emits one file — with zero runtime dependencies and no config file. See [Build & bundle](/learn/build-and-bundle)." },
    ],
  },
  {
    slug: "thinking-in-raptor",
    group: "Get started",
    title: "Thinking in Raptor",
    intro: "A few mental models that make everything else click.",
    blocks: [
      { t: "h", text: "The UI is a projection of state" },
      { t: "p", text: "You never imperatively update the DOM, and you never keep the source of truth inside a component. State lives in signals; the DOM is a set of fine-grained bindings that read those signals. Change the signal, and exactly the affected bindings update." },
      { t: "h", text: "Components run once" },
      { t: "p", text: "A component function runs a single time to create its DOM and wire up bindings. Unlike Virtual-DOM frameworks, it does not re-run on every state change. This is why there is no `useMemo`/`useCallback` ceremony — a value computed in the body is computed once; a value that must react is a `derived`." },
      { t: "note", kind: "warn", text: "Because components run once, don't read a signal's value directly in the body and expect it to update. Wrap it: `{() => user().name}` in markup, or a `derived(() => …)` for reuse." },
      { t: "h", text: "Fine-grained, not coarse" },
      { t: "p", text: "In a Virtual-DOM model a state change re-runs a component and diffs its whole output. In Raptor, a state change notifies only the computations that read it — one text node, one attribute, one list region. The work is proportional to what changed, not to the size of the tree." },
      { t: "demo", key: "temperature" },
    ],
  },
  {
    slug: "whats-ready",
    group: "Get started",
    title: "What's ready, what's yours",
    intro:
      "Every capability in the stack, marked done or not done. Read this before you commit to Raptor, not after.",
    blocks: [
      { t: "p", text: "A prototype's documentation usually describes the parts that work and stays quiet about the rest. This page is the whole surface, including the two places where Raptor hands you an interface and expects you to bring the implementation." },

      { t: "h", text: "Reactivity and UI" },
      { t: "table",
        head: ["Capability", "State", "Where"],
        rows: [
          ["Fine-grained reactivity", "Ready", "`@raptor/core`, `@raptor/dom`"],
          ["DOM bindings and control flow (`For` / `Show`)", "Ready", "`@raptor/dom`"],
          ["JSX *and* a no-build hyperscript surface (`R`)", "Ready", "`@raptor/dom` — same runtime, two ways to author"],
          ["SVG in the runtime", "Ready", "`@raptor/dom` (`createElementNS`)"],
          ["Component library with optional styles", "Ready", "`@raptor/ui` — see [Components](/components)"],
          ["Headless primitives (portal, focus trap, virtualizer, sortable, hotkeys)", "Ready", "`@raptor/ui`"],
          ["Form core with derived validation, overlays, date/time, charts", "Ready", "`@raptor/ui`, 36 entry points"],
        ],
      },

      { t: "h", text: "Build" },
      { t: "table",
        head: ["Capability", "State", "Where"],
        rows: [
          ["JSX in the browser, no Vite or webpack", "Ready", "`@raptor/bundle`"],
          ["Tree-shaking over ESM source", "Ready", "One `Button` out of the barrel: 58 modules → 9, 527 KB → 39 KB"],
          ["Dev server with live reload", "Ready", "`raptor-bundle dev`"],
          ["Semantic graph optimisation (dead-signal elimination, fusion)", "Ready", "`@raptor/engine`, for `.raptor` sources"],
          ["State-preserving HMR", "Ready", "`@raptor/run`, `@raptor/engine`"],
        ],
      },

      { t: "h", text: "Realtime" },
      { t: "table",
        head: ["Capability", "State", "Where"],
        rows: [
          ["Delta protocol with a reactive address space", "Ready", "`@raptor/wire-core`"],
          ["Authoritative server: query, mutation, subscription", "Ready", "`@raptor/server`"],
          ["Client with a reactive replica and delta reconnect", "Ready", "`@raptor/wire-client`"],
          ["WebSocket transport", "Ready", "`connectWebSocket` + `serveOverWebSocket`, RFC 6455 in-package"],
          ["In-process transport for tests and demos", "Ready", "`createLoopback()`"],
          ["Server rendering and resume", "Ready", "`@raptor/run`"],
          ["Routing", "Basic", "`@raptor/run` `matchRoute` — no nested layouts, no data loaders"],
        ],
      },

      { t: "h", text: "What you implement" },
      { t: "p", text: "Two things. Both are small adapters over stable interfaces rather than rewrites, but neither is written for you, and no amount of reading will change that." },
      { t: "table",
        head: ["Concern", "State", "What you do"],
        rows: [
          ["Persistence", "**Yours**", "`ReactiveStore` is in memory. You read from and write to your database inside `mutation.run` — the store is the projection, not the record."],
          ["Authentication and authorisation", "**Yours**", "`authorize()` runs on every query and mutation and receives the input and the store. The hook exists; the identity and the rules are yours."],
        ],
        caption: "Neither has a blessed pattern yet. If you build one, the design is still open enough that an issue can change it.",
      },
      { t: "note", kind: "warn", title: "Losing the store loses the state", text: "Restart the server and everything a client has is gone, including the op-log that makes delta reconnect possible. Until you add persistence, treat the state as a cache that happens to be authoritative." },

      { t: "h", text: "Verification" },
      { t: "table",
        head: ["Concern", "State", "Where"],
        rows: [
          ["Autonomous behavioural testing", "Ready", "`@raptor/test` — virtual clock, probes, chaos, replay"],
          ["Security review", "Done once", "`SECURITY-AUDIT.md` — three findings, all fixed, with regression tests"],
          ["Benchmarks against React, Preact, Solid", "Ready", "[Performance, measured](/learn/performance) — including the one Raptor loses"],
          ["Runtime dependencies", "Zero", "Confirmed by audit; `benchmarks/` is deliberately outside the workspace"],
        ],
      },
      { t: "p", text: "None of this has run under production load. The tests pass and the benchmarks are real, but a passing suite is evidence about the code, not about the road ahead of it — see [where Raptor is today](/)." },
    ],
  },
  {
    slug: "todo-realtime",
    group: "Build something",
    title: "Realtime todo in 10 minutes",
    intro:
      "A shared todo list, open in two browser windows, syncing over a real socket. Install to reconnection, nothing left out.",
    blocks: [
      { t: "p", text: "This is the whole stack doing the thing it exists for. Two windows, one authoritative state, no polling and no re-fetching: when you tick a box in one window, the other receives a single `PATCH` operation and updates one checkbox." },
      { t: "p", text: "Everything below is a real, runnable example in the repository — `examples/todo-realtime`. If you would rather read the finished code, it is four files." },
      { t: "note", kind: "tip", title: "Run it first", text: "`pnpm install && pnpm dev:todo`, then open `http://localhost:5190` in two windows. The rest of this page explains what you are looking at." },

      { t: "h", text: "1. The project" },
      { t: "p", text: "Six workspace packages, one dev dependency. No bundler config, no framework plugin, nothing transitive." },
      { t: "code", file: "package.json", code: `{
  "type": "module",
  "dependencies": {
    "@raptor/core":        "workspace:*",
    "@raptor/dom":         "workspace:*",
    "@raptor/server":      "workspace:*",
    "@raptor/wire-client": "workspace:*",
    "@raptor/wire-core":   "workspace:*"
  },
  "devDependencies": { "@raptor/bundle": "workspace:*" },
  "scripts": { "dev": "node src/server.ts" }
}` },

      { t: "h", text: "2. The shared state" },
      { t: "p", text: "The server owns the truth. A todo is an object under the handle `todo:ID`; their order lives separately in the `order` collection. Each mutation produces operations, and those operations — not the list — are what travels." },
      { t: "code", file: "src/app.ts", code: `import { raptorServer } from "@raptor/server";

export const TODO_QUERY = "todos";
export const TODO_PREFIXES = ["order", "todo:"];

export function buildTodoApp() {
  const app = raptorServer({ build: "todo-realtime-0.1.0" });
  let counter = 0;

  app.query(TODO_QUERY, { select: () => TODO_PREFIXES });

  app.mutation("add", {
    authorize: ({ input }) => typeof input.text === "string",
    run: ({ input, store }) => {
      const text = String(input.text).trim();
      if (!text) throw new Error("text gol");
      const id = ++counter;
      store.setField(\`todo:\${id}\`, "text", text);
      store.setField(\`todo:\${id}\`, "done", false);
      store.append("order", id);          // -> APPEND
      return { id };
    },
  });

  app.mutation("toggle", {
    run: ({ input, store }) => {
      const todo = store.doc.get(\`todo:\${input.id}\`);
      store.patch(\`todo:\${input.id}\`, { done: !todo.done });  // -> PATCH
      return { id: input.id, done: !todo.done };
    },
  });

  return app;
}` },
      { t: "note", kind: "warn", title: "`authorize` is not decoration", text: "The client is not your only line of defence. `add` rejects a non-string, and `run` rejects whitespace — a hand-crafted mutation frame hits the same wall as the form does." },
      { t: "p", text: "Notice what the prefixes mean. `order` matches exactly; `todo:` ends with a delimiter, so it exposes every child handle. A prefix without a delimiter will not leak the handle next to it — `cpu` never matches `cpuSecret`." },

      { t: "h", text: "3. One process serves both" },
      { t: "p", text: "The page and the protocol share a port. `serveOverWebSocket` attaches to an ordinary `node:http` server and turns every accepted upgrade into a RaptorWire connection." },
      { t: "code", file: "src/server.ts", code: `import { createServer } from "node:http";
import { bundleApp, rewriteHtml } from "@raptor/bundle";
import { serveOverWebSocket } from "@raptor/server";
import { buildTodoApp } from "./app.ts";

const app = buildTodoApp();

const http = createServer((req, res) => {
  if (req.url === "/bundle.js") {
    const { code } = bundleApp(entry, { sourceMap: true });
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(code);
    return;
  }
  const html = rewriteHtml(readFileSync("index.html", "utf8"), "/bundle.js", false);
  res.writeHead(200, { "content-type": "text/html" });
  res.end(html);
});

serveOverWebSocket(app, http);   // upgrade pe /raptor
http.listen(5190);` },
      { t: "note", kind: "info", title: "Zero dependencies means zero", text: "There is no `ws` package here. RFC 6455 — handshake, framing, masking, ping/pong — is implemented in `packages/server/src/websocket.ts`, the same way RaptorBundle replaces Vite." },

      { t: "h", text: "4. The client holds no copy" },
      { t: "p", text: "This is the part that differs from a store. `client.signal(handle)` is not a getter over cached JSON — it *is* the state, and every binding in the markup subscribes to exactly one handle." },
      { t: "code", file: "src/main.tsx", code: `import { render, state, For } from "@raptor/dom";
import { RaptorClient, connectWebSocket } from "@raptor/wire-client";
import { TODO_QUERY } from "./app.ts";

const client = new RaptorClient(await connectWebSocket(\`ws://\${location.host}/raptor\`));
await client.connect();
client.subscribe(TODO_QUERY);

const order = () => client.signal("order")() ?? [];
const todo  = (id) => client.signal(\`todo:\${id}\`)();

function TodoApp() {
  const draft = state("");
  return (
    <form on:submit={(e) => { e.preventDefault(); client.mutate("add", { text: draft() }); draft.set(""); }}>
      <input value={draft} on:input={(e) => draft.set(e.target.value)} />
      <ul>
        <For each={order}>
          {(id) => (
            <li>
              <input type="checkbox"
                     checked={() => todo(id)?.done ?? false}
                     on:change={() => client.mutate("toggle", { id })} />
              <span>{() => todo(id)?.text}</span>
            </li>
          )}
        </For>
      </ul>
    </form>
  );
}` },
      { t: "note", kind: "tip", text: "`{() => todo(id)?.text}` is an accessor, so it stays reactive. Writing `{todo(id)?.text}` would read once and freeze — the single most common mistake when starting out." },

      { t: "h", text: "5. Open two windows" },
      { t: "p", text: "Now the point of all of it. Put two windows on `http://localhost:5190` side by side and add a todo in the left one." },
      { t: "list", items: [
        "The left window sends one `mutation` frame — about the size of the text you typed.",
        "The server applies it, versions it, and broadcasts operations to every subscriber.",
        "The right window receives an `APPEND`, appends one `<li>`, and touches nothing else. It never asked for anything.",
        "Tick the box on the right: a `PATCH` carrying one field crosses the wire, and the left window updates one checkbox.",
      ] },
      { t: "p", text: "Open the network panel and watch the frames. After the first snapshot there are no more snapshots — a second window that stays open all afternoon never re-downloads the list." },

      { t: "h", text: "6. Reconnection" },
      { t: "p", text: "Networks drop. The interesting question is what happens after. `resume` keeps the local replica and asks the server only for what changed since the version the client already has." },
      { t: "code", file: "src/main.tsx", code: `const reconnect = async () => {
  status.set("connecting");
  try {
    const transport = await connectWebSocket(WIRE_URL, { onClose: () => status.set("offline") });
    await client.resume(transport, TODO_QUERY);   // delta, nu snapshot
    status.set("online");
  } catch {
    status.set("offline");
  }
};` },
      { t: "p", text: "The example has a button that drops the socket on purpose. Press it, add a todo from the other window while you are offline, then reconnect: the list converges without flashing, because what arrives is the missing operations rather than a fresh copy. If the gap is too large for the server's op-log, it falls back to a snapshot on its own — your code does not change either way." },
      { t: "note", kind: "info", title: "Verified, not asserted", text: "`examples/todo-realtime/tests/todo.test.ts` boots the real server, fetches the page, compiles the client and syncs two connections over an actual socket. `packages/server/tests/websocket.test.ts` covers the resume path and the subscription cleanup on disconnect." },

      { t: "h", text: "What you would change for production" },
      { t: "list", items: [
        "Terminate TLS in front and use `wss://` — the transport is unchanged.",
        "Give `authorize` a real identity: it receives the mutation input and the store, so it is the natural place for per-user rules.",
        "Persist the store. `ReactiveStore` is in-memory; the op-log it keeps for delta resync is not a durable log.",
        "Decide how large a reconnection gap you want to cover before falling back to a snapshot.",
      ] },
      { t: "note", kind: "warn", title: "Where this is honest", text: "Raptor is v0.1.0-alpha. The protocol and the reconnect path are tested, but nothing here has run under production load. Read [Where Raptor is today](/) before you bet a product on it." },
    ],
  },
  {
    slug: "state-and-reactivity",
    group: "Core concepts",
    title: "State & reactivity",
    intro: "Signals are the heart of RaptorJS: callable accessors that track who reads them.",
    blocks: [
      { t: "h", text: "state — a mutable signal" },
      { t: "code", file: "core", code: `import { state } from "@raptor/core";

const count = state(0);
count();                 // read (and register a dependency)
count.set(5);            // write
count.update(n => n + 1);// write from previous
count.peek();            // read without tracking` },
      { t: "h", text: "derived — lazy computed values" },
      { t: "p", text: "`derived` builds a read-only value from other signals. It recomputes lazily on read and is glitch-free — you never observe an inconsistent intermediate state." },
      { t: "code", code: `const doubled = derived(() => count() * 2);
const label   = derived(() => \`count is \${count()}\`);` },
      { t: "h", text: "effect — run side effects" },
      { t: "p", text: "`effect` runs immediately and re-runs whenever a signal it read changes. Use it for things outside the reactive graph (logging, timers, imperative DOM). It returns a dispose function." },
      { t: "code", code: `const stop = effect(() => {
  console.log("count changed to", count());
});
// later: stop();` },
      { t: "h", text: "batch — group writes" },
      { t: "p", text: "Multiple writes in a `batch` notify subscribers once, at the end — effects and bindings run a single time with the final values." },
      { t: "code", code: `batch(() => {
  count.set(1);
  count.set(2);
}); // one update, with 2` },
      { t: "p", text: "Putting it together — a counter with two derived values, running live:" },
      { t: "demo", key: "counter" },
    ],
  },
  {
    slug: "dom-and-control-flow",
    group: "Core concepts",
    title: "DOM & control flow",
    intro: "Bindings, events, and the For/Show primitives for dynamic UI.",
    blocks: [
      { t: "h", text: "Bindings and events" },
      { t: "p", text: "In markup, `{accessor}` binds a text node, an attribute value that is a function becomes a reactive attribute, and `on:click` (or `onClick`) attaches an event listener." },
      { t: "code", code: `<button
  class={() => active() ? "btn on" : "btn"}
  on:click={() => active.update(a => !a)}>
  {() => active() ? "On" : "Off"}
</button>` },
      { t: "h", text: "For — keyed lists" },
      { t: "p", text: "`For` renders a reactive array and reuses nodes for unchanged items, so reordering moves the minimum number of DOM nodes." },
      { t: "code", code: `import { For } from "@raptor/dom";

<ul>
  <For each={() => items()}>
    {(item, index) => <li>{index}: {item.text}</li>}
  </For>
</ul>` },
      { t: "h", text: "Show — conditional regions" },
      { t: "code", code: `import { Show } from "@raptor/dom";

<Show when={() => user()} fallback={<p>Signed out</p>}>
  <p>Welcome back</p>
</Show>` },
      { t: "p", text: "A complete example — a to-do list with add, toggle and remove, all fine-grained:" },
      { t: "demo", key: "todo" },
      { t: "note", kind: "tip", text: "There is no VDOM reconciliation: toggling one item updates only that row's text and checkbox, not the list." },
    ],
  },
  {
    slug: "realtime-with-raptorwire",
    group: "Core concepts",
    title: "Realtime with RaptorWire",
    intro: "A state-aware binary protocol: after the first snapshot, the wire carries semantic operations, not re-serialized documents.",
    blocks: [
      { t: "h", text: "The idea" },
      { t: "p", text: "Most realtime apps re-send whole JSON documents on every change. RaptorWire sends the operation instead — `SET`, `INC`, `APPEND`, `PATCH`, `MOVE` — applied on top of a base state both sides already know. An `INC` on one field is an order of magnitude smaller than re-serializing the object." },
      { t: "h", text: "Server: authoritative store" },
      { t: "code", file: "server.ts", code: `import { raptorServer } from "@raptor/server";

const app = raptorServer({ build: "app" });
app.query("dashboard", { select: () => ["cpu", "memory", "jobs", "job:"] });
app.mutation("setProgress", {
  run: ({ input, store }) => {
    store.patch("job:" + input.id, { progress: input.progress }); // delta op
  },
});` },
      { t: "h", text: "Client: a reactive replica" },
      { t: "p", text: "Each handle on the client is a signal. Subscribe once, then bind the DOM to `client.signal(name)` — deltas from the server update exactly the affected bindings." },
      { t: "code", file: "client.tsx", code: `import { RaptorClient } from "@raptor/wire-client";

const client = new RaptorClient(transport);
await client.connect();
client.subscribe("dashboard");

<div>CPU: {() => client.signal("cpu")() ?? 0}%</div>` },
      { t: "p", text: "Below, a full server + client run in this page over a loopback transport. Watch the byte counter: delta ops vs. re-sending the document as JSON." },
      { t: "demo", key: "realtime" },
      { t: "note", kind: "info", title: "Two transports ship", text: "`createLoopback()` runs both ends in one process — good for tests and for demos like the one above. `connectWebSocket(url)` plus `serveOverWebSocket(app, httpServer)` put the same protocol on a real socket. Nothing between them changes. The [Realtime todo](/learn/todo-realtime) tutorial builds the networked version end to end." },
    ],
  },
  {
    slug: "build-and-bundle",
    group: "Core concepts",
    title: "Build & bundle",
    intro: "RaptorBundle is the project's own zero-dependency bundler.",
    blocks: [
      { t: "p", text: "RaptorBundle compiles the `.tsx` browser variant. It has zero runtime dependencies and uses the TypeScript compiler only as a build-time transform primitive." },
      { t: "h", text: "What it does" },
      { t: "list", items: [
        "Transform — each module's JSX becomes calls to `@raptor/dom/jsx-runtime`; types are stripped.",
        "Resolve — specifiers (relative, and `@raptor/*` via their exports map to source `.ts`) are resolved with Node's resolver.",
        "Bundle — the closed, zero-dep graph is packed into one file with a lazy module registry.",
        "Dev — a `node:http` server serves `index.html`, rebuilds on request, and live-reloads via SSE on `fs.watch`.",
      ] },
      { t: "h", text: "CLI" },
      { t: "code", file: "terminal", code: `raptor-bundle build src/main.tsx --out dist/bundle.js --html index.html
raptor-bundle dev   src/main.tsx --root . --port 5173` },
      { t: "h", text: "Programmatic API" },
      { t: "code", code: `import { bundleApp, startDevServer } from "@raptor/bundle";

const { code, files } = bundleApp("/abs/src/main.tsx");
startDevServer({ entry: "src/main.tsx", root: ".", port: 5173 });` },
      { t: "note", kind: "tip", title: "This very site", text: "Everything you're reading is a RaptorJS app compiled by RaptorBundle — the graph is 30 modules across @raptor/core, dom, wire-core, wire-client and server." },
    ],
  },
  {
    slug: "performance",
    group: "Core concepts",
    title: "Performance, measured",
    intro:
      "Benchmarks against React, Preact and Solid — including the two places Raptor is not the fastest, and the one where it loses outright.",
    blocks: [
      { t: "p", text: "Every claim on this site about fine-grained updates is measurable, so here are the measurements. Two suites live in the repository: a real-browser one modelled on js-framework-benchmark, and a jsdom one that counts DOM operations. Reproduce both with `cd benchmarks && npm install && npm run bench`." },
      { t: "note", kind: "warn", title: "Read ratios, not milliseconds", text: "Absolute timings move a lot between runs — background load, GC, thermal throttling. Re-running the jsdom suite on a busier machine moved `create 1000` from 24.9 ms to 37.4 ms while every ratio held. Compare frameworks within a run; do not compare a number here against a number you get tomorrow." },

      { t: "h", text: "Real browser, eight operations" },
      { t: "p", text: "Chromium, production builds minified with esbuild, median of six runs after two warmups. Solid is compiled with `babel-preset-solid`, not hyperscript — otherwise the comparison would flatter Raptor unfairly." },
      { t: "table",
        head: ["Operation", "Raptor", "React 19", "Preact 10", "Solid 1.9"],
        numeric: [1, 2, 3, 4],
        rows: [
          ["create 1,000", "6.30", "4.75", "3.15", "4.65"],
          ["update every 10th", "0.35", "1.10", "2.55", "1.25"],
          ["select row", "0.05", "0.40", "2.80", "0.40"],
          ["swap rows", "1.05", "2.10", "2.00", "1.25"],
          ["remove row", "0.10", "0.35", "2.70", "1.75"],
          ["create 10,000", "33.0", "121.85", "32.25", "38.2"],
          ["append 1,000", "4.65", "8.75", "21.65", "10.70"],
          ["clear 10,000", "9.05", "15.40", "4.65", "6.00"],
          ["**geometric mean**", "1.42", "3.55", "5.01", "3.25"],
        ],
        best: [3, 1, 1, 1, 1, 3, 1, 3, 1],
        caption: "Median synchronous commit time in ms; lower is better. Highlighted = fastest in that row.",
      },
      { t: "p", text: "Raptor wins five of eight and the geometric mean. It wins exactly where fine-grained updates are supposed to win — the surgical operations that touch a few nodes in a large list. On `select row` it is eight times faster than React and Solid, because it changes one class on one node instead of reconciling anything." },

      { t: "h", text: "Where Raptor is not fastest" },
      { t: "p", text: "Preact beats it on bulk creation and on clearing. Those operations are dominated by allocating and detaching nodes, and there is no reconciliation to avoid — so fine-grained buys nothing, and Preact's leaner element representation shows." },
      { t: "list", items: [
        "`create 1,000` — Preact 3.15 ms, Raptor 6.30 ms. At this size warmup noise is large; the 10,000 row is the trustworthy signal, and there the two are level.",
        "`clear 10,000` — Preact 4.65 ms, Raptor 9.05 ms. Raptor used to be an outlier here at ~25 ms; detach-then-dispose brought it into the same class, not ahead.",
      ] },

      { t: "h", text: "Where Raptor loses" },
      { t: "p", text: "Strip the DOM away and benchmark pure signal propagation, and Raptor is roughly two and a half times slower than a mature production signals library." },
      { t: "table",
        head: ["Library", "updates/sec", "total ms", "checksum"],
        numeric: [1, 2, 3],
        rows: [
          ["Raptor", "185,615", "215.5", "6420032000"],
          ["@preact/signals-core", "455,395", "87.8", "6420032000"],
        ],
        best: [null, 1],
        caption: "Pull propagation microbenchmark; higher updates/sec is better. Identical checksums mean both computed the same graph — this is a speed difference, not a correctness one.",
      },
      { t: "p", text: "This is the honest cost of being young. `@preact/signals-core` has had years of tuning on exactly this hot path. If your workload is a tight computation graph with no DOM attached, it is the better tool today." },
      { t: "note", kind: "info", title: "Why the DOM numbers still hold", text: "A UI update is not one signal write — it is a write plus whatever the framework does to get it onto the screen. Raptor's per-signal cost is higher, and it still wins the DOM benchmarks by a wide margin, because it skips reconciliation entirely. The graph work is the small term." },

      { t: "h", text: "Same mutations, less time" },
      { t: "p", text: "The jsdom suite runs every framework in one shared jsdom with counters patched onto the prototypes, so the DOM operations are directly comparable — not just the timings." },
      { t: "table",
        head: ["Scenario", "Raptor", "React 19", "Preact 10"],
        numeric: [1, 2, 3],
        rows: [
          ["updateAll 1,000", "1.66", "23.30", "5.49"],
          ["update every 10th", "0.27", "5.61", "3.85"],
          ["create 1,000", "37.41", "40.40", "32.82"],
          ["clear 1,000", "8.12", "10.29", "8.59"],
        ],
        best: [1, 1, 3, 1],
        caption: "Median ms in a shared jsdom. All three perform **exactly 1,000 text updates** in `updateAll` — the same mutations, so the gap is reconciliation, not DOM work.",
      },
      { t: "p", text: "That last point is the whole argument in one line. In `updateAll 1,000` the counters show 1,000 `textUpdate` calls for all three frameworks. Raptor does them in 1.66 ms and React in 23.30 ms. The extra twenty-one milliseconds are not spent touching the DOM — they are spent deciding what to touch." },
      { t: "p", text: "And the gap widens with list size, not with change size: `update every 10th` changes 100 rows out of 1,000. Raptor's cost scales with the 100; a virtual DOM diffs all 1,000." },

      { t: "h", text: "What is not measured here" },
      { t: "list", items: [
        "Paint and layout. These numbers are the synchronous JS commit — the part that differs between frameworks. The resulting DOM is the same, so painting it costs the same.",
        "Memory. No allocation profile has been taken.",
        "Real applications. These are microbenchmarks on list operations, not a product under load.",
        "Ecosystem cost. A framework you can hire for and debug with existing answers is worth milliseconds. See [where Raptor is today](/).",
      ] },
      { t: "note", kind: "tip", title: "Run them yourself", text: "`benchmarks/` is a dev-only project with its own `package.json` and `node_modules`, deliberately outside the pnpm workspace — React, Preact and Solid never reach the `@raptor/*` packages, so the zero-dependency guarantee holds. Full tables in `benchmarks/results.md` and `benchmarks/browser/results-browser.md`." },
    ],
  },
  {
    slug: "autonomous-testing",
    group: "Core concepts",
    title: "Testing that finds its own bugs",
    intro:
      "RaptorTest explores your app, invents the sequences, and reports the ones that break an invariant — with a minimal reproduction you can replay.",
    blocks: [
      { t: "p", text: "Conventional tests check the cases you thought of. The bugs that reach production are usually the ones you did not: a request that resolves out of order, a navigation that races a fetch, a retry that overwrites fresher state. RaptorTest is built for that class — you describe what must always be true, and it goes looking for a way to break it." },

      { t: "h", text: "What it produces" },
      { t: "p", text: "This is the actual output of `pnpm demo:raptortest`, against a two-screen cart app with one invariant declared:" },
      { t: "code", file: "terminal", code: `Action sequences discovered autonomously: 8
UI states: 6, transitions: 4, API: 2

Defects found: 2

BUG RT-1  [oracle: cart-count-converges]
  schedule        : fault:POST /cart/items
  minimal repro   : ["button:Add to cart:ProductCard"]
  replay reproduced: YES (UI cart.count=undefined, server=0)

BUG RT-2  [oracle: cart-count-converges]
  schedule        : stale-read:GET /cart
  minimal repro   : ["button:Add to cart:ProductCard","link:Go to cart:ProductCard"]
  replay reproduced: YES (UI cart.count=0, server=1)` },
      { t: "p", text: "Nobody wrote either of those test cases. RT-2 is the interesting one: add an item, then navigate to the cart. The navigation fires a `GET /cart` that was already in flight against older state, its response lands last, and the screen settles on zero while the server holds one. A human writing tests for this app would very plausibly never try that ordering." },

      { t: "h", text: "What you actually write" },
      { t: "p", text: "Three things, and none of them is a test case." },
      { t: "p", text: "**A twin** — an in-memory stand-in for your backend, so exploration is fast and deterministic:" },
      { t: "code", file: "twin", code: `const twin = new RaptorTwin();
twin.db.create("cart", { count: 0 });

twin.route("POST", "/cart/items", (_req, db) => {
  const count = (db.read("cart", 1).count) + 1;
  db.update("cart", 1, { count });
  return { status: 200, body: { ok: true, count } };
});
twin.route("GET", "/cart", (_req, db) => ({
  status: 200,
  body: { count: db.read("cart", 1).count },
}));` },
      { t: "p", text: "**A harness** — how to read the current state, which actions are available, and how to perform one. It drives your real client code rather than a mock of it:" },
      { t: "code", file: "harness", code: `const harness: AppHarness = {
  currentState: () => ({
    route: ui.route,
    facts: { "cart.count": ui.count },
    actions: ui.route === "/product" ? [ADD, GO_CART] : [BACK],
  }),
  perform(id, ctx) {
    if (id === actionId(ADD)) {
      ctx.request("POST", "/cart/items", {}, (res) => { ui.count = res.body.count; });
    }
    // ...
  },
  snapshot: () => ({ ...ui }),
  restore: (snap) => Object.assign(ui, snap),
};` },
      { t: "p", text: "**An invariant** — the thing that must hold no matter what order anything happens in:" },
      { t: "code", file: "invariant", code: `const invariants = [{
  name: "cart-count-converges",
  check: ({ twin, ui }) =>
    ui.facts["cart.count"] === twin.db.read("cart", 1).count,
}];` },
      { t: "p", text: "Then let it run. Built-in oracles — no uncaught exceptions, no infinite loading — apply on top of whatever you declare." },
      { t: "code", file: "run", code: `const rt = new RaptorTest({ harness, twin, invariants, maxDepth: 3, seed: 1 });
const findings = rt.explore();   // Finding[] — each with a replayable capsule` },

      { t: "h", text: "Why it can explore at all" },
      { t: "list", items: [
        "**Virtual clock.** Time is simulated, so a network reordering that takes a real second costs nothing, and the same seed gives the same run.",
        "**Network schedules.** Faults, delays and stale reads are injected systematically, not randomly — `fault:POST /cart/items` and `stale-read:GET /cart` in the output above are two of them.",
        "**Semantic identity.** Actions are identified by meaning (`button:Add to cart:ProductCard`), not by a CSS selector, so a repro survives a refactor of the markup.",
        "**Behaviour graph.** States and transitions are recorded as it goes, so exploration is guided by coverage instead of walking the same path repeatedly.",
        "**Minimisation.** A failing sequence is shrunk before it is reported. RT-1 reduced to a single action.",
      ] },
      { t: "note", kind: "tip", title: "Determinism is the enabling constraint", text: "The reactive core uses neither `Math.random` nor wall-clock time — a property the [security audit](/learn/security) verified. That is what makes a failure replayable at all: the same seed and schedule reproduce it exactly, which is why both findings above say `replay reproduced: YES`." },

      { t: "h", text: "Capsules" },
      { t: "p", text: "Each finding serialises to a `.raptorcap` capsule: the action log, the network schedule and the build fingerprint. It is the reproduction, not a description of one — hand it to `parseCapsule` and the failure happens again." },
      { t: "code", file: "capsule (excerpt)", code: `{
  "id": "RT-1",
  "buildFingerprint": "cart@demo",
  "actionLog": ["button:Add to cart:ProductCard"],
  "networkSchedule": { "default": { "processDelay": 10, "deliverDelay": 10 }, ... }
}` },

      { t: "h", text: "Honest limits" },
      { t: "list", items: [
        "You still write the harness and the twin. That is real work, and for a large app it is not small.",
        "Exploration is bounded by `maxDepth` (default 3). A bug needing five specific actions in order will not be found at the default setting.",
        "An invariant you do not declare cannot be violated. The built-in oracles are thin — the value comes from what you assert about your own domain.",
        "The twin is a model of your backend, not your backend. A bug that only exists in the real one stays there.",
        "Try it now: `pnpm demo:raptortest`, source in `examples/raptortest-crud`.",
      ] },
    ],
  },
  {
    slug: "security",
    group: "Core concepts",
    title: "Security",
    intro:
      "What a peer on the wire can and cannot do to you, what your own code is allowed to do to the machine, and what neither audit covers yet.",
    blocks: [
      { t: "p", text: "A protocol that applies operations from the network onto local state is a security surface by construction. So is a runtime that hands application code a filesystem. The repository audits both, and writes down what it finds: `SECURITY-AUDIT.md` carries the current state, `AUDIT-2026-09-24.md` the full report with a proof-of-concept per finding." },
      { t: "p", text: "Thirteen findings so far. Twelve are fixed, each with a regression test that started life as a working exploit; one is open and named below. Here is the shape of it." },

      { t: "h", text: "Three findings on the wire, all fixed" },
      { t: "table",
        head: ["Finding", "Severity", "Fix"],
        rows: [
          ["Prototype pollution when decoding wire data (CWE-1321)", "Medium", "`setOwn()` via `Object.defineProperty` — always an own property, never a setter"],
          ["Prefix matching without a delimiter leaked neighbouring handles", "Medium", "A prefix exposes children only if it ends in `:`, `/` or `.`"],
          ["The client was not fail-closed on a corrupt frame", "Low", "Decoding is wrapped; an invalid frame is dropped, not thrown into a microtask"],
        ],
      },

      { t: "h", text: "Why the second one matters most" },
      { t: "p", text: "A query declares its projection as prefixes. Before the fix, `handle.startsWith(prefix)` had no boundary, so a subscriber authorised for `cpu` also received `cpuSecret` and `cpu2` — data leaking to a peer with no right to it, silently, through a query that looked correct." },
      { t: "code", file: "the rule now", code: `app.query("metrics", { select: () => ["cpu", "job:"] });

// "cpu"   — exact match only. Does NOT match "cpuSecret".
// "job:"  — ends in a delimiter, so it exposes job:1, job:2, ...` },
      { t: "note", kind: "warn", title: "Name handles deliberately", text: "This is a naming discipline, not just a fixed bug. If a handle needs to be private, do not give it a name that a public prefix could plausibly cover." },

      { t: "h", text: "What a connected peer can do" },
      { t: "list", items: [
        "**Send mutations.** Every mutation runs `authorize()` first, which receives the input and the store. There is no default identity — see [What's ready, what's yours](/learn/whats-ready).",
        "**Subscribe to queries.** A query's `authorize()` and its projection decide what that connection ever sees.",
        "**Not push operations to other clients.** Operations travel server → client only. A client cannot inject state into another client's replica; it can only ask the server to mutate, and the server decides.",
        "**Not exhaust you trivially.** The reader bounds-checks the buffer, varint rejects oversized values, the frame parser caps at 16 MB per frame *and* per reassembled message, and the transport caps concurrent connections.",
      ] },

      { t: "h", text: "Standards, measured" },
      { t: "list", items: [
        "**Zero external runtime dependencies** — counted, not claimed. `pnpm stats` counts the non-`@raptor/*` dependencies of every published package and gets 0. `typescript` is a devDependency, and `benchmarks/` sits outside the workspace precisely so React and Preact never enter the graph.",
        "**No dynamic code execution in the libraries** — neither `eval` nor the `Function` constructor appears in `packages/*/src`. Both show up in tests, and in the Playground on this site, which deliberately runs code you type, in your own page.",
        "**System access, where it is.** 9 of the 24 packages import `node:fs`, `node:http`, `node:net` or `node:child_process` — the bundler, the build engine, the scaffolder, the profiler, the server runtimes. They are tools and runtimes, not application libraries. The reactive core and the wire layer touch nothing.",
        "No hardcoded secrets.",
        "Determinism: the reactive core uses neither `Math.random` nor wall-clock time, which is what makes replay testing possible.",
      ] },

      { t: "h", text: "The other boundary: capabilities" },
      { t: "p", text: "Everything above is about RaptorWire — what a peer on the wire can do to you. Raptor has a second security boundary that works the other way round: what your own application code is allowed to do to the machine it runs on. That is the capability model in `@raptor/runtime`, and it is worth knowing where it is strong and where it is not." },
      { t: "p", text: "A `raptor.runtime.json` declares targets, not permissions in the abstract: which paths, which `host:port`, which environment variables, which commands. Everything undeclared is denied, and every check — granted or refused — lands in the diagnostics." },
      { t: "code", file: "raptor.runtime.json", code: `{
  "policy": "production",
  "capabilities": {
    "files.read":  ["./src", "./config"],
    "net.connect": ["api.example.com:443"],
    "net.listen":  ["127.0.0.1:8787"],
    "env.read":    ["RAPTOR_*"]
  }
}` },
      { t: "note", kind: "warn", title: "On Node, the broker is advisory — not a sandbox", text: "The bootstrap engine runs your code in the Node process, so `import fs from \"node:fs\"` reaches the disk without asking the broker. The real boundary belongs to the native Rust host, where `node:*` does not exist at all. Until then the defence lives in the tooling: `raptor-runtime doctor` reports every bypass, and `raptor-runtime run` refuses to start under the `production` policy and records it in the audit log under `development`. If your threat model includes hostile application code, this is the sentence that matters." },
      { t: "p", text: "The 2026-09-24 audit found five escapes from this model and closed them: a `process.spawn` grant that could be widened to arbitrary code through `NODE_OPTIONS`, a `fetch` that followed redirects without re-checking the destination, a dev server that served files from sibling directories, `serve` opening ports with nothing declared, and the bypass above being visible only to `doctor`. Each one has a regression test that started life as a working exploit." },

      { t: "h", text: "Still open, by name" },
      { t: "note", kind: "warn", title: "Path containment is lexical — symlinks are not followed", text: "Both `packages/runtime/src/paths.ts` and its Rust twin resolve paths textually, without `realpath`. A symlink planted inside a granted directory reads straight through it. The threat model, written down rather than assumed: **the granted scope does not contain symlinks put there by someone else.** Fine when the scope is your own project directory; not fine when it is attacker-writable. Closing it properly means `realpath` on the parent directory, with the TOCTOU race that comes with it — which is why it has not been done in a hurry." },
      { t: "p", text: "It is listed here rather than in a footnote, because an open finding you do not know about is worse than one you do." },
      { t: "h", text: "Limits that are choices, not bugs" },
      { t: "list", items: [
        "No TLS anywhere — not in the wire transport, not in the native HTTP client, where `https://` passes the capability check and then **fails loudly** instead of quietly downgrading to `http`. Terminate TLS in front and use `wss://`.",
        "No rate limiting. There is a concurrent-connection cap on the WebSocket transport (1024 by default), but a client that reconnects in a loop is still yours to bound.",
        "The WebSocket handshake checks `Origin` and defaults to same-origin — a browser page on another site cannot open a connection. Pass `allowedOrigins` when your app is served from a different origin than the API.",
        "No schema validation on decode. `SchemaCodec` is optional; the generic value codec accepts any shape, so a mutation should validate its own input rather than trust it.",
        "The reactive address space is renegotiated per connection. The exact identifier format is still open.",
        "`@raptor/ui` has not been reviewed for injection through props. The one HTML sink in the library is `RichTextEditor`, which does not sanitise and says so both in its source and on [its catalogue page](/components).",
        "No penetration testing.",
      ] },
      { t: "p", text: "The current state is in `SECURITY-AUDIT.md`; the report behind it, with a proof-of-concept per finding, is in `AUDIT-2026-09-24.md`. Both at the repository root." },
    ],
  },
  {
    slug: "raptor-format",
    group: "Core concepts",
    title: "The .raptor format",
    intro:
      "A declarative component format that compiles to browser code, server code and a wire manifest from one graph — and deletes the work nothing observes.",
    blocks: [
      { t: "p", text: "Everything else on this site uses JSX or the `R` builder, which are runtime surfaces: you write bindings and the runtime wires them at startup. RaptorEngine takes a different route. A `.raptor` file is parsed into an intermediate representation, turned into a semantic graph, optimised on that graph, and only then emitted — as browser code, server code and a wire manifest at once." },
      { t: "note", kind: "warn", title: "This is the research edge", text: "JSX plus `@raptor/bundle` is the supported path and what the rest of these docs use. The `.raptor` pipeline works — every output on this page was produced by running it — but it is younger, and nothing on this site is built with it." },

      { t: "h", text: "A component" },
      { t: "code", file: "App.raptor", code: `component App {
  const count   = state(0)
  const doubled = derived(() => count * 2)            // 2 consumers → survives
  const label   = derived(() => "clicks: " + count)   // 1 consumer  → fused away
  const unused  = derived(() => doubled + count + 999) // no output  → deleted
  const price   = serverSignal("BTC.price", schema.money)

  <div class="app">
    <button on:click={count++}>increment</button>
    <span class="count">{label}</span>
    <span class="double" data-value={doubled}>doubled = {doubled}</span>
    <span class="price">price = {price}</span>
  </div>
}` },
      { t: "list", items: [
        "`state(v)` — a local mutable signal.",
        "`derived(() => expr)` — a computed value, subject to the two optimisations below.",
        "`serverSignal(\"addr\", schema.T)` — a value the server owns; becomes an address in the wire manifest.",
        "`on:click={count++}` — an event binding. `{expr}` in markup is a fine-grained text or attribute binding.",
      ] },

      { t: "h", text: "What the compiler removes" },
      { t: "p", text: "Compile that file and the optimiser reports exactly two decisions:" },
      { t: "code", file: "buildModule(source).optimization", code: `[
  { pass: "DSE",    action: "eliminate", target: "App.unused",
    detail: "no observable consumer (no path to DOM or effect)" },
  { pass: "Fusion", action: "fuse",      target: "App.label",
    detail: "fused into App/e2#t0 (single consumer)" }
]` },
      { t: "p", text: "`unused` reaches no binding and no effect, so it is not emitted at all — dead-signal elimination. `label` has exactly one consumer, so it does not need to exist as a separate reactive node; its expression is inlined into the text binding that reads it. `doubled` has two consumers and survives as a real `derived`." },
      { t: "p", text: "Here is the emitted browser module, trimmed. There is no `label` and no `unused`:" },
      { t: "code", file: "browser output", code: `import { state, derived } from "@raptor/core";
import { createElement, applyProps, mountChild } from "@raptor/dom";

export function App() {
  const count = state(0);
  const price = state(0);                  // RAS "BTC.price", schema money
  const doubled = derived(() => (count() * 2));

  const _e1 = createElement("button");
  applyProps(_e1, { "on:click": () => count.set(count() + 1) });

  const _e2 = createElement("span");
  mountChild(_e2, () => ("clicks: " + count()), null);   // label, fused
  ...
}` },
      { t: "note", kind: "tip", title: "Why this is not just minification", text: "A minifier cannot delete `unused`: it is a live reactive node whose removal changes the dependency graph. The compiler can, because it knows the graph — which signals reach an output and which do not. Mark a derived `@debug` to block fusion when you want to inspect it." },

      { t: "h", text: "One declaration, three outputs" },
      { t: "p", text: "The same build produces the server module and the wire manifest. `serverSignal(\"BTC.price\", schema.money)` becomes a compact address with a schema attached — the client never sends the string `\"BTC.price\"` over the network:" },
      { t: "code", file: "wire manifest", code: `{
  "schemas": ["money"],
  "addresses": [
    { "logical": "BTC.price", "ras": "0x18A1", "decoderSlot": 0, "schema": "money" }
  ]
}` },
      { t: "p", text: "This is the concrete version of the claim on the front page. The field is declared once; the type, the binding, the wire address and the schema are all derived from that one declaration rather than restated in four places." },

      { t: "h", text: "Building one" },
      { t: "code", file: "terminal", code: `# programmatic
import { buildModule } from "@raptor/engine";
const out = buildModule(source, "App.raptor");
out.browser        // browser module
out.server         // server module
out.wire           // wire manifest
out.optimization   // what was removed, and why

# CLI
pnpm raptor build` },
      { t: "p", text: "`@raptor/compiler` holds the stable semantic core — parser, IR, graph, and the diff used for hot reload. `@raptor/engine` consumes it and adds the optimiser, code generation, caching and the CLI. They are separate packages so the semantic core does not depend on the build tooling." },

      { t: "h", text: "Where this stands" },
      { t: "list", items: [
        "The pipeline runs end to end: parse, graph, optimise, emit browser + server + manifest.",
        "Graph diffing for state-preserving hot reload is implemented in `@raptor/compiler`.",
        "No editor tooling — no syntax highlighting, no language server, no formatter.",
        "The expression language is small. It is not TypeScript, and it does not try to be.",
        "If you want to ship something today, use JSX. If you want to see where the architecture is going, this is it.",
      ] },
    ],
  },
];

export const LEARN_GROUPS = ["Get started", "Build something", "Core concepts"];
