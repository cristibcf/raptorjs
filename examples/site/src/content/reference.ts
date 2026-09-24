/** Reference section: API entries grouped by package. */

export interface ApiParam {
  name: string;
  type: string;
  desc: string;
}
export interface ApiEntry {
  name: string;
  signature: string;
  summary: string;
  params?: ApiParam[];
  returns?: string;
  example: string;
  /**
   * Eticheta blocului de cod. Implicit `tsx`, care e gresit pentru un manifest
   * JSON sau pentru o comanda de shell - deci intrarile alea si-o spun.
   */
  lang?: string;
  /** Cheie in API_DEMOS: intrarea primeste o demonstratie care chiar ruleaza. */
  demo?: string;
  /** Capcane si lucruri care se invata altfel doar lovindu-te de ele. */
  notes?: string[];
}
export interface RefPackage {
  slug: string;
  name: string;
  tagline: string;
  entries: ApiEntry[];
}

/**
 * „De ce am nevoie?" — traseul de la ce vrei sa faci la ce instalezi. Tinut aici,
 * langa pachete, ca sa nu se desincronizeze de ele.
 */
export interface PackageRoute {
  want: string;
  packages: string[];
  /** Slug-ul paginii de referinta catre care trimitem. */
  to: string;
  note: string;
}

export const PACKAGE_ROUTES: PackageRoute[] = [
  {
    want: "Reactivity only, no DOM",
    packages: ["@raptor/core"],
    to: "core",
    note: "Signals, derived, effects, batching. Assumes no browser — it runs on the server or in a worker just as well.",
  },
  {
    want: "A user interface, with JSX",
    packages: ["@raptor/dom"],
    to: "dom",
    note: "The DOM runtime: fine-grained bindings, `For` / `Show`, the JSX runtime and the `R` builder. It also re-exports `@raptor/core`'s primitives, so one import is usually enough. Where most apps start.",
  },
  {
    want: "Components already built",
    packages: ["@raptor/ui"],
    to: "dom",
    note: "Accessible components with optional styles — browse them in [Components](/components).",
  },
  {
    want: "Client ↔ server sync",
    packages: ["@raptor/wire-client", "@raptor/server"],
    to: "wire-client",
    note: "The client holds a reactive replica, the server the authoritative state. The [Realtime todo](/learn/todo-realtime) tutorial builds both.",
  },
  {
    want: "Build and dev server",
    packages: ["@raptor/bundle"],
    to: "bundle",
    note: "The project's own bundler — zero dependencies, no config file. A devDependency only.",
  },
  {
    want: "Server routing and SSR",
    packages: ["@raptor/run"],
    to: "run",
    note: "A server runtime with file-based routing and server rendering. Separate from `@raptor/bundle`, which only targets the browser.",
  },
  {
    want: "Run an app with declared permissions",
    packages: ["@raptor/runtime", "@raptor/runtime-cli"],
    to: "runtime",
    note: "The `raptor:` module namespace and a capability broker: every path, host, variable and command is declared in a manifest, and everything undeclared is denied. Read [Security](/learn/security) for where that boundary is real and where it is advisory.",
  },
  {
    want: "Desktop, mobile, CLI, service or device",
    packages: ["@raptor/host", "@raptor/desktop", "@raptor/mobile", "@raptor/web-host", "@raptor/cli-host", "@raptor/service-host", "@raptor/device-host"],
    to: "host",
    note: "One contract, six targets. The application asks the host for a window, a socket, a pin or a prompt, and the host decides — including saying no.",
  },
];

