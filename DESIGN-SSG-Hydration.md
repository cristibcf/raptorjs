# Design: SSG / Prerender / Hydration + Head (P3, report #1 & #7)

Status: **proposal** — architecture and phased plan, no code yet.
Scope: the largest gap from the rewrite report. Enables a static, SEO-indexable
build (the 17k-page site that had to abandon prerender), while keeping the
existing SPA output working unchanged.

---

## 1. Goal

Turn the single-SPA output of `@raptorstack/engine` (`bundle/`) into an optional
**prerendered multi-page** build:

- one HTML file per route, fully rendered to markup at build time;
- each page ships the same JS bundle, which **hydrates** the prerendered DOM
  instead of recreating it;
- `<title>`/`<meta>` set per route end up **in the served HTML** (crawlers see
  them without running JS);
- the dynamic-SPA build stays available and unchanged (SSG is opt-in).

Non-goals (explicitly out of scope for P3): server-side *runtime* rendering per
request (SSR on a live server), streaming, React-style Suspense/islands,
per-request data fetching. SSG = render at build, hydrate on load.

---

## 2. Why the current model makes this feasible

The runtime is already DOM-agnostic: [runtime.ts](packages/raptorjs/src/dom/runtime.ts)
treats nodes structurally (`El = any`) and reaches the DOM only through
`globalThis.document` (`doc()`). So "render on the server" = install a headless
`document`, run the app, serialize. Two existing facts confirm the intent:

- `mini-dom` ([testing/mini-dom.ts](packages/raptorjs/src/dom/testing/mini-dom.ts))
  already renders a tree and has `toHTML()`.
- `setFormProperty` writes the attribute too, with the comment *"what gets
  serialized on SSR"* ([runtime.ts:116](packages/raptorjs/src/dom/runtime.ts:116)).

And P1 already shipped the matcher SSG needs: `matchRoutes` /
[router.ts](packages/raptorjs/src/dom/router.ts) is exported standalone precisely
so a build can enumerate routes with the same logic the client uses.

**The hard part is hydration**, not server rendering — the client runtime
currently *always creates* nodes; it must learn to *adopt* existing ones.

---

## 3. Architecture — four subsystems

### 3.1 Server renderer (`@raptorstack/raptorjs/dom/server`)

A production headless `document` + a string serializer. `mini-dom`'s `toHTML()`
is close but **insufficient**, so this is a dedicated module rather than reusing
the test dom:

- **void elements** (`<br>`, `<img>`, `<input>`, …) must self-close; mini-dom
  always emits `<tag></tag>`.
- **`style` is lost**: mini-dom keeps `el.style` as a side object never
  serialized into the `style=""` attribute. SSR must flush it.
- **attribute escaping** and correct boolean-attr emission.
- **DOCTYPE + full document** serialization (`<html><head>…<body>…`).

API:
```
renderToString(component: () => Child): { html: string; head: HeadSnapshot }
```
Implementation: install the server document, `render()` the component into a
detached root, run `onMount` callbacks? **No** — mount effects that touch
`window`/timers must be skippable on the server (see §5, open question O1); SSR
runs reactive setup once, serializes, then disposes the root.

Risk: **medium**. Isolated, no changes to the client runtime. The serializer is
mechanical; the subtlety is matching exactly what hydration expects byte-for-byte
in structure (not whitespace).

### 3.2 Hydration (`hydrate()` in the client runtime)

> **Decision (3C shipped):** `hydrate()` is implemented as **client-takeover**,
> not DOM-reuse. The runtime builds the DOM **bottom-up, per element** (`jsx()`
> and `R` create children before their parent; the compiler emits `createElement`,
> not a top-down `template()`). True adoption needs reactive effects bound to the
> *existing* server nodes, which requires claiming nodes top-down as they are
> built — impossible against bottom-up construction without a compiler/template
> change. So `hydrate(component, container)` builds the fresh client tree (server
> markup stays visible), then **replaces** the server markup in one synchronous
> swap. SEO is served by the static HTML (3A/3B/3D); this makes the page
> interactive. Cost: a client mount on load and no reuse of uncontrolled DOM
> state. True DOM-reusing hydration (below) remains a separate, larger project.

The ideal (deferred) design: a hydration mode added to [runtime.ts](packages/raptorjs/src/dom/runtime.ts)
where node-producing primitives **adopt** instead of **create**, walking the
server DOM in render order:

- `hydrate(component, container)` — like `render`, but seeds a cursor over
  `container`'s existing children.
- `createElement` / `template` → claim the next matching existing element
  instead of `document.createElement` / `cloneNode`.
- `applyProps` → **do not** set static attributes already present; **do** attach
  event listeners and start reactive attribute effects (reading current value
  from the DOM to avoid a redundant first write).
- `mountChild` / `mountDynamic` → adopt the existing text node / claim the
  comment anchors the server emitted (the `For`/`Show`/dynamic-region markers are
  already comment-based — [control.ts](packages/raptorjs/src/dom/control.ts),
  [runtime.ts](packages/raptorjs/src/dom/runtime.ts) `mountDynamic`), so the
  anchor protocol is mostly in place.

