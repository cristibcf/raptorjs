# @raptorstack/raptorjs

Fine-grained reactivity, a DOM runtime and a UI component library — the RaptorJS
application framework. A state change propagates directly to the affected DOM
binding: **no Virtual DOM, no component re-render**. Zero runtime dependencies.

Part of [**RaptorStack**](https://github.com/cristibcf/raptorjs).

## Install

```bash
npm install @raptorstack/raptorjs
```

## Usage

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

With JSX (via a bundler that sets `jsxImportSource` to `@raptorstack/raptorjs/dom`):

```tsx
function Counter() {
  const count = state(0);
  return <button on:click={() => count.update((n) => n + 1)}>{count}</button>;
}
```

## Subpaths

- `@raptorstack/raptorjs` — reactivity core: `state`, `derived`, `effect`, `batch`, `untracked`, ownership.
- `@raptorstack/raptorjs/dom` — DOM runtime + `jsx-runtime`, `For`, `Show`, the `R` hyperscript builder, and the router (`Router`, `Outlet`, `Link`, `lazy`, `navigate`, `searchParams`, `hash`, `matchRoutes`, `resolveRoute`).
- `@raptorstack/raptorjs/dom/testing` — a headless mini-DOM for tests (`installMiniDom()`).
- `@raptorstack/raptorjs/ui` — component library (`@raptorstack/raptorjs/ui/table`, `/button`, `/chart`, …).
- `@raptorstack/raptorjs/i18n` — messages: a `locale()` signal, catalogues (eager or lazy), `{name}` interpolation, `Intl.PluralRules` plural selection, `withLocale` for SSR and emails.

## Routing

A flat, synchronous route table is all you need to start, and keeps working as
the app grows into guards, code splitting and nesting:

```ts
import { Router, Outlet, Link, lazy, navigate, searchParams } from "@raptorstack/raptorjs/dom";

const routes = [
  { path: "/login", component: () => LoginScreen() },
  {
    path: "/app",
    // `true` renders, a string redirects (replacing the entry), `false` denies
    // - the match is dropped, so the Router's `fallback` renders instead.
    beforeEnter: () => (session() ? true : "/login"),
    component: () => AppShell({ children: Outlet() }),
    children: [
      { path: "", component: () => Inbox() },
      { path: "settings", component: lazy(() => import("./Settings.ts")) },
      { path: "users/:id", component: ({ id }) => UserScreen(id) },
    ],
  },
];

Router({ routes, fallback: NotFound(), pending: Spinner(), scrollRestoration: true });
```

- **Guards** — `beforeEnter?: (params) => boolean | string`, run outermost
  first, so a guard on the shell protects every screen under it. Redirects are
  followed (capped, and a loop warns) and land in the URL, so Back never
  returns to a path that was never rendered. `matchRoutes` stays pure and runs
  no guards, so a prerender is not redirected by one.
- **Lazy components** — `component` may return a promise, and `lazy()` wraps a
  dynamic import. The `Router`'s `pending` child shows while it loads; once the
  module is cached the screen renders synchronously, which is what SSR and a
  prerender need.
- **Nested routes** — `children` with relative paths (`""` is the index child)
  and `Outlet()` where they render. Each level is its own dynamic region keyed
  on *its own* route and params: moving between two screens under a shell, or
  changing a child's `:id`, leaves the shell's region untouched.
- **Query parameters** — `searchParams(): URLSearchParams` and `hash()` are
  reactive reads. A query-only change does not remount the route; the bindings
  that read the query update.
- **Scroll restoration** — `scrollRestoration: true` scrolls to the top on a
  new navigation and restores the saved offset on back/forward. Off by default,
  because it takes over `history.scrollRestoration` for the whole document.

## License

MIT