export const REF_PACKAGES: RefPackage[] = [
  {
    slug: "runtime",
    name: "@raptor/runtime",
    tagline: "An application runtime where permissions are a product feature: the `raptor:` namespace plus a capability broker that denies everything undeclared.",
    entries: [
      {
        name: "raptor.runtime.json",
        signature: "{ name, version, entry, policy, capabilities, tasks }",
        lang: "json",
        summary:
          "The manifest. Capabilities are declared per target — a path, a `host:port`, a variable name, a command — never as a blanket permission. Anything not listed is denied, and every check lands in the diagnostics whether it was granted or refused.",
        example: `{
  "name": "notes",
  "version": "0.1.0",
  "entry": "./src/main.ts",
  "policy": "production",
  "capabilities": {
    "files.read":  ["./src", "./config"],
    "files.write": ["./data"],
    "net.connect": ["api.example.com:443"],
    "net.listen":  ["127.0.0.1:8787"],
    "env.read":    ["RAPTOR_*"],
    "env.set":     ["RAPTOR_CHILD_*"],
    "process.spawn": ["git"]
  }
}`,
        notes: [
          "`policy: production` turns on strict mode: there is no implicit project-root read, so absolutely every access must be declared.",
          "`net.listen` uses the same target form as `net.connect`. Write `127.0.0.1:*` for any port on loopback only; a rule that names a port does not cover an ephemeral one.",
          "`process.spawn` names *which commands*. It does not become *any code*: a child inherits only the variables covered by `env.read`, anything the app wants to add on top needs `env.set`, and variables that load code before `main` — `NODE_OPTIONS`, `LD_PRELOAD`, `JAVA_TOOL_OPTIONS`, `BASH_ENV` — are refused even then.",
          "`env.read` and `env.set` are separate on purpose. Reading a variable tells you something; setting one for a child can change what code that child runs. A second audit pass found `env.read: [\"*\"]` was enough to turn `process.spawn: [\"git\"]` into arbitrary code through `JAVA_TOOL_OPTIONS`.",
        ],
      },
      {
        name: "raptor: modules",
        signature: 'import { readText } from "raptor:files"',
        summary:
          "The only way to the system. `files`, `net`, `serve`, `process`, `kv`, `observe`, `capabilities`, `tasks` — each call goes through the broker, and the types come from the host contracts, so your editor checks them without hand-written declarations.",
        example: `import { readText } from "raptor:files";
import net from "raptor:net";
import observe from "raptor:observe";

const config = await readText("./config/app.json");
observe.log("info", "config.loaded", { bytes: config.length });

// Denied unless api.example.com:443 is declared — and the check runs
// again on every redirect hop, so a 302 cannot walk you somewhere else.
const response = await net.fetch("https://api.example.com/v1/items");`,
        notes: [
          "A refusal is a `CapabilityError` carrying `code`, `capability` and `target`, so an application can tell the difference between you may not and it did not work.",
          "The native binary exposes a **synchronous** shape of `raptor:files` and `raptor:serve`; the bootstrap runtime is asynchronous. Same names, two profiles — pick the one for your target.",
        ],
      },
      {
        name: "raptor-runtime (CLI)",
        signature: "raptor-runtime init|run|doctor|test|pack|trace [--policy development|production]",
        lang: "bash",
        summary:
          "Scaffold, run, diagnose, package. `doctor` reads the static import graph and reports anything that would not exist on the native host; `pack` emits a reproducible unit with a lockfile; `trace` writes OpenTelemetry-compatible spans.",
        example: `raptor-runtime init notes
cd notes
raptor-runtime doctor     # manifest, policy, static graph, broker bypasses
raptor-runtime run
raptor-runtime pack --out dist/`,
        notes: [
          "Under `--policy production`, an `import` of `node:fs` **stops the run**. On the bootstrap engine that import reaches the disk without asking the broker, so strict mode cannot honestly let it through.",
          "Under `development` the same import runs, but is reported in the summary and written to the audit log. An audit trail that shows the refusal and hides the successful way round is worse than none.",
        ],
      },
      {
        name: "The native binary",
        signature: "raptor-runtime run   # Rust, no Node installed",
        lang: "bash",
        summary:
          "A Rust binary that runs JavaScript *and* TypeScript with no Node and no tsc anywhere on the machine: QuickJS behind an engine adapter, oxc for the TypeScript transform, the `raptor:` modules as native functions, and a small HTTP/1.1 stack over `std::net`.",
        example: `# Default build: zero dependencies, 964 KB.
cargo build --release
# With an engine and the TypeScript transform: 4.4 MB.
cargo build --release --features full`,
        notes: [
          "This is where the capability model is a real boundary rather than an advisory one — `node:*` does not exist, so there is nothing to bypass it with.",
          "Deliberately synchronous: without an event loop, the accept loop belongs to the application (`serve.next()` blocks, `null` means timeout). `serve({ fetch })` arrives with the event loop, on top of this contract, not instead of it.",
          "oxc transforms `enum` and `namespace`, which Node type stripping rejects. Code that runs on the binary may not run under `node --experimental-strip-types`.",
        ],
      },
    ],
  },
  {
    slug: "host",
    name: "@raptor/host + the six adapters",
    tagline: "One capability contract, six targets: desktop, mobile, browser, service, terminal, device.",
    entries: [
      {
        name: "raptor.host.json",
        signature: "{ target, bundleId, displayName, capabilities, window, deepLinkSchemes, update }",
        lang: "json",
        summary:
          "Two manifests that compose, not one. `raptor.runtime.json` says what the application may do; `raptor.host.json` says what it asks of the operating system. The `process.spawn` capability here says *whether*; the list in the runtime manifest says *which commands*.",
        example: `{
  "target": "desktop",
  "bundleId": "com.example.notes",
  "displayName": "Notes",
  "capabilities": ["window.manage", "device.notifications", "storage.local"],
  "deepLinkSchemes": ["notes"],
  "update": { "feed": "https://example.com/appcast.xml", "channel": "stable" }
}`,
        notes: [
          "Capability checks happen twice: once in the JS bridge, for a good error message, and once in the host, because the bridge runs in the same isolate as the application and can be bypassed.",
          "`bridge.allows(method)` answers the capability question only. `bridge.supported(method)` also asks the adapter — `menu.set` passes `window.manage` on the web too, but a browser has no menu bar. An interface that draws its options from `allows` lies.",
        ],
      },
      {
        name: "The six hosts",
        signature: "@raptor/desktop · mobile · web-host · service-host · cli-host · device-host",
        summary:
          "The same application, unchanged, against six different hosts. What differs is not the API but what each host is willing to grant — and each one has a refusal worth knowing about.",
        example: `// The same call, six answers.
await bridge.call("window.open", { width: 900 });
// desktop → a real window
// mobile  → navigation, driven by the adapter
// web     → the page itself; portability, not isolation
// service → refused: a service has no windows
// cli     → refused
// device  → refused`,
        notes: [
          "**Terminal:** without an interactive TTY a question is *refused*, not assumed. A tool in CI gets `capability-unavailable` and can say run me with --yes instead of guessing yes at a destructive command.",
          "**Service:** the supervisor owns the sockets — the application asks for a listener *by name*, and the port comes from the deployment. SIGTERM moves it to draining, not death.",
          "**Device:** `watchdog.pet` is the one method in the whole contract that cannot ask for a capability. One that could be refused would make optional exactly the mechanism that saves the product.",
          "**Browser:** the bridge gives portability, *not* isolation. The page and the host share an isolate; the real boundary is the origin sandbox.",
        ],
      },
    ],
  },
  {
    slug: "core",
    name: "@raptor/core",
    tagline: "Fine-grained, glitch-free reactivity: signals, derived, effects.",
    entries: [
      {
        name: "state",
        signature: "state<T>(initial: T, options?): State<T>",
        summary: "Creates a mutable signal. The returned value is a callable accessor with set / update / peek.",
        params: [
          { name: "initial", type: "T", desc: "Initial value." },
          { name: "options.equal", type: "(a,b)=>boolean | false", desc: "Equality check; false always notifies." },
        ],
        returns: "State<T> — call to read, .set / .update to write, .peek to read untracked.",
        example: `const count = state(0);
count();            // 0
count.set(5);
count.update(n => n + 1);
count.peek();       // read without tracking`,
        demo: "state",
        notes: [
          "`count()` reads *and* subscribes. `count.peek()` reads without subscribing — reach for it inside a handler where you want the current value, not a dependency.",
          "Importing from `@raptor/core` and from `@raptor/dom` gives the **same function**, not a copy: one module, one reactive graph. The bundler emits `@raptor/core` once even if you import from both.",
          "By default two `===` values do not notify. Pass `{ equal: false }` when every write must notify — for instance an object you mutate in place.",
        ],
      },
      {
        name: "derived",
        signature: "derived<T>(compute: () => T, options?): Derived<T>",
        summary: "A read-only computed value. Recomputes lazily on read; glitch-free.",
        returns: "Derived<T> — a callable accessor (and .peek).",
        example: `const doubled = derived(() => count() * 2);
doubled(); // 10`,
        demo: "derived",
        notes: [
          "Recomputes lazily, on read, and only when a dependency actually changed — not once per read.",
          "Glitch-free: in a chain `a → b → c`, `c` never observes an inconsistent half-updated combination.",
        ],
      },
      {
        name: "effect",
        signature: "effect(fn: () => void): Dispose",
        summary: "Runs fn now and re-runs it when any signal it read changes.",
        returns: "Dispose — call to stop the effect.",
        example: `const stop = effect(() => console.log(count()));
stop();`,
        demo: "effect",
        notes: [
          "Dependencies are re-collected on every run. A branch that did not execute creates no dependency.",
          "Returns a `Dispose`. Inside a component prefer `onCleanup(stop)` — otherwise the effect outlives the node it belonged to.",
        ],
      },
      {
        name: "batch",
        signature: "batch<T>(fn: () => T): T",
        summary: "Groups writes so effects and bindings run once, at the end.",
        example: `batch(() => { count.set(1); count.set(2); });`,
        demo: "batch",
        notes: [
          "Effects never observe the in-between state. Without batching, two writes mean two passes over the UI — and a moment where the fields disagree with each other.",
          "Operations arriving from RaptorWire are already batched: one network frame is one UI commit.",
        ],
      },
      {
        name: "untracked",
        signature: "untracked<T>(fn: () => T): T",
        summary: "Reads signals inside fn without registering dependencies.",
        example: `const snap = untracked(() => count());`,
      },
      {
        name: "memo",
        signature: "memo<T>(compute: () => T, options?): Derived<T>",
        summary: "Like `derived`, but eager rather than lazy — it recomputes when a dependency changes instead of waiting for a read.",
        example: `const total = memo(() => items().reduce((a, b) => a + b.price, 0));`,
        notes: [
          "Prefer `derived` unless something outside the reactive graph reads the value and must never see a stale one.",
        ],
      },
      {
        name: "createRoot",
        signature: "createRoot<T>(fn: (dispose: () => void) => T): T",
        summary: "Creates an ownership scope. Everything created inside — effects, nested scopes — is disposed together.",
        returns: "Whatever fn returns; call the `dispose` it receives to tear the scope down.",
        example: `const dispose = createRoot((dispose) => {
  effect(() => console.log(count()));
  return dispose;
});
dispose();   // the effect stops`,
        notes: [
          "`render()` opens a root for you, so components rarely need this. Reach for it when you create reactive work outside a component — a worker, a test, a long-lived service.",
          "Without a root, an `effect` has no owner and nothing will ever clean it up.",
        ],
      },
      {
        name: "onCleanup",
        signature: "onCleanup(fn: () => void): void",
        summary: "Registers a callback that runs when the current owner is disposed — or before an effect re-runs.",
        example: `effect(() => {
  const id = setInterval(tick, 1000);
  onCleanup(() => clearInterval(id));
});`,
        notes: [
          "Inside an effect it runs before *every* re-run, not only at teardown. That is what makes it the right place to cancel the previous subscription, timer or request.",
        ],
      },
      {
        name: "getOwner / runWithOwner",
        signature: "getOwner(): Owner | null  ·  runWithOwner<T>(owner: Owner, fn: () => T): T",
        summary: "Capture the current ownership scope and run code inside it later — needed when reactive work is created from an async callback.",
        example: `const owner = getOwner();
setTimeout(() => {
  runWithOwner(owner, () => effect(() => console.log(count())));
}, 100);`,
        notes: [
          "After an `await`, the owner is gone: the effect you create would never be disposed. Capture before, restore after.",
        ],
      },
    ],
  },
  {
    slug: "dom",
    name: "@raptor/dom",
    tagline: "Fine-grained DOM runtime, control flow, the JSX runtime and the `R` hyperscript builder.",
    entries: [
      {
        name: "render",
        signature: "render(component: Component, container: Element): () => void",
        summary: "Mounts a component into a container. Returns a dispose function.",
        example: `const dispose = render(App, document.getElementById("app"));`,
      },
      {
        name: "For",
        signature: "For<T>(props: { each: () => readonly T[]; children: (item: T, i: number) => Child })",
        summary: "Keyed list that reuses DOM nodes for unchanged items.",
        example: `<For each={() => items()}>
  {(item, i) => <li>{i}: {item.text}</li>}
</For>`,
        demo: "for",
        notes: [
          "Unchanged rows keep their DOM nodes — and with them focus, cursor position, and the playback state of a `<video>` inside.",
          "`each` must be an accessor (`() => items()`), not the array read once.",
        ],
      },
      {
        name: "Show",
        signature: "Show(props: { when: () => unknown; children: Child; fallback?: Child })",
        summary: "Mounts children when `when` is truthy, otherwise fallback.",
        example: `<Show when={() => user()} fallback={<p>Guest</p>}>
  <p>Welcome</p>
</Show>`,
        demo: "show",
        notes: [
          "It really mounts and unmounts — this is not `display:none`. Effects inside are disposed when it hides.",
          "For something expensive to build and toggled often, hiding with CSS can be cheaper.",
        ],
      },
      {
        name: "R",
        signature: "R.<tag>(props?, ...children)\nR(Component, props?, ...children)",
        summary:
          "Hyperscript builder — the same fine-grained primitives JSX compiles to, without a build step. The first argument is props only when it is a plain object; anything else is a child. Handy for runtime-evaluated code (Playground, REPL) or projects with no compiler.",
        example: `R.div({ class: "row" },
  R.span({ style: () => color() }, () => count()),
  R.button({ "on:click": () => count.update(n => n + 1) }, "+1"))`,
      },
      {
        name: "mountChild",
        signature: "mountChild(parent, child, anchor)",
        summary: "Low-level: mount a child (text, node, accessor, block or array). This is what the JSX runtime calls.",
        example: `mountChild(el, () => count(), null); // reactive text node`,
      },
      {
        name: "onMount",
        signature: "onMount(fn: () => void): void",
        summary: "Runs once, after the component's DOM exists. The place for measurements, focus and third-party widgets.",
        example: `function Chart() {
  let el;
  onMount(() => new SomeChartLib(el).render());
  return <div ref={(n) => (el = n)} />;
}`,
        notes: [
          "A component body runs before its nodes are in the document, so measuring there gives you zeros.",
        ],
      },
      {
        name: "template",
        signature: "template(build: () => Element): () => Element",
        summary: "Builds a skeleton element once and clones it for every subsequent call — the optimisation behind bulk list creation.",
        example: `const row = template(() => {
  const li = document.createElement("li");
  li.append(document.createElement("span"));
  return li;
});
const a = row(), b = row();   // cloneNode, not createElement`,
        notes: [
          "This is what moved `create 10,000` from ~65 ms to ~33 ms — see [Performance, measured](/learn/performance).",
        ],
      },
    ],
  },
  {
    slug: "ui",
    name: "@raptor/ui",
    tagline: "The component library — built on the same bindings, with styles you can ignore.",
    entries: [
      {
        name: "Components",
        signature: "import { Button } from \"@raptor/ui\"",
        summary:
          "Components are plain functions returning real DOM, so JSX is optional: call `Button({ ... })` directly or write `<Button />` if you compile JSX. Every one has a live demo in [Components](/components).",
        example: `import { Button, Dialog } from "@raptor/ui";
import { installStyles } from "@raptor/ui/styles";

installStyles();            // optional — or bring your own CSS

const open = state(false);
Button({ onClick: () => open.set(true), children: "Open" });`,
        notes: [
          "36 subpath entry points, so importing one component does not pull the rest — the bundler tree-shakes a barrel from 58 modules down to 9.",
          "Styles are a separate import. The components only set `rui-*` classes and ARIA attributes; skipping `installStyles()` leaves them unstyled but fully functional.",
        ],
      },
      {
        name: "Headless primitives",
        signature: "Portal, focusTrap, virtualizer, sortable, hotkeys, persistedState, undoRedo",
        summary:
          "The behaviour underneath the components, exposed on its own for when you want your own markup.",
        example: `import { focusTrap, virtualizer } from "@raptor/ui";

const release = focusTrap(dialogEl);       // tab cycles inside
const rows = virtualizer({ count: 100000, itemHeight: 32 });`,
        notes: [
          "These are what make the shipped Dialog, DataGrid and Combobox work — you are not choosing between the library and control.",
        ],
      },
    ],
  },
  {
    slug: "compiler",
    name: "@raptor/compiler",
    tagline: "The stable semantic core of RaptorEngine: `.raptor` parser, IR, semantic graph, HMR diff.",
    entries: [
      {
        name: "parseModule",
        signature: "parseModule(source: string, path: string): IRModule",
        summary: "Parses a `.raptor` file into Raptor IR — signals, deriveds, server signals, elements and bindings.",
        returns: "IRModule — throws `RaptorParseError` with a source span on bad input.",
        example: `const ir = parseModule(source, "App.raptor");
ir.components[0].signals;        // [count]
ir.components[0].serverSignals;  // [BTC.price]`,
        notes: [
          "Separate from the bundler and the engine on purpose: the semantic core has no build-tooling dependency. See [The `.raptor` format](/learn/raptor-format).",
        ],
      },
      {
        name: "buildGraph",
        signature: "buildGraph(ir: IRModule): SemanticGraph",
        summary: "Turns the IR into the Semantic Application Graph — nodes for every reactive value, edges for every dependency and every path to an output.",
        example: `const graph = buildGraph(ir);`,
        notes: [
          "This graph is what makes dead-signal elimination possible: a derived with no path to the DOM or an effect can be proved unobservable and deleted.",
        ],
      },
      {
        name: "diffModules",
        signature: "diffModules(before: IRModule, after: IRModule): GraphDiff",
        summary: "Compares two versions of a module and reports which components changed, which bindings moved and which wire addresses shifted.",
        returns: "GraphDiff — component patches plus wire changes.",
        example: `const diff = diffModules(previousIr, nextIr);`,
        notes: [
          "The basis for state-preserving hot reload: the dev server patches what changed instead of remounting the tree.",
        ],
      },
    ],
  },
  {
    slug: "bundle",
    name: "@raptor/bundle",
    tagline: "The project's own TSX bundler — zero runtime dependencies, single-file output, live-reload dev server.",
    entries: [
      {
        name: "raptor-bundle (CLI)",
        signature: "raptor-bundle build <entry> [--out f] [--html f]\nraptor-bundle dev <entry> [--port] [--root]",
        summary: "Build a single bundle.js (+ index.html), or run a dev server with live-reload.",
        example: `raptor-bundle build src/main.tsx --out dist/bundle.js --html index.html
raptor-bundle dev   src/main.tsx --root . --port 5173`,
      },
      {
        name: "bundleApp",
        signature: "bundleApp(entryFile: string, options?): { code, files }",
        summary: "Bundle a graph programmatically into one browser file.",
        example: `const { code, files } = bundleApp("/abs/src/main.tsx");`,
      },
      {
        name: "startDevServer",
        signature: "startDevServer(options): http.Server",
        summary: "Start the node:http dev server (SSE live-reload) programmatically.",
        example: `startDevServer({ entry: "src/main.tsx", root: ".", port: 5173 });`,
      },
    ],
  },
  {
    slug: "wire-core",
    name: "@raptor/wire-core",
    tagline: "State-aware protocol: versioned Document, delta ops, address space.",
    entries: [
      {
        name: "Document",
        signature: "new Document()",
        summary: "A versioned document. apply(op) returns a Change and bumps `version` (the key for delta resync).",
        example: `const doc = new Document();
doc.apply({ kind: "set",   handle: "job:1", field: "progress", value: 10 });
doc.apply({ kind: "inc",   handle: "job:1", field: "progress", delta: 5 });
doc.apply({ kind: "patch", handle: "job:1", fields: { name: "build" } });
doc.get("job:1"); // { progress: 15, name: "build" }`,
      },
      {
        name: "AddressBook",
        signature: "new AddressBook(start?)",
        summary: "Reactive Address Space: interns field names to compact per-session ids sent on the hot path.",
        example: `const book = new AddressBook();
const { address } = book.assign("job:1.progress");
book.handleOf(address); // "job:1.progress"`,
      },
      {
        name: "SchemaCodec",
        signature: "new SchemaCodec(schema: Record<string, FieldSchema>)",
        summary: "Adaptive encoding: percentage→1 byte, money→scaled int, enum→index.",
        example: `new SchemaCodec({
  progress: { type: "percentage" },
  price:    { type: "money", scale: 2 },
});`,
      },
    ],
  },
  {
    slug: "server",
    name: "@raptor/server",
    tagline: "Authoritative reactive store with query / mutation / subscription.",
    entries: [
      {
        name: "raptorServer",
        signature: "raptorServer(options): RaptorServer",
        summary: "Creates a server with an authoritative ReactiveStore. Define queries and mutations on it.",
        example: `const app = raptorServer({ build: "app-0.1.0" });
app.query("board", { select: () => ["cards", "card:"] });
app.serve(transport);`,
      },
      {
        name: "app.mutation",
        signature: "app.mutation(name, { authorize?, run })",
        summary: "A typed command. This is where your domain logic, auth and persistence live.",
        params: [
          { name: "authorize", type: "(ctx) => boolean", desc: "Optional access check; ctx = { input, store }." },
          { name: "run", type: "(ctx) => WireValue", desc: "Applies store ops; runs inside a transaction." },
        ],
        example: `app.mutation("addCard", {
  authorize: ({ input }) => true,
  run: ({ input, store }) => {
    store.transaction(() => {
      store.setField("card:" + input.id, "title", input.title);
      store.append("cards", input.id);
    });
    return { ok: true };
  },
});`,
      },
      {
        name: "ReactiveStore",
        signature: "store.setSignal / setField / patch / append / remove / transaction",
        summary: "The authoritative state. Writes emit delta ops to subscribed clients.",
        example: `store.setSignal("cpu", 12);
store.patch("job:1", { progress: 40 });
store.transaction(() => { /* atomic: one commit per frame */ });`,
      },
      {
        name: "serveOverWebSocket",
        signature: "serveOverWebSocket(app, httpServer, options?): WebSocketHandle",
        summary:
          "Attaches a RaptorServer to an ordinary node:http server: every accepted upgrade becomes a RaptorWire connection. RFC 6455 is implemented in-package — no `ws` dependency.",
        params: [
          { name: "app", type: "RaptorServer", desc: "The server whose queries and mutations are exposed." },
          { name: "httpServer", type: "http.Server", desc: "An existing server — the page and the protocol can share one port." },
          { name: "options.path", type: "string", desc: "Upgrade path (default \"/raptor\")." },
          { name: "options.pingIntervalMs", type: "number", desc: "Keep-alive ping interval; 0 disables (default 30000)." },
        ],
        returns: "WebSocketHandle — `connectionCount`, and `close()` for a clean shutdown.",
        example: `const http = createServer(handler);
serveOverWebSocket(app, http);
http.listen(5190);`,
        notes: [
          "Call `handle.close()` *before* `httpServer.close()`: once a socket is upgraded the HTTP server no longer tracks it, so otherwise it stays open and the process never exits.",
          "A dropped connection cleans up its own subscriptions. Check with `app.store.subscriptionCount`.",
          "The [Realtime todo](/learn/todo-realtime) tutorial uses it end to end.",
        ],
      },
    ],
  },
  {
    slug: "wire-client",
    name: "@raptor/wire-client",
    tagline: "Session + reactive replica; each handle is a signal.",
    entries: [
      {
        name: "RaptorClient",
        signature: "new RaptorClient(transport, options?)",
        summary: "Connects over a transport, keeps a reactive replica. connect / subscribe / mutate / resume / signal.",
        example: `const client = new RaptorClient(transport);
await client.connect();
client.subscribe("board");
client.signal("cpu")();          // live value (reactive)
await client.mutate("addCard", { id: 1, title: "New" });`,
        demo: "client",
        notes: [
          "`client.signal(handle)` is not a getter over cached JSON — it is the signal itself. Bind it directly and only that handle's binding updates.",
          "After the first snapshot no more snapshots arrive. If `snapshotsReceived` keeps climbing, something is re-subscribing when it should not.",
          "`resume(transport, query)` keeps the replica and asks only for the delta since its version — see [Realtime todo](/learn/todo-realtime).",
        ],
      },
      {
        name: "Transport",
        signature: "interface Transport { send; onMessage; close }",
        summary: "The 3-method interface RaptorWire runs on. Two implementations ship — `createLoopback()` and `connectWebSocket()` — so you only write one yourself for an unusual channel (a worker, WebTransport, a message bus).",
        example: `function wsTransport(ws: WebSocket): Transport {
  ws.binaryType = "arraybuffer";
  return {
    send: (data) => ws.send(data),
    onMessage: (h) => ws.addEventListener("message",
      (e) => h(new Uint8Array(e.data))),
    close: () => ws.close(),
  };
}`,
      },
      {
        name: "createLoopback",
        signature: "createLoopback(): { client, server, stats }",
        summary: "An in-process transport pair (used for demos and tests), with a byte counter.",
        example: `const link = createLoopback();
app.serve(link.server);
const client = new RaptorClient(link.client);`,
      },
      {
        name: "connectWebSocket",
        signature: "connectWebSocket(url, options?): Promise<Transport>",
        summary:
          "Opens a WebSocket and resolves once it is ready to send. Uses only the global `WebSocket`, so it bundles for the browser with nothing from node:.",
        params: [
          { name: "url", type: "string", desc: "ws:// or wss:// endpoint, e.g. `ws://host/raptor`." },
          { name: "options.timeoutMs", type: "number", desc: "How long to wait for the socket to open (default 10000)." },
          { name: "options.onClose", type: "() => void", desc: "Fired when the connection drops — where you start `resume`." },
        ],
        returns: "Promise<Transport> — rejects on failure or timeout, so you can retry instead of hanging.",
        example: `const transport = await connectWebSocket(
  \`ws://\${location.host}/raptor\`,
  { onClose: () => status.set("offline") },
);
const client = new RaptorClient(transport);
await client.connect();`,
        notes: [
          "To reconnect, open a *new* transport and hand it to `client.resume(...)`: `RaptorClient` keeps its replica across connections.",
          "Its server-side counterpart is `serveOverWebSocket` from `@raptor/server`.",
        ],
      },
    ],
  },
  {
    slug: "engine",
    name: "@raptor/engine",
    tagline: "Semantic build: DSE/Fusion, multi-target codegen, HMR, CLI raptor.",
    entries: [
      {
        name: "buildModule",
        signature: "buildModule(source, filename, options?): BuildResult",
        summary: "Compiles a .raptor module: optimizes the graph and emits browser + server + wire from one source.",
        example: `const result = buildModule(source, "App.raptor");
result.browser;  // browser code
result.server;   // server producers
result.wire;     // RAS manifest (addresses + schema)`,
      },
      {
        name: "DevEngine",
        signature: "new DevEngine()",
        summary: "Stateful Reactive HMR: diffs graphs and patches state-preserving, with an explicit remount reason on structural change.",
        example: `const dev = new DevEngine();
dev.update("App.raptor", source);
dev.update("App.raptor", edited); // patched, state kept`,
      },
      {
        name: "optimize",
        signature: "optimize(module: IRModule, options?: { fusion: boolean }): OptimizeResult",
        summary:
          "Runs the passes over the semantic graph: dead-signal elimination removes anything with no path to an output, fusion inlines a derived that has a single consumer.",
        returns: "OptimizeResult — `{ module, trace, metrics }`: the rewritten IR, every decision with its reason, and the counts.",
        example: `const result = optimize(ir);
result.metrics;   // { eliminated: 1, fused: 1 }
result.trace;
// [{ pass: "DSE",    action: "eliminate", target: "App.unused",
//    detail: "no observable consumer" },
//  { pass: "Fusion", action: "fuse",      target: "App.label",
//    detail: "fused into App/e2#t0 (single consumer)" }]`,
        notes: [
          "A minifier cannot do this: removing a live reactive node changes the dependency graph, so it takes graph knowledge, not text analysis.",
          "Mark a derived `@debug` in the source to block fusion when you want to inspect it.",
          "Walked through in [The .raptor format](/learn/raptor-format).",
        ],
      },
      {
        name: "emitBrowser / emitServer / emitWireManifest",
        signature: "emitBrowser(module: IRModule): string  ·  emitServer(module): ServerOutput  ·  emitWireManifest(module): WireManifest",
        summary:
          "Multi-target code generation from one optimised graph: the browser module, the server module, and the wire manifest that maps logical addresses to compact ones.",
        example: `emitWireManifest(optimized.module);
// { schemas: ["money"],
//   addresses: [{ logical: "BTC.price", ras: "0x18A1",
//                 decoderSlot: 0, schema: "money" }] }`,
        notes: [
          "This is where the one-declaration claim becomes concrete: the type, the binding, the wire address and the schema all come from the same `serverSignal` line.",
        ],
      },
      {
        name: "inspectGraph / invalidationTrace",
        signature: "inspectGraph(graph)  ·  invalidationTrace(graph, startId)  ·  formatOptimizationTrace(trace)  ·  reactiveNodeId(graph, name)",
        summary: "Introspection for when the compiler removed something you expected to keep — show the graph, trace what a node invalidates, print why each optimisation fired.",
        example: `console.log(formatOptimizationTrace(result.trace));

const id = reactiveNodeId(graph, "count");
if (id) console.log(invalidationTrace(graph, id));  // what changing it reaches`,
      },
    ],
  },
  {
    slug: "run",
    name: "@raptor/run",
    tagline: "Server runtime: serverSignal → store → RaptorWire → client, plus SSR.",
    entries: [
      {
        name: "RaptorRuntime",
        signature: "RaptorRuntime.fromBuild(result: BuildResult, options?): RaptorRuntime",
        summary:
          "Takes a compiled build and stands up the server side of it: every `serverSignal` becomes an address backed by a store, with a RaptorWire endpoint in front. Writing a value broadcasts a delta to every connected client.",
        params: [
          { name: "result", type: "BuildResult", desc: "Output of `buildModule` — its producers become the addresses." },
          { name: "options.initial", type: "Record<string, WireValue>", desc: "Starting value per address; anything unset starts at 0." },
          { name: "options.routes", type: "RouteDef[]", desc: "Route table. Defaults to the first component mounted at `/`." },
        ],
        example: `const runtime = RaptorRuntime.fromBuild(result, {
  initial: { "BTC.price": 60000 },
});

runtime.produce("BTC.price", 61000);        // one delta to every client
runtime.produceMany([                        // one frame, one UI commit
  { address: "BTC.price", value: 61000 },
  { address: "BTC.volume", value: 12 },
]);

const channel = runtime.connect();           // a client attaches here
const rendered = runtime.ssr("/");           // SsrResult | null`,
        returns: "RaptorRuntime — `produce`, `produceMany`, `connect`, `ssr`, `handleRequest`, `value`, `onEvent`.",
        notes: [
          "`ssr(path)` returns `{ html, resume }` or **null** when no route matches — it is not a string, and an unmatched path is not an error.",
          "`connect()` returns a channel implementing the same 3-method `Transport` contract, so a client attaches to it exactly as it would to a socket.",
          "`produceMany` sends one frame rather than several: the client applies the whole batch in a single UI commit.",
          "This is the RaptorEngine path (`.raptor` sources). For a JSX app you use `@raptor/server` and `serveOverWebSocket` directly — see [Realtime todo](/learn/todo-realtime).",
        ],
      },
      {
        name: "renderComponent / renderDocument",
        signature: "renderComponent(component: IRComponent, options: SsrOptions): SsrResult  ·  renderDocument(result: SsrResult, title?): string",
        summary: "Server-side rendering for the `.raptor` path. Renders a compiled IR component to HTML plus a resume payload, then wraps it in a document.",
        returns: "SsrResult — `{ html, resume }`. `resume` is what lets the client attach to the existing nodes instead of re-creating them.",
        example: `const result = renderComponent(ir.components[0], {
  serverValue: (address) => store.get(address),
});
const html = renderDocument(result, "Raptor");`,
        notes: [
          "It takes an `IRComponent` from `@raptor/compiler`, not a JSX function — this is the RaptorEngine path, not the `@raptor/bundle` one.",
          "`serverValue` is how the renderer reads the current value of each `serverSignal` out of your store.",
        ],
      },
      {
        name: "matchRoute",
        signature: "matchRoute(routes: RouteDef[], path: string): RouteMatch | null",
        summary: "File-based routing: match a path against the route table and extract its parameters.",
        returns: "RouteMatch with `params`, or null when nothing matches.",
        example: `const match = matchRoute(routes, "/users/42");
match.params.id;   // "42"`,
        notes: [
          "Basic by design: no nested layouts and no data loaders. If you need those today, route in front of Raptor.",
        ],
      },
      {
        name: "RaptorDevServer",
        signature: "new RaptorDevServer({ entry, routes?, port? })",
        summary: "The development server for the `.raptor` path: server rendering, plus hot reload driven by the semantic graph diff rather than by file timestamps.",
        example: `const dev = new RaptorDevServer({ entry: "src/App.raptor" });
await dev.listen(5173);`,
        notes: [
          "Because the diff is computed on the graph, a change that only affects one binding patches that binding — component state survives the reload.",
          "Different from `raptor-bundle dev`, which serves a client-only JSX app. See [What's ready, what's yours](/learn/whats-ready).",
        ],
      },
    ],
  },
  {
    slug: "test",
    name: "@raptor/test",
    tagline: "Autonomous behavioral testing + backend digital twin.",
    entries: [
      {
        name: "RaptorTest",
        signature: "new RaptorTest(config)",
        summary: "observe → infer → synthesize → explore → verify → replay. Finds bugs without hand-written tests.",
        example: `const rt = new RaptorTest({ harness, twin, invariants, maxDepth: 3 });
rt.discover();                  // autonomous action sequences
const findings = rt.explore();  // + chaos + oracle → capsules
rt.replay(findings[0].capsule); // deterministic (virtual time)`,
      },
      {
        name: "RaptorTwin",
        signature: "new RaptorTwin()  ·  twin.route(method, path, handler)  ·  twin.db",
        summary:
          "An in-memory stand-in for your backend, with a tiny record store. Exploration runs thousands of scenarios against it, so it has to be fast and deterministic — a real server is neither.",
        example: `const twin = new RaptorTwin();
twin.db.create("cart", { count: 0 });
twin.route("GET", "/cart", (_req, db) => ({
  status: 200,
  body: { count: db.read("cart", 1).count },
}));`,
        notes: [
          "`twin.snapshot()` is taken once at construction and restored before every scenario — that is what makes each run start from the same world.",
          "It is a model of your backend, not your backend. A bug that only exists in the real one stays there.",
        ],
      },
      {
        name: "AppHarness",
        signature: "interface AppHarness { currentState; perform; snapshot; restore; reset }",
        summary:
          "How RaptorTest reads and drives your app: what state it is in, which actions are available, and how to perform one. It drives your real client code rather than a mock of it.",
        example: `const harness: AppHarness = {
  currentState: () => ({
    route: ui.route,
    facts: { "cart.count": ui.count },
    actions: ui.route === "/product" ? [ADD, GO_CART] : [BACK],
  }),
  perform(id, ctx) { /* ctx.request(...) */ },
  snapshot: () => ({ ...ui }),
  restore: (snap) => Object.assign(ui, snap),
};`,
        notes: [
          "`facts` is what invariants read. Put in it whatever must stay consistent with the server.",
          "Actions are identified semantically (`button:Add to cart:ProductCard`), so a reproduction survives a markup refactor.",
        ],
      },
      {
        name: "explore",
        signature: "rt.explore(): Finding[]",
        summary:
          "Synthesises action sequences, runs each under a set of network schedules (faults, delays, stale reads), checks every invariant, and minimises anything that fails.",
        returns: "Finding[] — each carries a replayable capsule and the schedule label that triggered it.",
        example: `const rt = new RaptorTest({ harness, twin, invariants, maxDepth: 3, seed: 1 });
for (const f of rt.explore()) {
  console.log(f.capsule.id, f.scheduleLabel, f.capsule.actionLog);
}`,
        notes: [
          "Bounded by `maxDepth` (default 3). A bug needing five specific actions in order will not surface at the default.",
          "`seed` makes a run reproducible. Same seed, same exploration.",
          "See [Testing that finds its own bugs](/learn/autonomous-testing) for the full walkthrough.",
        ],
      },
      {
        name: "Invariants and oracles",
        signature: "{ name: string; check: (ctx: OracleContext) => boolean }",
        summary:
          "What must always hold. Built-in oracles (no uncaught exceptions, no infinite loading) apply on top of whatever you declare.",
        example: `const invariants = [{
  name: "cart-count-converges",
  check: ({ twin, ui }) =>
    ui.facts["cart.count"] === twin.db.read("cart", 1).count,
}];`,
        notes: [
          "An invariant you do not declare cannot be violated — the value is in what you assert about your own domain.",
        ],
      },
      {
        name: "Capsules",
        signature: "serializeCapsule(capsule): string  ·  parseCapsule(text): Capsule",
        summary:
          "A `.raptorcap` capsule holds the action log, the network schedule and the build fingerprint. It is the reproduction, not a description of one.",
        example: `const text = serializeCapsule(finding.capsule);
// later, elsewhere
const capsule = parseCapsule(text);
const { reproduced, ui, detail } = rt.replay(capsule);
// reproduced: true — the failure happened again`,
        notes: [
          "Replay works because the reactive core uses no `Math.random` and no wall-clock time — determinism is the enabling constraint.",
        ],
      },
    ],
  },
  {
    slug: "profile",
    name: "@raptor/profile",
    tagline: "Runtime telemetry that feeds build decisions — never correctness.",
    entries: [
      {
        name: "Profiler",
        signature: "new Profiler(thresholds?)",
        summary: "Collects behaviour from a running app: wire payload sizes, which routes are used together, which chunks load in sequence.",
        example: `const profiler = new Profiler();
// ... app runs ...
const profile = profiler.snapshot();`,
      },
      {
        name: "planFromProfile",
        signature: "planFromProfile(profile, options?): PlanResult",
        summary: "Turns a collected profile into build plan hints — chunk folding, preload order, batching, encoding choices.",
        returns: "PlanResult — hints consumed by `buildModule({ planHints })`.",
        example: `const plan = planFromProfile(profile);
const out = buildModule(source, "App.raptor", { planHints: plan.hints });`,
        notes: [
          "Profile-guided optimisation, applied to layout rather than to code. Hints only ever change *how* something is packaged or encoded — a wrong hint makes the build slower, never incorrect.",
        ],
      },
      {
        name: "runScenario",
        signature: "runScenario(scenario: Scenario): WirePayloadStat[]",
        summary: "Replays a scripted sequence of interactions to collect wire statistics without a real user.",
        example: `const stats = runScenario({ steps: [...] });
wireByteSize(stats);`,
      },
    ],
  },
  {
    slug: "wire-codec",
    name: "@raptor/wire-codec",
    tagline: "The binary primitives everything else on the wire is built from.",
    entries: [
      {
        name: "Writer / Reader",
        signature: "new Writer(initialCapacity?)  ·  new Reader(bytes)",
        summary:
          "Length-prefixed binary primitives: varint (LEB128) for unsigned, zig-zag for signed, fixed-width IEEE for float64, UTF-8 for strings. No base64, and no repeated field names — those live in the schema.",
        example: `const w = new Writer();
w.uint(42);
w.string("hello");
const bytes = w.bytes();

const r = new Reader(bytes);
r.uint();     // 42
r.string();   // "hello"`,
        notes: [
          "You rarely touch this directly — `@raptor/wire-core` builds operations on top of it. It is here because the encoding is the reason a delta is small.",
        ],
      },
    ],
  },
];