Mechanism: a module-level hydration cursor/context, consulted by the create
functions. Off by default (zero overhead for the pure-SPA and client-render
paths); switched on only within `hydrate()`.

Mismatch policy: on a structural mismatch between expected and actual DOM, **warn
and fall back to client-create** for that subtree (never throw — a mismatch must
degrade, not blank the page).

Risk: **high**. Touches the hot path of every create. Mitigations: keep the
cursor read-only to the fast path when hydration is off (one boolean check);
exhaustive tests against server output; the comment-anchor protocol already
exists so dynamic regions have defined boundaries to hydrate against.

### 3.3 Prerender driver (in `bundle/`)

Build-time orchestration, hooked into the `raptor-bundle build` CLI
([cli.ts](packages/engine/src/bundle/cli.ts)):

1. Bundle as today (now with the P0 resolve/CSS fixes).
2. Load the app's entry in a server context (the §3.1 document installed),
   obtain its route table.
3. `getStaticPaths` — the app exports, per dynamic route, a function returning
   the concrete paths to prerender (e.g. `/posts/:slug` → the 17k slugs). This is
   the one new app-facing API; static routes need nothing.
4. For each resolved path: set the location, `renderToString`, write
   `<outDir>/<path>/index.html` with the bundle `<script>`, the collected CSS
   `<link>` (P0 `#3`), and the serialized `<head>` (§3.4).
5. Emit a tiny runtime flag so the client entry calls `hydrate()` (not `render()`)
   when it boots on a prerendered page.

New CLI surface: `raptor-bundle build <entry> --prerender` (+ `--routes` module
or convention). Absent the flag, the build is exactly today's SPA.

Risk: **medium**. New code, but it composes §3.1 + P1's `matchRoutes`. The 17k-page
scale needs the per-page render to be cheap and the driver to stream writes (not
hold 17k strings in memory).

### 3.4 Head / meta (`@raptorstack/raptorjs/dom/head`)

A head registry collected during render:

- `Title(text)`, `Meta({...})`, `Link({...})` components register entries on a
  per-render **head context** instead of mutating `document.head` imperatively.
- On the **server**: `renderToString` returns the `HeadSnapshot`; the prerender
  driver serializes it into the page `<head>` → crawlers see it.
- On the **client**: the same components reconcile `document.head` reactively
  (dedupe by key, last-writer-wins), and on hydration adopt the server-emitted
  tags rather than duplicating them.

Risk: **low–medium**. Mostly additive. The only shared dependency is the
render-scoped context, which SSR provides and the client no-ops into direct head
mutation.

---

## 4. Phased plan

Each phase lands independently with tests; nothing breaks the SPA build.

| Phase | Deliverable | Depends on | Risk |
|-------|-------------|-----------|------|
| **3A** | Server renderer + `renderToString` (void elems, style flush, escaping, doctype) | — | med |
| **3B** | Head registry + `Title`/`Meta`/`Link`, server snapshot + client reconcile | 3A | low-med |
| **3C** | `hydrate()` — client-takeover (replace server markup; true DOM-reuse deferred) | 3A | low |
| **3D** | Prerender driver + `getStaticPaths` in `raptor-bundle build --prerender`, wiring 3A/3B/3C | 3A,3B,3C,P1 | med |

Suggested order 3A → 3B → 3C → 3D. 3A and 3B are shippable and useful on their
own (server rendering + correct head) before the risky hydration work; 3D is the
integration that produces the actual 17k-page output.

---

## 5. Open questions (need a decision before building)

- **O1 — mount effects on the server.** `onMount` and effects that touch
  `window`, timers, `IntersectionObserver`, etc. must not run (or must be guarded)
  during SSR. Options: (a) a global `isServer` flag the runtime exposes and guards
  `onMount` with; (b) require apps to guard themselves. Recommend (a).
- **O2 — templates vs hydration.** `template()`/`cloneNode` ([runtime.ts:99](packages/raptorjs/src/dom/runtime.ts:99))
  is a client fast path; during hydration we adopt instead of clone. Need to
  confirm the compiler/JSX output path doesn't force `template()` in a way that
  fights adoption. Likely fine (hydration bypasses the clone), but must verify.
- **O3 — routing source of truth for `getStaticPaths`.** Does the route table
  live in the app entry (imported by the driver) or a convention file? Affects how
  the driver loads routes in a server context.
- **O4 — asset `url()` in prerendered pages.** P0 ships CSS concatenation without
  `url()`/`@import` rewriting; a multi-page output under nested paths may need
  base-relative asset URLs. May require revisiting the P0 CSS limitation.

---

## 6. Estimate

Multi-week. 3A/3B ≈ days each; 3C (hydration) is the bulk and the risk; 3D is
integration + scale hardening. Recommend building behind `--prerender` so `main`
stays shippable throughout.
