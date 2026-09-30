# RaptorJS / RaptorWire / RaptorTest / RaptorEngine — usage guide

Usage documentation, package by package, with **runnable** examples pulled from
the real demos (`examples/`). The README describes the *architecture*; this guide
shows *how to use each API*.

All the examples run directly on **Node ≥ 22** (native TypeScript via type-stripping).
The `@raptor/*` packages are **zero-dep**: they import nothing external.

> Mandatory code convention: **erasable TS syntax** — no runtime `enum`, no
> `namespace` with values, no parameter properties. Use `const X = { ... } as const`
> and `type`/`interface`. Otherwise the code doesn't run natively on Node.

## Contents

- [Quick start](#quick-start)
- [Package map](#package-map)
- [raptorjs — fine-grained reactivity](#raptorjs--fine-grained-reactivity)
- [raptorjs/dom — DOM runtime + control flow](#raptorjsdom--dom-runtime--control-flow)
- [raptorjs/ui — reusable components](#raptorjsui--reusable-components)
- [@raptor/engine/bundle — own TSX bundler (no Vite)](#raptorenginebundle--own-tsx-bundler-no-vite)
- [@raptor/wire/codec — codec primitives](#raptorwirecodec--codec-primitives)
- [@raptor/wire — opcodes, Document, protocol](#raptorwire--opcodes-document-protocol)
- [@raptor/wire/server — RaptorWire server SDK](#raptorwireserver--raptorwire-server-sdk)
- [@raptor/wire/client — session + reactive replica](#raptorwireclient--session--reactive-replica)
- [End-to-end: server ↔ RaptorWire ↔ client ↔ DOM](#end-to-end-server--raptorwire--client--dom)
- [@raptor/engine/compiler — `.raptor` parser, IR, semantic graph](#raptorenginecompiler--raptor-parser-ir-semantic-graph)
- [@raptor/engine — build, optimize, codegen, HMR, CLI](#raptorengine--build-optimize-codegen-hmr-cli)
- [@raptor/engine/run — server runtime + SSR + dev server](#raptorenginerun--server-runtime--ssr--dev-server)
- [@raptor/engine/profile — telemetry + PGO](#raptorengineprofile--telemetry--pgo)
- [@raptor/test — autonomous behavioral testing](#raptortest--autonomous-behavioral-testing)
- [The `.raptor` format](#the-raptor-format)
- [CLI reference](#cli-reference)

---

## Quick start

```bash
pnpm install          # links the workspace (+ optional devDeps)
pnpm test             # runs the whole test suite
pnpm typecheck        # tsc --noEmit over the whole monorepo

pnpm demo:counter     # fine-grained DOM bindings (headless)
pnpm demo:dashboard   # server ↔ RaptorWire ↔ client ↔ DOM
pnpm demo:chat        # shared state between 2 clients
pnpm demo:raptortest  # autonomously discovers bugs
pnpm demo:engine      # .raptor → IR → optimize → codegen → HMR
pnpm demo:run         # SSR + server signal ↔ RaptorWire ↔ reactive client
pnpm demo:profile     # telemetry → PGO plan → rebuild
```

## Package map

Dependency order (bottom → top). You can use each layer independently.

```
raptorjs ── reactivity (signals)
   └─ raptorjs/dom ── DOM bindings + JSX

@raptor/wire/codec ── varint / zig-zag / string
   └─ @raptor/wire ── opcodes, Document, protocol
        ├─ @raptor/wire/server ── authoritative store + query/mutation
        └─ @raptor/wire/client ── session + reactive replica

@raptor/engine/compiler ── .raptor → IR → semantic graph
   └─ @raptor/engine ── optimize + codegen + HMR + CLI `raptor`
        ├─ @raptor/engine/run ── server runtime + SSR + dev server
        └─ @raptor/engine/profile ── telemetry + PGO planner

@raptor/test ── autonomous behavioral testing (independent)
```

---

## raptorjs — fine-grained reactivity

The glitch-free reactive core. Signals are **callable accessors**: `count()` reads
and registers a dependency; `count.set(v)` / `count.update(fn)` write.

**Exports:** `state`, `derived`, `memo` (alias for `derived`), `effect`, `batch`,
`untracked`, `createRoot`, `onCleanup`, `getOwner`, `runWithOwner` + the types
`State`, `Derived`, `Accessor`, `Dispose`, `StateOptions`.

### Essential API

```ts
import { state, derived, effect, batch, untracked } from "raptorjs";

// --- mutable signal ---
const count = state(0);
count();                     // 0   (reads + registers a dependency)
count.set(5);                // writes
count.update((n) => n + 1);  // 6   (writes based on the previous value)
count.peek();                // 6   (reads WITHOUT registering a dependency)

// --- derived (lazy memo, read-only) ---
const doubled = derived(() => count() * 2);
doubled();                   // 12

// --- effect (eager: runs now + on every dependency change) ---
const dispose = effect(() => {
  console.log("count =", count());
});
count.set(10);               // the effect re-runs automatically
dispose();                   // stops the effect

// --- batch: groups writes, effects run ONLY ONCE at the end ---
batch(() => {
  count.set(1);
  count.set(2);
});                          // the effect runs once, with the final value

// --- untracked: reads without creating a dependency ---
const snapshot = untracked(() => count());
```

### Equality comparator

```ts
// `equal: false` forces a notification on every set, even if the value is equal.
const forced = state(0, { equal: false });
// custom comparator (e.g. for objects):
const point = state({ x: 0 }, { equal: (a, b) => a.x === b.x });
```

### Ownership and cleanup

```ts
import { createRoot, onCleanup } from "raptorjs";

createRoot((dispose) => {
  const s = state(0);
  effect(() => console.log(s()));
  onCleanup(() => console.log("cleanup!"));  // runs on dispose()
  // ...
  dispose();  // disposes the entire reactive tree created in this root
});
```

> **Mental model (whitepaper §6):** the graph is *glitch-free* — a `derived` is
> never seen in an inconsistent intermediate state. `derived`s are
> **lazy** (they recompute on read), `effect`s are **eager**.

---

## raptorjs/dom — DOM runtime + control flow

The compiler's output: fine-grained DOM bindings + control flow. It also re-exports
the primitives from `raptorjs` for ergonomics (no need to import them separately).

**Exports:** `render`, `onMount`, `createElement`, `template`, `applyProps`,
`mountChild`, `block`, `isBlock`, `disposeDetached`; control flow `For`, `Show`;
JSX runtime `jsx`, `jsxs`, `Fragment`; the hyperscript builder `R`; + everything from
`raptorjs`.

### Headless mini-DOM for tests

`raptorjs/dom/testing` provides a fake DOM that **counts every mutation** — useful to
prove that updates are fine-grained (0 nodes recreated).

```ts
import { installMiniDom, stats, resetStats } from "raptorjs/dom/testing";
import { render, mountChild, applyProps } from "raptorjs/dom";
import { state, derived } from "raptorjs";

const doc = installMiniDom();

function Counter() {
  const count = state(0);
  const parity = derived(() => (count() % 2 === 0 ? "even" : "odd"));

  const section = doc.createElement("section");
  const h2 = doc.createElement("h2");
  mountChild(h2, () => count(), null);           // fine-grained bound text-node
  section.appendChild(h2);

  const button = doc.createElement("button");
  applyProps(button, { "on:click": () => count.update((n) => n + 1) });
  mountChild(button, "+1", null);
  section.appendChild(button);
  return section;
}

const root = doc.createElement("div");
render(Counter, root);

resetStats();
root.querySelector("button").click();

// Fine-grained proof: only the text-node mutated, zero new elements.
stats.createElement;  // 0
stats.textUpdate;     // 1   (exactly the affected binding)
```

- `mountChild(parent, child, anchor)` — mounts a child. `child` can be static text
  (`"+1"`), an accessor (`() => count()` → reactive text-node), or a `Block`.
- `applyProps(el, props)` — applies attributes and handlers. `on:click` etc. are
  event bindings; reactive attributes take an accessor.

### Control flow: `For` (keyed) and `Show`

```ts
import { For, Show } from "raptorjs/dom";

// Keyed For: reuses nodes for unchanged items (minimal DOM mutations).
For({
  each: () => items(),                       // Accessor<readonly T[]>
  children: (item, index) => renderRow(item), // (item, index) => Child
});

// Show: mounts `children` when `when` is truthy, otherwise `fallback`.
Show({
  when: () => isVisible(),   // Accessor<unknown>
  children: renderPanel(),   // Child
  fallback: renderEmpty(),   // optional
});
```

### JSX (browser variant, `.tsx`)

You write components in JSX; [`@raptor/engine/bundle`](#raptorenginebundle--own-tsx-bundler-no-vite)
compiles them (own bundler, no Vite). Configure `tsconfig` with `jsxImportSource:
"raptorjs/dom"` only for typecheck in the editor. Then:

```tsx
function Counter() {
  const count = state(0);
  return (
    <button on:click={() => count.update((n) => n + 1)}>
      clicks: {count()}
    </button>
  );
}
render(Counter, document.getElementById("app"));
```

### `R` — hyperscript, the same bindings with no build step

`R` builds exactly what JSX builds — real DOM nodes, with fine-grained bindings —
but it's ordinary JavaScript code, so it doesn't need a compiler. Useful when the
code is evaluated at runtime (playground, REPL, snippets from the database) or in a
project without a build step.

```ts
import { R, state, render } from "raptorjs/dom";

function Counter() {
  const count = state(0);
  return R.div({ class: "row" },
    R.span({ style: () => (count() > 9 ? "color:red" : "") }, () => count()),
    R.button({ "on:click": () => count.update((n) => n + 1) }, "+1"),
  );
}
render(Counter, document.getElementById("app"));
```

The JSX equivalent of the same tree compiles into the same runtime calls; the
difference is only syntax, not behavior or performance.

- **`R.<tag>(props?, ...children)`** — the first argument is `props` only if it's a
  plain object. Anything else (string, number, node, accessor, array, `Block`) is a
  child, so `R.p("text")` and `R.p({ class: "x" }, "text")` both work.
- **`R(Component, props?, ...children)`** — the direct call mounts a component; the
  children end up in `props.children`.
- **Reactivity is expressed the same way as in JSX**: a *function* is a binding, a
  value is static. `R.div(count())` writes the value once and never changes;
  `R.div(() => count())` binds a text-node to the signal. The same for attributes:
  `{ style: () => ... }` re-evaluates, `{ style: "..." }` doesn't.
- `For` and `Show` are used identically — they return `Block`s, which are valid children:
  `R.ul(For({ each: () => items(), children: (x) => R.li(x.name) }))`.

The per-tag builder is memoized (`R.div === R.div`), so `R` allocates nothing extra
on each call.

---

## raptorjs/ui — reusable components

Ready-made components over the fine-grained runtime: `Table` and `DropdownMenu`.
Zero runtime dependencies, built with `R` (so no build step) and tested against the
mini-DOM that counts mutations.

**Import deep** (`raptorjs/ui/button`), not from the barrel — see the table below;
the difference is 13× on the bundle.

**Styles are separate and optional.** The components only set classes (`rui-*`)
and ARIA attributes; the CSS lives in `raptorjs/ui/styles` and you inject it yourself if you want:

```ts
import { installStyles } from "raptorjs/ui/styles";
installStyles();   // or: import RUI_CSS and put it in your own bundle
```

### Imports: barrel vs subpath

`raptorjs/ui` exposes **36 entry points**. Since RaptorBundle does
[tree-shaking](#tree-shaking), the barrel is no longer expensive:

```ts
import { Button } from "raptorjs/ui";          // 9 modules, 39 KB
import { Button } from "raptorjs/ui/button";   // 8 modules, 38 KB
```

Without tree-shaking (`--no-treeshake`, or another bundler that doesn't do it), the
same barrel gives **58 modules and 527 KB**.

**Rule of thumb:** import deep anyway. Tree-shaking works at the module level, not
the declaration level — `raptorjs/ui/chart` brings only scale + Line/Area/Bar,
whereas a symbol taken from the barrel can land in a file that contains ten more
related components. The difference is small, but real, and the deep import also
tells the reader where the component comes from.

#### Entry-point map

| Subpath | Contains |
|---|---|
| `raptorjs/ui` | everything (barrel) |
| `/styles` | `RUI_CSS`, `installStyles` |
| `/primitives` | the 21 headless primitives |
| `/button` | `Button`, `IconButton`, `ButtonGroup` |
| `/input` | `Input`, `Textarea`, `Checkbox`, `Switch`, `RadioGroup` |
| `/controls` | `NumberInput`, `PinInput`, `SearchInput`, `TagsInput`, `SegmentedControl`… |
| `/input-extra` | `MaskedInput`, `CurrencyInput`, `PhoneInput`, `Mentions`, `Rating`, `ColorPicker`, `TransferList`, `TreeSelect`, `Cascader` |
| `/select`, `/combobox` | `Select`, `Combobox` |
| `/form` | `Form`, `FormField`, `FormSection`, `ValidationSummary`, `field`, `validators` |
| `/layout`, `/layout-extra` | `Stack`, `Grid`, `Container`… / `Masonry`, `Affix`, `Dock`, `SplitButton`, `FAB` |
| `/typography` | `Text`, `Heading`, `Link`, `CodeBlock`, `Mark` |
| `/display` | `Card`, `Badge`, `Avatar`, `Alert`, `Skeleton`, `Timeline` |
| `/disclosure` | `Collapsible`, `Accordion` |
| `/table`, `/data-grid` | `Table` / virtualized `DataGrid` |
| `/data-views` | `TreeView`, `ListView`, `MultiSelect`, `Autocomplete`, `CommandPalette` |
| `/menu`, `/tabs` | `DropdownMenu` / `Tabs` |
| `/overlay`, `/overlay-extra` | `Dialog`, `Popover`, `Tooltip` / `Drawer`, `ContextMenu`, `Backdrop`, `ErrorBoundary` |
| `/toast` | `createToaster`, `Toaster` |
| `/navigation` | `Breadcrumbs`, `Pagination`, `Stepper`, `Navbar`, `AppShell` |
| `/date` | `Calendar`, `DatePicker`, `TimePicker`, `MonthPicker` + the date utilities |
| `/files` | `FileInput`, `Dropzone`, `FileList`, `validateFiles` |
| `/progress`, `/slider`, `/sparkline`, `/split-pane` | the small ⚡ components |
| `/chart`, `/chart-extra` | scale + Line/Area/Bar / the other 11 types |
| `/editors` | `RichTextEditor`, `CodeEditor`, `JsonViewer`, `DiffViewer` |
| `/media` | `Carousel`, `Lightbox`, players, `Waveform` |
| `/qrcode` | `QRCode` + the encoder |
| `/advanced` | `Kanban`, `Wizard`, `Menubar`, `HoverCard`, `Tour` |

> **Reorganization note:** `idle` and `networkStatus` moved into
> `raptorjs/ui/primitives` (that's where they belong, they're primitives with no
> rendering), `FormSection` and `ValidationSummary` into `/form`, and `DateTimePicker`,
> `MonthPicker` and `YearPicker` into `/date`. The barrel exports them just as
> before, so nothing breaks.

### Headless primitives (`raptorjs/ui/primitives`)

They render nothing and have no CSS. They attach via `ref` or return signals. They
all remove their global listeners themselves on dispose — no handler outlives the
component. They are the foundation for the rest of the library: `Dialog` needs
`Portal` + `focusTrap`, `Popover` needs `clickOutside`, `DataGrid` needs `virtualizer`.

| Primitive | Form | What it does |
|---|---|---|
| `Portal` | component | mounts the content in another node (default `document.body`) |
| `focusTrap()` | ref | keeps focus inside, cycles Tab, restores it on exit |
| `clickOutside(fn, opt?)` | ref | runs `fn` on an outside click; `ignore` and `enabled` |
| `VisuallyHidden(...)` | component | visually hidden, present for the screen reader |
| `Transition` | component | keeps the node mounted for the duration of the exit |
| `draggable(opt?)` | `{ ref, dragging, delta }` | drag with pointer events, axis and threshold |
| `droppable(payload, opt)` | `{ ref, over }` | drop zone with an `accepts` filter |
| `sortable({ items })` | `{ item, dragging, over, move }` | reordering that moves the nodes |
| `resizable(opt?)` | `{ handle, size, style, nudge, ... }` | resize by drag + keyboard |
| `virtualizer(opt)` | `{ ref, indices, itemStyle, ... }` | a window over tens of thousands of rows |
| `infiniteScroll(opt)` | `{ ref, loading, load }` | load at the end, without overlaps |
| `intersects(opt?)` | `{ ref, visible, trigger }` | visibility as a signal |
| `clipboard(ms?)` | `{ copy, copied, error, reset }` | copy with a temporary state |
| `hotkeys(map, opt?)` | effect | shortcuts; `mod` = Cmd/Ctrl, skipped in inputs |
| `mediaQuery(q, fallback?)` | accessor | media query as a signal |

```ts
import { resizable, clickOutside, hotkeys } from "raptorjs/ui";

function SplitPane() {
  const left = resizable({ axis: "x", initial: 240, min: 160, max: 520 });
  hotkeys({ "mod+b": () => left.setSize(left.size() > 0 ? 0 : 240) });

  return R.div({ style: "display:flex" },
    R.aside({ style: () => left.style() }, "sidebar"),
    R.div({ class: "rui-resize-handle", ref: left.handle }),
    R.main("content"));
}
```

**Why `resizable` is the thesis component.** A drag produces `pointermove` at
60–120Hz. The test in `packages/ui/tests/primitives.test.ts` fires 60 events and
checks: `stats.createElement === 0`, `stats.createText === 0`,
`stats.setAttribute === 60` — exactly one attribute write per frame, no node
touched. In a framework with a VDOM every event would trigger a re-render and a
reconciliation.

**`virtualizer` returns indices, not objects.** `For` is keyed on value identity; a
new `{index, start, size}` object on each recompute would be a new key, so the
window would rebuild on every scroll pixel — exactly the opposite of the goal.
Numbers are primitives, so index 5 is always the same key:

```ts
const v = virtualizer({ count: () => rows().length, itemSize: 32 });

R.div({ ref: v.ref, style: "overflow:auto;height:400px" },
  R.div({ style: () => v.spacerStyle() },
    For({ each: () => v.indices(),
          children: (i) => R.div({ style: v.itemStyle(i) }, rows()[i].name) })));
```

The test checks: with 10,000 rows only 7 are rendered, and a scroll of exactly one
row creates **at most one new element**, not 7.

> The primitives that depend on browser APIs (`matchMedia`,
> `IntersectionObserver`, `navigator.clipboard`, `focus()`) work even
> where those are missing — they fall back and expose a manual `trigger()` /
> `load()`, so the logic stays testable without real layout.

### Wave 2 — the ⚡ components

Components where fine-grained isn't a style preference but a measurable ratio. Each
has a test that counts DOM mutations.

| Component | The thesis, verified in the test |
|---|---|
| `Progress` | 100 steps → 0 nodes, exactly 200 attribute writes (width + `aria-valuenow`) |
| `Slider` / `RangeSlider` | a 60-frame drag → 0 nodes created |
| `SplitPane` | a 60-frame drag → 0 nodes created |
| `Sparkline` | 200 live-data ticks → 0 nodes, exactly 200 rewrites of `d` |
| `Combobox` | filtering as you type → the remaining options keep their nodes |
| `DataGrid` | 50,000 rows, 14 in the DOM; scrolling by one row → at most one new row |

```ts
import { Progress, Slider, Sparkline, SplitPane, Combobox, DataGrid } from "raptorjs/ui";

const volume = state(40);
Slider({ value: volume, min: 0, max: 100, step: 5, label: "Volume" });

Progress({ value: () => uploaded(), max: 100, caption: true });

Sparkline({ data: () => history(), width: 120, height: 32, area: true, lastPoint: true });
```

**`Slider`** keeps the value in a signal you own. Full keyboard (arrows by `step`,
`PageUp`/`PageDown` by 10%, `Home`/`End`), ARIA `role="slider"` with
`aria-valuenow`/`aria-valuetext`. `RangeSlider` has two handles that don't cross
over. The track geometry comes from `getBoundingClientRect`, but `setTrack(start, size)`
can push it in from outside — which is why quantization and clamping are testable
without real layout.

**`DataGrid`** doesn't use `<table>`: a real table can't be virtualized correctly,
because absolutely-positioned rows break the table layout. It uses a grid with ARIA
table roles (`role="grid"`, `columnheader`, `gridcell`, `aria-rowcount`), like all
serious virtualized grids. Columns resize via `resizable` — dragging rewrites a
single `grid-template-columns`.

**`Combobox`** follows the ARIA combobox pattern: focus stays in the input (so you
can keep typing), and the highlighted option is signaled via
`aria-activedescendant`. The list's positioning goes through `positioner`.

### `positioner` — positioning without clipping at the edge

```ts
const pos = positioner({ placement: "bottom-start", flip: true, shift: true });
R.button({ ref: pos.reference }, "open");
R.div({ ref: pos.floating, style: () => pos.style() }, "content");
```

`flip` moves the placement to the opposite side when it doesn't fit, `shift` slides
it along the secondary axis just enough to stay on screen. The result is a signal,
so repositioning rewrites a single style attribute. `update({ reference, floating, viewport })`
accepts explicitly-given rectangles, so the flip/shift logic is tested without
real layout.

> **SVG.** `Sparkline` and `CircularProgress` required namespace support in
> `raptorjs/dom`: `document.createElement("svg")` produces an unknown HTML element
> in the browser, which renders nothing. `createElement` now uses
> `createElementNS` for SVG-only tags. Ambiguous tags (`a`, `script`,
> `style`, `title`) are not treated as SVG — for those you give the namespace explicitly
> as the second argument.

### Wave 3 — the form core and overlays

The components every application has. Not all are performance theses; their value
is in the accessibility and behavior details that every project rewrites badly.

```ts
import {
  Button, Input, Checkbox, Switch, RadioGroup, Select,
  Form, FormField, field, formGroup, validators,
  Dialog, ConfirmDialog, Popover, Tooltip,
  createToaster, Toaster, Tabs,
} from "raptorjs/ui";
```

#### Forms — derived validation

```ts
const email = field("", { validate: [validators.required(), validators.email()], label: "Email" });
const pass  = field("", { validate: validators.minLength(8), label: "Password" });
const group = formGroup([email, pass]);

Form({
  group,
  onSubmit: () => api.signup(email.value(), pass.value()),
  children: [
    FormField({ field: email, label: "Email", required: true,
                children: Input({ value: email.value, id: email.id }) }),
    FormField({ field: pass, label: "Password",
                children: Input({ value: pass.value, id: pass.id, type: "password" }) }),
    Button({ type: "submit", children: "Create account" }),
  ],
});
```

Each rule is a `derived` over the field's signal. There's no "validation cycle" to
trigger, and a keystroke recomputes only the errors that depend on that field.
**The thesis, verified in the test:** a form with 30 fields, one keystroke in a
single one → `createElement === 0` and exactly **one** text-node touched.

- The error appears after the first blur from the field (`validateOnBlur`, default
  `true`) — otherwise the form is red before you've typed anything.
- Submitting an invalid group marks all fields as touched and doesn't run.
- `ErrorMessage` stays permanently mounted with `aria-live="polite"`. If it appeared
  together with the text, many screen readers would announce nothing.

#### Overlays

`Dialog`, `Popover` and `Tooltip` are mounted through `Portal`, so a parent's
`overflow` or `z-index` doesn't clip them. When they're closed **there are no nodes**
for them.

- `Dialog`: `focusTrap`, `aria-modal`, Escape, click on the backdrop. **The scroll
  lock is counted**, not a flag: with two stacked dialogs, closing the top one
  doesn't restore scrolling while the one underneath is open.
- `Tooltip` appears on **focus**, not just on hover — otherwise it's invisible to
  anyone navigating by keyboard. Escape hides it even if the pointer is over it
  (a WCAG requirement). Linked via `aria-describedby`, not `aria-label`: a tooltip
  describes, it doesn't replace the element's name.
- `Popover` and `Select` use `positioner`, so they don't get clipped at the screen
  edge. `DropdownMenu` was moved onto `positioner` too.

#### Toasts

```ts
const toaster = createToaster({ duration: 4000, max: 5 });
Toaster({ toaster, position: "bottom-right" });

toaster.success("Saved");
toaster.push({ message: "Deleted", key: "delete", action: { label: "Undo", onClick: undo } });
```

The store is yours, the component just renders it — you can announce something from
a network handler, without a component context. The timers pause on hover:
otherwise a half-read message disappears exactly when you reach for the action
button. `key` deduplicates instead of stacking the same message.
`aria-live="polite"`, not `assertive` — a toast shouldn't interrupt the reader
mid-sentence; critical errors go in a `Dialog`.

#### Controls

- `Checkbox` covers `indeterminate`, which **is not an HTML attribute but a DOM
  property** — set as an attribute it would have no effect, and the accessibility
  tree would lie. The component sets the property and `aria-checked="mixed"`.
- `Switch` has `role="switch"`, not a styled checkbox: a switch communicates
  "turn on now", not "check for later".
- `RadioGroup` and `Tabs` use a **roving tabindex**: only one element of the group
  is in the Tab order, the arrows move within it. A set of 8 tabs shouldn't cost 8
  Tab presses to get past.
- `Select` has typeahead (you type "pe" and jump to "Peach"), without which a list
  of 200 countries is unusable by keyboard.
- `Button` defaults to `type="button"`, not `submit`. An `onClick` that returns a
  promise puts the button into `loading` by itself and blocks clicks — the classic
  double-submit bug.

#### Tabs

`activation: "manual"` (default) moves focus with the arrows without switching the
panel; Enter/Space confirms. It matters when the panels load data. Inactive panels
stay in the DOM with `hidden`, so Ctrl+F finds them and you don't lose their state.
`lazy: true` builds a panel on first activation and keeps it mounted.

### Wave 4 — layout, typography, display, controls

The largest batch by count and the smallest by difficulty. Few are performance
theses; their value is in the details that every project rewrites badly.

#### Layout

`Box`, `Flex`, `Stack`, `Group`, `Grid`, `SimpleGrid`, `Container`, `Center`,
`Spacer`, `Divider`, `AspectRatio`, `ScrollArea`.

```ts
Stack({ gap: 4, children: [
  Group({ gap: 2, justify: "between", children: [Heading({ level: 2, children: "Projects" }), Button({ children: "New" })] }),
  SimpleGrid({ minColumnWidth: "240px", children: projects().map(card) }),
]})
```

Spacing is a **step scale** (`0..8` → 0, 2, 4, 8, 12, 16, 24, 32, 48px), not free
pixels. A small scale kept with discipline looks better than ad-hoc values, and
`gap: 4` is easier to read than `gap: 12px`.

`SimpleGrid` solves responsiveness without media queries — `auto-fill` + `minmax`
in a single declaration. `ScrollArea` gets `tabindex="0"`, because a scrollable
area must be navigable by keyboard (WCAG 2.1.1).

> Extra props go through `attrs`, not through an index signature.
> The reason is typing: with `[key: string]: unknown`, `Omit<FlexProps, "direction">`
> would erase **all** declared members (`keyof T` becomes `string`), and
> `StackProps` would lose `gap`, `align` and the rest.

#### Typography

`Text`, `Heading`, `Link`, `Code`, `CodeBlock`, `Kbd`, `TextList`, `Truncate`,
`Blockquote`, `Mark`.

**`Heading` separates the semantic level from the visual size.** `level` picks the
tag (`h1`..`h6`), `size` picks how it looks. Without that separation people jump
from `h2` to `h4` just to get smaller text, and the document structure becomes
unreadable for a screen reader.

An external `Link` gets `rel="noopener noreferrer"` automatically, and `onNavigate`
leaves Ctrl/Cmd+click and middle-click to the browser. `Mark` highlights
case-insensitive matches **keeping the original text** — highlighting must not
change what the user reads.

#### Display

`Card`, `Badge`, `Tag`, `Avatar`, `AvatarGroup`, `Stat`, `DescriptionList`,
`Alert`, `Callout`, `Banner`, `EmptyState`, `Result`, `Spinner`, `Skeleton`,
`LoadingOverlay`, `Timeline`, `Image`.

What it solves, concretely:

- `Card` with `onClick` gets `role="button"` **and** an Enter/Space handler — a
  `div` with a button role doesn't respond to the keyboard on its own.
- A `Badge` with a number requires `label`: "3" alone says nothing to a screen
  reader. A dot-badge without a label is marked `aria-hidden`, being purely decorative.
- `Avatar` puts the name **once**, on the container; the image and the initials
  underneath are decorative, otherwise they'd be read twice.
- `Stat` has `invertDelta`: for most metrics an increase is good, for churn it isn't.
- `Alert` uses `role="alert"` only for errors; the rest are `status`, so as not to
  interrupt the reader.
- `Skeleton` is `aria-hidden` — a placeholder has nothing to announce. The loading
  state is communicated from the container with `aria-busy`, which is what
  `LoadingOverlay` does.
- The `Skeleton` and `Spinner` animations stop at `prefers-reduced-motion`.

#### Disclosure

`Collapsible` and `Accordion` don't use `<details>`: that can't be animated and
doesn't allow the "single panel open" mode. The content stays in the DOM with
`hidden` (so Ctrl+F finds it and you don't lose its state); `unmount: true`
unmounts it when you really want that.

The title of an `Accordion` section is a **heading with a button inside**, not a
button styled as a title: that way it appears in the screen reader's list of titles
and stays actionable.

#### Controls, round two

`NumberInput`, `PasswordInput`, `SearchInput`, `PinInput`, `TagsInput`,
`Editable`, `NativeSelect`, `CheckboxGroup`, `SegmentedControl`, `ToggleButton`,
`ToggleGroup`, `CloseButton`, `CopyButton`, `InputGroup`, `Fieldset`,
`HelperText`.

- **`NumberInput` doesn't produce `0.30000000000000004`.** It rounds to the step's
  precision. And it doesn't clamp while typing — you'd block typing `-` or `0.` —
  but on `blur`.
- **`PinInput` accepts a whole pasted code.** The user copies `123456` from an SMS
  and pastes it into the first box; without handling `paste` they'd get a `1`.
- **`SearchInput` debounces** (250ms default), Enter searches immediately,
  Escape clears.
- `PasswordInput`: the button's label describes the **action** ("Show password"),
  not the state — otherwise the user doesn't know what happens if they press it.
- `TagsInput`: comma/Enter confirms, Backspace on an empty input deletes the last
  tag, and whatever is being typed is confirmed on `blur` instead of being lost.
- `CheckboxGroup` with `selectAll` exposes `aria-checked="mixed"` for the partial state.

#### State primitives

```ts
const theme = persistedState("theme", "light");     // saves itself
const doc = undoRedo(initialDoc, { limit: 100 });   // bounded history
const sel = selectionState({ items: () => rows() }); // click/Ctrl/Shift
```

They're here because every application rewrites them, each time with the same three
bugs:

- **`persistedState`** doesn't throw in private mode or with cookies blocked —
  accessing `localStorage` can itself throw, not just reading. A corrupt value
  falls back to `initial` instead of crashing the app. It syncs across tabs via the
  `storage` event.
- **`undoRedo`** has a mandatory limit, not an optional one: an editor left open for
  a day with unlimited history keeps every intermediate state in memory. `replace()`
  modifies without a new entry, for the middle of a drag.
- **`selectionState`** handles the case where the anchor disappeared after a filter:
  Shift+click falls back to a plain click instead of selecting a nonsensical range.

### Wave 5 — dates, navigation, files, trees, charts

The last 30 T1/T2 components. With this, T1 and T2 are complete.

#### Date and time

`Calendar`, `DatePicker`, `DateRangePicker`, `TimePicker` — plus the utilities
`addDays`, `addMonths`, `parseIso`, `monthGrid`, `daysInMonth`, exported and
testable separately.

**Zero dependencies: no date-fns, no luxon.** Formatting and day names come
from `Intl`, which is in the runtime, not in `node_modules`.

```ts
const date = state<CalendarDate | null>(null);
DatePicker({ value: date, min: today(), locale: "ro-RO" });
```

The trap avoided everywhere: **`new Date("2026-03-15")` is parsed as UTC** and,
in a timezone west of Greenwich, gives March 14. We work with `{y, m, d}` triples
and build `Date` only via `new Date(y, m, d)`, which is local. Day arithmetic never
uses `+ 86400000` — a day isn't always 24h. The tests cover month rollovers, leap
years and `January 31 + 1 month = February 28/29`.

`DatePicker` also accepts direct typing. Invalid text **restores** the previous
value instead of silently clearing it. `TimePicker` uses separate segments, not
`<input type="time">` (which looks different in every browser and can't be styled);
each segment is a `spinbutton` that wraps around at the ends.

#### Navigation

`Breadcrumbs`, `Pagination`, `Stepper`, `Anchor`, `Navbar`, `NavigationMenu`,
`SidebarNav`, `Sidebar`, `AppShell`.

The common rule: **navigation is a list of links**, not `div`s with `onClick`. A
`nav` with `ul`/`li` and `aria-current` tells a screen reader how many items there
are and where you are.

- `paginationRange(page, total, siblings)` is exported separately — it's the part
  people get wrong and it's easy to test. It puts an ellipsis only when **at least
  two** pages are skipped; otherwise it shows the number.
- `Breadcrumbs`: the last item isn't a link, it's where you already are.
- `Stepper`: you can't jump ahead, because the next steps may depend on what you
  fill in now.
- `Anchor` (scroll-spy) doesn't use `IntersectionObserver` with a `threshold`, which
  gives wrong results for sections taller than the screen: it compares positions
  against a line `offset` px from the top.
- `NavigationMenu` opens the submenu on hover **and** on focus; closing has a
  small delay, otherwise the mouse path from the button to the submenu would close it.
- `AppShell` exposes a `<main id="rui-main">` for the "skip to content" link.

#### Trees and lists

`TreeView`, `ListView`, `MultiSelect`, `Autocomplete`, `CommandPalette`.

`TreeView` follows the ARIA tree pattern: the right arrow expands or descends to
the first child, the left collapses or goes up to the parent, `*` expands all
siblings. Only one node is tabbable — Tab exits the whole tree, it doesn't step
through all 400 nodes. It supports lazy loading and doesn't reload what it already brought.

**`Autocomplete` solves the race between requests.** If you type "ab" then "abc",
the response for "ab" may arrive *after* the one for "abc" and overwrite it.
Each request gets a sequence number and only the most recent one is allowed to
write the results — there's a test that delivers the responses in reverse order.

`MultiSelect` keeps the chips **outside** the input: a chip placed inside an input
is inaccessible (it can't be a button) and breaks on horizontal scroll.

`CommandPalette` doesn't register `mod+k` by itself — you bind it yourself with
`hotkeys`, so it doesn't steal your shortcut without you knowing. Filtering resets
the selection, otherwise you could run the wrong command.

#### Files

`FileInput`, `Dropzone`, `FileList` — with `validateFiles`, `matchesAccept` and
`formatSize` exported separately.

Validation is **the same function** for the file-picker dialog and for drag & drop.
Otherwise you end up with two sets of rules that diverge. The count limit is applied
*after* the type and size filters, so a rejected file doesn't consume a slot.

`Dropzone` counts `dragenter`/`dragleave`: the events fire even when the cursor
passes over a **child** of the zone, so a plain boolean makes the zone flicker.

#### Remaining overlays

`Drawer`, `ContextMenu`, `Notification`, `Backdrop`, `ErrorBoundary`.

`Drawer` with `modeless: true` is an ordinary panel (filters, details): no focus
trap, no scroll lock, no `aria-modal`. A filter drawer that blocks the rest of the
page is a common mistake.

`ContextMenu` also opens with the Menu key or Shift+F10, not just with the mouse.

**`ErrorBoundary` promises only what it can keep.** It catches exceptions thrown
synchronously when `children()` builds its nodes, and the rebuild after
`retry()`. It does **NOT** catch errors from event handlers, from rejected promises,
or ones that appear later in an `effect` from an already-mounted binding —
in a fine-grained runtime there is no render phase that can be replayed.

#### Charts

`scaleLinear`, `scaleBand`, `niceTicks`, `extent`, `Axis`, `Legend`, plus
`LineChart`, `AreaChart`, `BarChart`.

```ts
LineChart({
  series: () => [{ label: "Visits", values: history() }],
  labels: months,
  area: true,
  summary: "Monthly visits over the last year",
});
```

**The thesis, verified in the test:** live data in a `LineChart` rewrites only the
`d` attribute — zero nodes created. This required the plot to be a `For` keyed on
**indices** (primitives, so stable keys), not a region that remaps series on every
tick. The same lesson as with `virtualizer`.

The chart is `role="img"` with an `aria-label` from `summary`; the axis ticks are
`aria-hidden`, because a screen reader reading 40 numbers off the axis helps no one.

> **Their limits:** they're basic charts, not a visualization library. They cover
> time series and comparison across categories. For sankey, treemap, maps or
> complex interactions (brush, zoom, pan) you need a dedicated library, and
> that's fine.

### Wave 6 — T3: the specialized ones

The last batch. **59 of the 61 T3 components**; two were deliberately left undone
and the reason is below.

#### What was delivered

**Layout and actions:** `Masonry`, `Affix`, `SafeArea`, `SkipNav`,
`BottomNavigation`, `Dock`, `SplitButton`, `FloatingActionButton`.

**Specialized inputs:** `MaskedInput`, `CurrencyInput`, `PhoneInput`,
`DateInput`, `Mentions`, `Rating`, `ColorPicker`, `ColorSwatchPicker`,
`TransferList`, `TreeSelect`, `Cascader`.

**Charts:** `PieChart`, `DonutChart`, `ScatterChart`, `BubbleChart`, `Heatmap`,
`Gauge`, `RadarChart`, `FunnelChart`, `CandlestickChart`, `Treemap`,
`SankeyDiagram`, `Meter`.

**Editors and viewers:** `RichTextEditor`, `CodeEditor`, `JsonViewer`,
`DiffViewer`, `ComparisonTable`.

**Media:** `Carousel`, `Gallery`, `Lightbox`, `ImageZoom`, `VideoPlayer`,
`AudioPlayer`, `Waveform`, `QRCode`, `ImageUpload`, `UploadProgress`,
`FilePreview`.

**The rest:** `Kanban`, `Wizard`, `Menubar`, `HoverCard`, `Tour`, `FormSection`,
`ValidationSummary`, `DateTimePicker`, `MonthPicker`, `YearPicker`, plus the
primitives `idle()` and `networkStatus()`.

#### The algorithms, exported separately and tested without the DOM

The part that can actually be gotten wrong isn't hidden inside components:

| Function | What it does |
|---|---|
| `applyMask`, `unmask` | input mask, with cursor position |
| `diffLines`, `diffStats` | line diff, via the longest common subsequence |
| `squarify` | "squarified" treemap layout (Bruls–Huizing–van Wijk) |
| `sankeyLayout` | depths, flows and curves for the Sankey diagram |
| `arcPath` | circle sectors for pie/donut |
| `reedSolomon`, `encodeData`, `buildMatrix` | the complete QR encoding |
| `contrastRatio`, `readableOn` | WCAG contrast and text color choice |
| `computePeaks`, `formatDuration` | audio sample reduction, time formatting |
| `activeMention`, `groupDigits`, `formatCurrency` | the `@` token, groupings, money |

#### `QRCode` — a complete generator, not a wrapper

It implements ISO/IEC 18004 for byte mode, versions 1–10, all four correction
levels: arithmetic in GF(256), Reed-Solomon codes, block interleaving, the eight
masks with their penalty score and the BCH format bits.

```ts
QRCode({ value: () => url(), level: "H", label: "Link to the page" });
```

The code renders as **a single `path`** — a `<rect>` per module would mean
~1000 elements for version 5. The test even verifies that the written format
can be read back correctly (so the BCH is good) and that the chosen mask is the one written.

These parts can't be approximated: a QR with wrong Reed-Solomon doesn't scan at all,
and one with a poorly-chosen mask scans poorly.

#### Decisions worth knowing

- **`Kanban` can be used from the keyboard.** Each card has a "Move to…" menu.
  Drag & drop alone would make the board unusable without a mouse — it's the classic
  accessibility failure of this component.
- **`Carousel` stops autoplay on hover and on focus.** A carousel that moves while
  you're reading violates WCAG 2.2.2, it's not just annoying. Hidden slides get
  `inert`, so they aren't tabbable.
- **`ScatterChart` scales bubble radius by the square root of the value.** The area
  must be proportional, not the radius — otherwise a doubled value looks four times
  bigger. There's a test.
- **`CurrencyInput` keeps money in integers** (bani, cents). `0.1 + 0.2 !== 0.3`,
  and a rounding error in a shopping cart is a real bug.
- **`Meter` has `role="meter"`, not `progressbar`.** One measures how full something
  is, the other the progress of a task; screen readers announce them differently.
- **`HoverCard` is a `dialog`, not a `tooltip`**, because it has interactive content —
  hence the delay on closing, so you can reach it with the mouse.
- **`applyMask` doesn't add the trailing separator** until you type the character
  after it: otherwise the cursor ends up past a dash you didn't type.

#### The declared limits

**`RichTextEditor`** uses `contenteditable` + `document.execCommand`.
`execCommand` is deprecated and produces slightly different HTML in each browser.
The real alternative — a custom document model with selection management, like
ProseMirror — is a months-long project, not a component. It covers the "description
field with bold and links" case. It doesn't sanitize the HTML.

**`Waveform` doesn't decode audio.** Decoding requires `AudioContext` and the whole
file in memory, which has no business in a UI component. Compute the peaks on the
server or in a worker and pass them as `peaks`.

**`diffLines` is O(n·m).** Enough for files on the order of thousands of lines,
which is the case the component exists for. For huge files you need banded Myers,
so a dedicated library.

**The charts cover the common cases.** No brush, zoom, pan or logarithmic axes.

### `Table` — sortable table

```ts
import { Table, type Column } from "raptorjs/ui";
import { state, R, render } from "raptorjs/dom";

interface Row { id: number; name: string; qty: number }
const rows = state<readonly Row[]>([
  { id: 1, name: "Keyboard", qty: 3 },
  { id: 2, name: "Mouse", qty: 10 },
]);

const columns: Column<Row>[] = [
  { key: "name", header: "Name", cell: (r) => r.name,
    sort: (a, b) => a.name.localeCompare(b.name) },
  { key: "qty", header: "Qty", align: "right", cell: (r) => String(r.qty),
    sort: (a, b) => a.qty - b.qty },
];

render(() => Table({ rows: () => rows(), columns, empty: "Nothing here" }), app);
```

- **Sorting moves the rows, it doesn't rebuild them.** `For` is keyed on the row
  object's identity, and sorting returns a new array with the same references —
  so the existing nodes are just reordered via `insertBefore`. The test in
  `packages/ui/tests/table.test.ts` checks exactly this: after a click on the header,
  `stats.createElement === 0` and `stats.createText === 0`.
- **A column without `sort` isn't sortable** — there's no default string comparator,
  so you don't wrongly order numbers or dates.
- **Reactive cells:** `cell` can return an accessor
  (`cell: (r) => () => total(r)`) and then only its text-node updates.
- **Optional selection:** give it `selected`, a signal you own
  (`state<ReadonlySet<Row>>(new Set())`). Without it, the table has no selection.
  `multiple: false` keeps a single row.

> Note: because `For` is keyed on value, the rows must be stable objects. If you
> regenerate the objects on each read (`rows().map(...)`), node reuse is lost.

### `DropdownMenu` — menu with keyboard

```ts
import { DropdownMenu, menuItem, menuSeparator } from "raptorjs/ui";

DropdownMenu({
  trigger: "Actions",
  entries: [
    menuItem("Copy", () => copy(), { hint: "Ctrl+C" }),
    menuItem("Paste", () => paste(), { disabled: true }),
    menuSeparator(),
    menuItem("Delete", () => remove()),
  ],
});
```

- **When it's closed there are no nodes for it** — the menu is mounted via `Show`.
- **Keyboard:** `ArrowDown`/`ArrowUp` cycle and skip over separators and
  disabled items, `Home`/`End`, `Enter`/`Space` select, `Escape` closes
  and returns focus to the trigger.
- **An outside click** closes the menu. The global handlers are attached to
  `document` **only while the menu is open** and removed in `onCleanup`, so they don't
  stay hanging after `dispose`.
- **ARIA:** `aria-haspopup`, `aria-expanded` (reactive), `role="menu"`,
  `role="menuitem"`, `aria-disabled`.
- **Controlled from outside:** give it `open`, a `State<boolean>` of yours, if you want to
  open the menu programmatically.
- Moving the active item rewrites two attributes; the items aren't recreated.

---

## @raptor/engine/bundle — own TSX bundler (no Vite)

The project's own bundler for the browser variant: it transforms JSX to the
fine-grained `raptorjs/dom` runtime, resolves the graph (including the `exports` map
to the `.ts` source of the `@raptor/*` packages) and emits a single `bundle.js`.
**Zero runtime dependencies**; it uses the TypeScript compiler only as a build-time
transform primitive. No Vite / esbuild / Rolldown.

**Exports:** `bundleApp` (+ `BundleOptions`, `BundleResult`), `startDevServer`
(+ `DevServerOptions`), `transpile` (+ `TranspileOptions`, `DEFAULT_JSX_IMPORT_SOURCE`),
`resolveSpecifier`, `rewriteHtml`, `runBundleCli`.

### The catalog smoke test

`examples/site/tests/catalog.test.ts` builds the demo of **every**
component documented on the site and actually verifies that it renders. It runs on
`pnpm test`, ~3.5 seconds.

What it catches:

- a component that throws (it reports the group and the exact name);
- a `NaN` reaching the output — arithmetic on missing values, the classic trap of
  chart scales;
- an object stringified as `[object Object]`;
- empty output.

It's also an end-to-end test of the bundler: the catalog pages are `.tsx`, so they
go through RaptorBundle (JSX transform, subpath resolution, tree-shaking)
before being evaluated on the mini-dom. If something breaks along that chain, it
shows here.

**How it's kept honest.** The checks are deliberately few. I first tried to
flag `null`/`undefined` rendered as text too, and got four false positives:
the `Select`, `Combobox`, `TreeSelect` and `Cascader` demos deliberately show
`value = null` to illustrate the initial state. A test that screams at correct content
is worse than one that stays quiet about a rare problem.

The demos are mounted in real containers, not queried via `toHTML` on the returned
value: a demo can return a `Block` (`ErrorBoundary`, `Portal`),
an array or an accessor — all are valid `Child`s, none is an element.
The report is read after the microtasks drain, because `ErrorBoundary`
publishes its fallback in a `queueMicrotask`.

The timers started by demos (carousel autoplay, toast, tooltip) are
instrumented and stopped at the end — otherwise `node --test` would never exit.

### Tree-shaking

`raptor-bundle` eliminates unused re-exports **before transpilation**,
starting from what the entry requires. Active by default; `--no-treeshake` turns it off.

Measured on an app that uses a single `Button`, imported from the barrel:

| | Modules | Bundle |
|---|---|---|
| `--no-treeshake` | 58 | 527,499 B |
| default | **9** | **39,029 B** |
| deep import (`raptorjs/ui/button`) | 8 | 38,009 B |

**13.5× smaller**, and the barrel comes within 3% of the deep import. The tests
verify not just the size, but also that the trimmed bundle evaluates and gives the
same result as the full one.

#### Why the analysis is done on the source

The bundler emits CommonJS, where `export * from "x"` becomes
`__exportStar(require("x"), exports)` — a dynamic request, impossible to analyze
statically. So we read the import/export graph from the **ESM source**, while it
still is ESM, with the TypeScript parser (already a build dependency; nothing was added).

The algorithm: we start from the entry, propagate which names are required and
follow **only the star that actually provides the symbol**. From a barrel with 35
`export * from`, a single `Button` follows exactly one.

The cut statements are replaced with spaces, not deleted: the lines stay in place,
so the line numbers in the source map keep matching the original file.

#### What it doesn't do

**It doesn't eliminate declarations inside a module.** If you import a single chart
type from a file that contains eleven, all eleven stay. That would require a
dependency graph between declarations; module granularity covers the barrel case,
which is the one that hurts. That's why the deep import stays recommended:
`raptorjs/ui/chart` brings only scale + Line/Area/Bar, not the 11 types from `chart-extra`.

#### Safety

A re-export is cut **only if the target module is side-effect-free**. The source of
truth is `"sideEffects": false` from the nearest `package.json` — all `@raptor/*`
packages declare it, being pure module graphs.

Without a declaration, we fall back to a conservative heuristic: any top-level
statement that isn't a declaration (a call, an assignment, `if`, `for`) means
"may have effects", so the module stays. Two tests pin exactly this behavior, in
both directions.

There are three more cases where nothing is cut, intentionally:

- `import * as ns from "x"` — we don't know what's used from the namespace;
- `import "x"` — the module is requested precisely for its effects;
- a symbol that isn't found anywhere in the graph (a type stripped at transpilation,
  or a wrong import) — we keep all the stars, so we don't break the build.


### CLI

```bash
# build: a single file + index.html with the rewritten script
raptor-bundle build src/main.tsx --out dist/bundle.js --html index.html

# dev: node:http server with live-reload (SSE) on fs.watch
raptor-bundle dev src/main.tsx --root . --port 5173
```

In the application's `package.json`:
```json
{
  "scripts": {
    "dev": "raptor-bundle dev src/main.tsx --root . --port 5173",
    "build": "raptor-bundle build src/main.tsx --out dist/bundle.js --html index.html"
  },
  "devDependencies": { "@raptor/engine/bundle": "workspace:*" }
}
```

### Code API

```ts
import { bundleApp, startDevServer, transpile } from "@raptor/engine/bundle";

// 1. programmatic build → string with a module registry + lazy require
const { code, files } = bundleApp("/abs/path/src/main.tsx");
//   files = the included graph (entry first); code = a single browser bundle

// 2. dev server (returns http.Server)
startDevServer({ entry: "src/main.tsx", root: ".", port: 5173 });

// 3. just the transform (JSX → raptorjs/dom/jsx-runtime, type stripping)
const js = transpile("const x: number = 1; const el = <b>{x}</b>;", "m.tsx");
```

**How it works:** per-module transform (JSX + type stripping, via the TS
compiler) → discovers the emitted `require("spec")` calls → resolves them with the
Node resolver → rewrites them to internal numeric IDs → bundles into an IIFE with a
registry and lazy `require`. The `@raptor/*` graph is closed ESM and zero-dep, so
the bundling is complete and deterministic.

**Limitations (v0.1):** no code-splitting, no minification (for minification,
use the Path C / RaptorEngine pipeline with optional Oxc); tree-shaking
works at the module level, not the declaration level (see [Tree-shaking](#tree-shaking));
it carries only bundle-able modules (`.ts/.tsx/.js/.jsx`), leaving `node:*` and
externals untouched.

---

## @raptor/wire/codec — codec primitives

The lowest level: compact binary encoding (whitepaper §12). You use it
directly only if you're writing a transport or your own codec; otherwise `wire-core`
wraps it for you.

**Exports:** `Writer`, `Reader`.

```ts
import { Writer, Reader } from "@raptor/wire/codec";

const w = new Writer();
w.varint(300);          // LEB128 varint (small numbers = 1 byte)
w.zigzag(-7);           // zig-zag for signed integers
w.float64(3.14);        // 8 bytes IEEE-754
w.string("hello");      // length-prefixed UTF-8
w.bytes(new Uint8Array([1, 2, 3]));
const buf = w.finish(); // Uint8Array

const r = new Reader(buf);
r.varint();   // 300
r.zigzag();   // -7
r.float64();  // 3.14
r.string();   // "hello"
r.bytes();    // Uint8Array [1,2,3]
```

---

## @raptor/wire — opcodes, Document, protocol

The heart of the **state-aware** protocol: semantic delta operations over a
versioned `Document`, plus the Reactive Address Space (RAS) and a schema-aware codec.

**Exports:** `Document`, the operations (`encodeOp`/`decodeOp`, `encodeOpsBatch`/`decodeOpsBatch`
+ the types `SetOp`, `IncOp`, `AppendOp`, `InsertOp`, `RemoveOp`, `MoveOp`, `PatchOp`,
`ClearOp`, `ReplaceOp`, `OpsBatch`), `Opcode`/`FrameType`, `AddressBook`, `SchemaCodec`,
the values (`writeValue`/`readValue`), the message protocol (`encodeMessage`/`decodeMessage`,
`encodeOpsFrame`/`decodeOpsFrame`, `peekFrameType`).

### Versioned Document + delta operations

The operations identify the target by `handle` (the object) + `field` (the field).
Each `apply` returns a `Change` and increments `version`.

```ts
import { Document } from "@raptor/wire";

const doc = new Document();
doc.apply({ kind: "set",    handle: "job:1", field: "progress", value: 10 });
doc.apply({ kind: "inc",    handle: "job:1", field: "progress", delta: 5 }); // 15
doc.apply({ kind: "patch",  handle: "job:1", fields: { name: "build", progress: 40 } });
doc.apply({ kind: "append", handle: "jobs",  value: 1 });
doc.apply({ kind: "insert", handle: "jobs",  index: 0, value: 9 });
doc.apply({ kind: "remove", handle: "jobs",  index: 0 });

doc.get("job:1");    // { name: "build", progress: 40 }
doc.version;         // increments on each apply — the key for delta resync
// other kinds: "move", "clear", "replace". applyBatch(batch) sets resultVersion.
```

**The state-aware thesis (whitepaper §13):** an `INC` on a field is >10× smaller on
the wire than re-serializing the whole object as JSON, because you send the
*operation*, not the *document*.

### Reactive Address Space (RAS)

Field names are sent once; on the hot path a compact session-scoped ID travels.

```ts
import { AddressBook } from "@raptor/wire";

const book = new AddressBook();               // compact IDs from 0x1000
const { address, isNew } = book.assign("job:1.progress"); // allocates / reuses ID
book.handleOf(address);                        // "job:1.progress"
book.addressOf("job:1.progress");              // address
book.define(0x18A1, "BTC.price");              // pins an address (e.g. from the manifest)
// On the wire `address` (varint) flies, not the repeated field string.
```

### Schema-aware codec (adaptive encoding, v0.2)

The constructor takes a `Schema` = `Record<string, FieldSchema>` directly.
Field types: `bool`, `uint`, `int`, `float`, `string`, `percentage` (→ 1 byte),
`money` (int scaled by `scale`), `enum` (index from `values`).

```ts
import { SchemaCodec } from "@raptor/wire";

const codec = new SchemaCodec({
  progress: { type: "percentage" },
  price:    { type: "money", scale: 2 },
  status:   { type: "enum", values: ["sent", "delivered", "read"] },
});
```

---

## @raptor/wire/server — RaptorWire server SDK

**Authoritative** reactive store + `query`/`mutation`/subscription. The server holds
the truth; clients receive snapshot + delta.

**Exports:** `raptorServer`, `PROTOCOL_VERSION`, `ReactiveStore` + the types
`RaptorServer`, `RaptorServerOptions`, `QueryDef`, `QueryContext`, `MutationDef`,
`MutationContext`, `ServerConnection`, `Subscription`.

### Defining a server

```ts
import { raptorServer, type RaptorServer, type ReactiveStore } from "@raptor/wire/server";

export function buildDashboardApp(): RaptorServer {
  const app = raptorServer({ build: "dashboard-0.1.0" });

  // query = the projection exposed to the client (which key prefixes it can see)
  app.query("dashboard", {
    select: () => ["cpu", "memory", "jobs", "job:"],
  });

  // mutation = typed command client → server
  app.mutation("addJob", {
    authorize: () => true,               // optional: access control
    run: ({ input, store }) => {
      const job = input as { id: number; name: string };
      store.transaction(() => {          // atomic batch → 1 commit on the client
        store.setField(`job:${job.id}`, "name", job.name);
        store.setField(`job:${job.id}`, "progress", 0);
        store.append("jobs", job.id);
      });
      return { ok: true, id: job.id };
    },
  });

  app.mutation("setProgress", {
    run: ({ input, store }) => {
      const { id, progress } = input as { id: number; progress: number };
      store.patch(`job:${id}`, { progress });  // a single field → minimal delta
      return { id, progress };
    },
  });

  // initial seed
  app.store.setSignal("cpu", 12);
  app.store.setSignal("memory", 40);
  return app;
}
```

### The `ReactiveStore` API

```ts
store.setSignal("cpu", 12);                 // writes a scalar signal
store.setField("job:1", "name", "build");   // writes a field on an object
store.patch("job:1", { progress: 40 });     // partial patch of fields
store.append("jobs", 1);                     // appends to a collection
store.remove("jobs", index);                 // removes from a collection by index
store.transaction(() => { /* ... */ });      // atomic batch (1 commit / frame)
store.doc.get("messages");                   // access to the underlying Document
```

### Exposing on a transport

```ts
app.serve(link.server);   // binds the server to a transport (e.g. loopback)
```

---

## @raptor/wire/client — session + reactive replica

The client: handshake, subscription, **reactive replica** (each handle is a
`raptorjs` signal), reconnect with delta resync. It includes the loopback transport
for in-process running (tests, demos).

**Exports:** `RaptorClient` + `RaptorClientOptions`; transport `createLoopback`,
`flushLoopback`, + the types `Transport`, `Loopback`, `LoopbackStats`.

```ts
import { createLoopback, flushLoopback, RaptorClient } from "@raptor/wire/client";

// 1. Loopback transport (client ↔ server in-process)
const link = createLoopback();
app.serve(link.server);

// 2. Handshake + subscribe
const client = new RaptorClient(link.client, { build: "web-0.1.0" });
await client.connect();
client.subscribe("dashboard");
await flushLoopback();          // delivers the queued messages

// 3. Read the state as reactive SIGNALS
client.signal("cpu")();                       // the current value
client.signal<number[]>("jobs")();            // array of ids
// an effect() on client.signal(...) re-runs on every delta received

// 4. Session metadata
client.sessionId;          // session id
client.epoch;              // connection epoch
client.version;            // version of the replicated Document
client.snapshotsReceived;  // how many full snapshots it received (budget: 1)

// 5. Typed mutations
const res = await client.mutate("addJob", { id: 4, name: "notify" });
await flushLoopback();
res.value;   // { ok: true, id: 4 }

// 6. Automatic delta resync on reconnect (v0.2 §14.3)
client.close();                         // offline
app.store.setSignal("cpu", 999);        // change lost while offline
const link2 = createLoopback();
app.serve(link2.server);
await client.resume(link2.client, "dashboard");  // requests the delta from the known version
await flushLoopback();
// client.snapshotsReceived does NOT increase: the state recovered via delta, not a full resend.
```

---

## End-to-end: server ↔ RaptorWire ↔ client ↔ DOM

The complete loop from `examples/realtime-dashboard`, headless on Node:

```ts
import { installMiniDom, resetStats, stats } from "raptorjs/dom/testing";
import { createLoopback, flushLoopback, RaptorClient } from "@raptor/wire/client";
import { buildDashboardApp } from "./app.ts";

const doc = installMiniDom();

// server + transport
const app = buildDashboardApp();
const link = createLoopback();
app.serve(link.server);

// client + subscribe
const client = new RaptorClient(link.client, { build: "web-0.1.0" });
await client.connect();
client.subscribe("dashboard");
await flushLoopback();

// fine-grained rendering: bind client.signal(...) to text-nodes via mountChild
const root = doc.createElement("div");
renderDashboard(client, doc, root);   // see examples/.../view.ts

// live tick: 1 delta batch → only the affected text moves in the DOM
resetStats();
app.store.transaction(() => {
  app.store.setSignal("cpu", 40);
  app.store.patch("job:1", { progress: 55 });
});
await flushLoopback();
stats.createElement;   // 0  — no node recreated
stats.textUpdate;      // exactly the affected bindings

// measure the bytes on the wire
link.stats.serverToClientBytes;   // RaptorWire delta (far below a JSON full-resend)
```

---

## @raptor/engine/compiler — `.raptor` parser, IR, semantic graph

The **stable** semantic core, independent of the bundler. It parses `.raptor` into
Raptor IR (with stable IDs), builds the Semantic Application Graph and computes the
diff for HMR.

**Exports:** `parseModule`, `RaptorParseError`; IR (`serializeIR`, `stableId`,
`canonicalize`, `IRNodeKind` + the types `IRModule`, `IRComponent`, `IRSignal`,
`IRDerived`, `IRServerSignal`, `IREffect`, `IRElement`, …); expressions
(`parseExpression`, `analyze`, `exprToJs`, `ExprKind`, …); graph (`buildGraph`,
`SemanticGraph`, `GraphNodeKind`, `EdgeType`); diff (`diffModules`, `GraphDiff`,
`ComponentPatch`, `WireChange`).

```ts
import { parseModule, buildGraph, diffModules, serializeIR } from "@raptor/engine/compiler";

// 1. .raptor source → IR
const ir = parseModule(source, "App.raptor");
ir.components;                    // IRComponent[] (signals, deriveds, bindings, wire)
console.log(serializeIR(ir));    // canonical form, serializable for cache

// 2. IR → semantic graph (module → component → signal → derived → DOM binding)
const graph = buildGraph(ir);
// nodes have stable IDs; liveness = does it have a path to an observable output?

// 3. diff between two versions (the basis for Stateful Reactive HMR)
const next = parseModule(editedSource, "App.raptor");
const diff = diffModules(ir, next);
diff.componentPatches;   // what can be patched state-preserving
diff.wireChanges;        // schema/RAS changes
```

> This package is the "brain": `@raptor/engine`, `@raptor/engine/run` and `@raptor/engine/profile`
> consume the IR and the graph from here. It's deliberately separate from any bundler.

---

## @raptor/engine — build, optimize, codegen, HMR, CLI

The RaptorEngine orchestration: semantic optimizer (Dead Signal Elimination, Dependency
Fusion), multi-target codegen (browser/server/wire) **from a single graph**,
Stateful Reactive HMR, reproducible caching, manifest, and the `raptor` CLI.

**Exports:** `buildModule`, `buildModuleAsync` (+ `BuildResult`, `BuildOptions`, `Chunk`);
`optimize`; codegen `emitBrowser`/`emitServer`/`emitWireManifest`; `defineConfig`/`resolveConfig`/`BuildProfile`;
`DevEngine`/`formatUpdateLog`; caching `computeCacheKey`/`SemanticCache`/`ENGINE_VERSION`;
`buildManifest`; low-level `NaiveEngine`/`createRolldownEngine`/`loadLowLevelEngine`/`detectToolchain`;
inspect `inspectGraph`/`invalidationTrace`/`formatOptimizationTrace`/`analyzeReport`;
CLI `runCli`/`runCliAsync`.

### Build from a single graph

```ts
import {
  buildModule, inspectGraph, formatOptimizationTrace,
  analyzeReport, DevEngine, formatUpdateLog,
} from "@raptor/engine";
import { readFileSync } from "node:fs";

const source = readFileSync("App.raptor", "utf8");
const result = buildModule(source, "App.raptor");

console.log(analyzeReport(result));                    // readable report
console.log(formatOptimizationTrace(result.optimization)); // what DSE/Fusion eliminated
console.log(inspectGraph(result.graph));               // semantic graph dump

result.browser;        // generated browser code (runs on raptorjs + raptorjs/dom)
result.server.code;    // server producers
result.server.producers;   // [{ address: "BTC.price", ... }]
result.wire;           // RAS manifest (addresses with schema)
result.manifest;       // reproducible build manifest (Appendix B)
result.chunks;         // chunking per profile
result.ir;             // the IR (result.ir.components)
```

**What the optimizer does** (from the `App.raptor` example):
- `unused` derived (no path to output) → **eliminated** by Dead Signal Elimination.
- `label` (single consumer) → **fused** into the binding by Dependency Fusion
  (blocked if it has `@debug`).
- `price` server signal → RAS address `0x18A1` with the `money` schema in the wire manifest.

### Stateful Reactive HMR

```ts
const dev = new DevEngine();
dev.update("App.raptor", source);

// expression edit (doesn't touch structure) → state-preserving patch
const edited = source.replace("count * 2", "count * 3");
console.log(formatUpdateLog(dev.update("App.raptor", edited)));   // "patched", state preserved

// structural edit (adds an element) → remount, with an explicit REASON
const structural = source.replace("missing <hr/>", "...");
console.log(formatUpdateLog(dev.update("App.raptor", structural))); // "remount: reason=..."
```

### Async build with optional low-level engine (Rolldown/Oxc)

```ts
import { buildModuleAsync, detectToolchain } from "@raptor/engine";

console.log(detectToolchain());   // { rolldown: false, oxc: false } if they aren't installed
// buildModuleAsync detects Rolldown/Oxc dynamically; without them → naive zero-dep fallback.
const out = await buildModuleAsync(source, "App.raptor", { minify: true });
```

### Reproducible caching

```ts
import { computeCacheKey, SemanticCache } from "@raptor/engine";

// the key = source + compiler version + profile + target + schema compat
const key = computeCacheKey({ source, target: "browser", profile: "production" });
const cache = new SemanticCache();
if (!cache.has(key)) cache.set(key, result);
```

---

## @raptor/engine/run — server runtime + SSR + dev server

Connects `serverSignal` → reactive store → RaptorWire → client **from the same graph**,
plus routing, SSR/resume, sessions, observability, and a live dev server (fs.watch
→ HMR via SSE).

**Exports:** `RaptorRuntime` (+ `RunConfig`, `ServerSignalDef`, `RuntimeMetrics`,
`RuntimeEvent`, `HttpResult`, `Channel`); `renderComponent`/`renderDocument` (+ `SsrResult`,
`ResumePayload`, `SsrOptions`); `matchRoute`/`RouteDef`; `evalExpr`/`Env`; real HTTP node
`createNodeServer`/`listen`/`closeServer`; `RaptorDevServer`/`readFirstSseEvent`; CLI `runRunCli`.

### Runtime from build + SSR + reactive server signal

```ts
import { buildModule } from "@raptor/engine";
import { RaptorRuntime, renderDocument } from "@raptor/engine/run";
import { RaptorClient } from "@raptor/wire/client";

const result = buildModule(source, "App.raptor");
const runtime = RaptorRuntime.fromBuild(result, { initial: { "BTC.price": 60000 } });

// SSR: server-rendered HTML from the same graph
const ssr = runtime.ssr("/");
console.log(renderDocument(ssr, ssr.resume.component));

// server signal → RaptorWire → reactive client
const client = new RaptorClient(runtime.connect());
await client.connect();
client.subscribe("signals");

runtime.produce("BTC.price", 61000);   // the server produces
// → client.signal("BTC.price")() becomes 61000 reactively

// observability
runtime.metrics;              // { activeConnections, ... }
runtime.log;                  // event log
runtime.shutdown();
```

### Real Node HTTP server

```ts
import { createNodeServer, listen, closeServer } from "@raptor/engine/run";

const server = createNodeServer(runtime);
const { port } = await listen(server, 0);
const res = await fetch(`http://localhost:${port}/`);
await closeServer(server);
```

### Live dev server (HMR via SSE)

```ts
import { RaptorDevServer } from "@raptor/engine/run";

const dev = new RaptorDevServer({ entry: "App.raptor" });
// fs.watch → incremental recompile → diff → push HMR on /  (SSE)
// the client swaps on #raptor-root; SSR re-renders.
```

CLI equivalent: `pnpm raptor:dev examples/raptorengine-app/src/App.raptor`.

---

## @raptor/engine/profile — telemetry + PGO

Collects runtime telemetry (signal frequency, derived fan-out, route co-usage,
wire payload, DOM bursts) and emits a **strategy-hints plan** (chunk folding,
preload, batch, encoding) consumed by `buildModule({ planHints })`.

> **The golden rule (whitepaper §24): adaptive *strategies*, not adaptive *correctness*.**
> What doesn't appear in the profile is **kept**, never eliminated. The profile never
> changes correctness, only strategy.

**Exports:** `Profiler`/`DEFAULT_THRESHOLDS`; `runScenario`/`wireByteSize` (+ `Scenario`,
`ScenarioStep`); `planFromProfile`/`DEFAULT_PLAN_OPTIONS` (+ `PlanResult`, `PlanContext`,
`PlanOptions`); `emptyProfile`/`serializeProfile`/`PROFILE_VERSION`; CLI `runProfileCli`.

### The complete PGO loop

```ts
import { buildModule } from "@raptor/engine";
import { RaptorRuntime } from "@raptor/engine/run";
import { Profiler, runScenario, planFromProfile, serializeProfile } from "@raptor/engine/profile";

const result = buildModule(source, "App.raptor");
const runtime = RaptorRuntime.fromBuild(result, { initial: { "BTC.price": 60000 } });

// 1. run a representative scenario on the runtime, collecting telemetry
const profiler = new Profiler(result.graph);
runScenario(runtime, profiler, {
  sessions: [
    [{ visit: "/" }, { produce: { address: "BTC.price", value: 60250 } }],
    [{ visit: "/" }, { produce: { address: "BTC.price", value: 60875 } }],
  ],
});
const profile = profiler.finish();
console.log(serializeProfile(profile));   // raptor.profile

// 2. profile → hints plan (strategy)
const plan = planFromProfile(profile, {
  routes: [{ path: "/", component: "App" }],
  components: result.ir.components.map((c) => c.name),
  serverSignals: result.server.producers.map((p) => p.address),
});
plan.hints.preloadRoutes;
plan.hints.encodingSpecialization;
plan.hints.batchSizes;
plan.keptDespiteUnseen;    // §24 proof: kept even though unseen in the profile

// 3. profile-guided rebuild
const guided = buildModule(source, "App.raptor", { planHints: plan.hints });
guided.manifest.hintsApplied;
guided.wire.addresses;      // the addresses stay — correctness doesn't depend on the profile
```

---

## @raptor/test — autonomous behavioral testing

It discovers the application's behavior on its own, synthesizes a stateful
digital-twin backend and explores the state space:
`observe → infer → synthesize → explore → verify → replay`. **No hand-written tests.**

**Exports:** `RaptorTest` (+ `RaptorTestConfig`, `ScenarioResult`, `Finding`);
`VirtualClock`; `VirtualDB`/`RaptorTwin` (+ `TwinRequest`, `TwinResponse`, `RouteHandler`);
`NetworkController`/`defaultSchedule`/`DEFAULT_TIMING`; `BehaviorGraph`/`stateId`;
`Coverage`; explorer `actionScore`/`pickBest`; oracle (`evaluate`, `BUILTIN_INVARIANTS`,
`noExceptions`, `noInfiniteLoading`, `Invariant`, …); `chaosSchedules`; replay
`serializeCapsule`/`parseCapsule`; semantic (`semanticId`, `stableKey`, `actionId`, …);
+ the types from `types.ts` (`AppHarness`, `Capsule`, `ProbeEvent`, `NetworkSchedule`, …).

### The complete autonomous cycle

```ts
import { RaptorTest, serializeCapsule } from "@raptor/test";
import { buildCartApp } from "./app.ts";

const app = buildCartApp();       // provides harness + twin + invariants
const rt = new RaptorTest({
  harness: app.harness,
  twin: app.twin,
  invariants: app.invariants,
  maxDepth: 3,
  buildFingerprint: "cart@demo",
});

// 1. autonomous sequence discovery (coverage-guided BFS)
const sequences = rt.discover();
rt.coverage.count("uiStates");
rt.coverage.count("transitions");
rt.coverage.count("apiInteractions");

// 2. exploration + chaos (RaptorChaos) + oracle (RaptorOracle) → capsules
const findings = rt.explore();
for (const finding of findings) {
  const c = finding.capsule;
  c.failedOracle;      // which invariant failed
  c.actionLog;         // MINIMIZED reproduction
  c.detail;

  // 3. deterministic replay (virtual time → identical reproduction)
  const replay = rt.replay(c);
  replay.reproduced;   // true
}

// 4. executable .raptorcap artifact
if (findings.length > 0) {
  console.log(serializeCapsule(findings[0].capsule));
}
```

### What it discovers autonomously (from the demo)

- **Stale-read bug RT-184:** `Add to cart` → immediate navigation → a delayed `GET /cart`
  overwrites the UI with the old state (UI shows 0, the server has 1).
  Minimized to 2 actions, reproduced deterministically from a `.raptorcap` capsule.
- **Robustness bug:** on `POST 500`, the application blindly reads `.count` from an
  error response.

Everything is deterministic through **virtual time** (`VirtualClock` = a discrete
event scheduler): the same capsule → the exact same execution.

### Reusable components

```ts
import { VirtualClock, RaptorTwin, VirtualDB, Coverage, evaluate, BUILTIN_INVARIANTS } from "@raptor/test";

const clock = new VirtualClock();          // deterministic discrete scheduler
const db = new VirtualDB();                 // in-memory backend state
const twin = new RaptorTwin(db, routes);    // backend digital twin from observed routes
const cov = new Coverage();                 // tracks uiStates / transitions / apiInteractions
evaluate(BUILTIN_INVARIANTS, context);      // runs the oracles on a state
```

---

## The `.raptor` format

A `.raptor` file describes a component declaratively; the compiler decomposes it
into signals / deriveds / server signals / bindings and generates browser + server + wire
from a single graph.

```raptor
component App {
  const count = state(0)
  const doubled = derived(() => count * 2)          // 2 consumers → survives fusion
  const label = derived(() => "clicks: " + count)   // single consumer → fused into the binding
  const unused = derived(() => doubled + count + 999) // no output → eliminated (DSE)
  const price = serverSignal("BTC.price", schema.money) // → schema + RAS address in the manifest

  <div class="app">
    <button on:click={count++}>increment</button>
    <span class="count">{label}</span>
    <span class="double" data-value={doubled}>doubled = {doubled}</span>
    <span class="price">price = {price}</span>
  </div>
}
```

- `state(v)` — mutable local signal.
- `derived(() => expr)` — derived value; fused if it has a single consumer
  (blocked at `@debug`); eliminated if it doesn't reach an observable output.
- `serverSignal("addr", schema.T)` — a signal produced by the server; becomes a RAS
  address with a schema in the wire manifest.
- `on:click={count++}` — event binding; `{expr}` in markup — fine-grained text/attr binding.

Compile it with `buildModule(source, "App.raptor")` or the `raptor build` CLI.

---

## CLI reference

Three CLIs, exposed through npm scripts and as the binaries `raptor` / `raptor-run` / `raptor-profile`.

### `raptor` (build/inspect — `@raptor/engine`)

```bash
pnpm raptor build   examples/raptorengine-app/src/App.raptor --report
pnpm raptor inspect graph examples/raptorengine-app/src/App.raptor
pnpm raptor analyze examples/raptorengine-app/src/App.raptor
pnpm raptor toolchain          # detects installed Rolldown/Oxc
```

### `raptor:run` (server runtime — `@raptor/engine/run`)

```bash
pnpm raptor:run info examples/raptorengine-app/src/App.raptor
pnpm raptor:run ssr  examples/raptorengine-app/src/App.raptor    # emits SSR HTML
pnpm raptor:dev      examples/raptorengine-app/src/App.raptor    # live dev server (HMR/SSE)
```

### `raptor:profile` (PGO — `@raptor/engine/profile`)

```bash
pnpm raptor:profile examples/raptorengine-app/src/App.raptor
```

### Optional low-level engine (Rolldown/Oxc)

```bash
cd integrations/rolldown && npm install && npm run verify
# semantic RaptorEngine → Rolldown bundle → Oxc minify
```

---

*See also [`README.md`](../README.md) (architecture), [`SPEC-RaptorWire-v0.2.md`](../SPEC-RaptorWire-v0.2.md)
(protocol) and the whitepapers in [`design/`](../design/).*
