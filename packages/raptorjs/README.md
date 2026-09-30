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
- `@raptorstack/raptorjs/dom` — DOM runtime + `jsx-runtime`, `For`, `Show`, the `R` hyperscript builder.
- `@raptorstack/raptorjs/dom/testing` — a headless mini-DOM for tests (`installMiniDom()`).
- `@raptorstack/raptorjs/ui` — component library (`@raptorstack/raptorjs/ui/table`, `/button`, `/chart`, …).

## License

MIT
