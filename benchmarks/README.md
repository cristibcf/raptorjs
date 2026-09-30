# RaptorJS Benchmarks

A benchmark suite that compares **RaptorJS fine-grained reactivity** against
real frameworks: **React 19**, **Preact 10**, and the signals library
**@preact/signals-core**.

> ⚠️ A **dev-only, isolated** project. It has its own `package.json` and `node_modules`
> and is **not** part of the pnpm workspace. The *zero-dependency runtime*
> guarantee of the `@raptor/*` packages stays intact — nothing here reaches the packages.

## Running

```bash
cd benchmarks
npm install
npm run bench          # everything: DOM + signals, writes results.json / results.md
npm run bench:dom      # DOM benchmark only
npm run bench:signals  # signals microbenchmark only
```

Results are written to [`results.md`](./results.md) and [`results.json`](./results.json).

## Methodology

### DOM benchmark (apples-to-apples)

The key to correctness: **all frameworks render in the SAME `jsdom`**.
RaptorJS works structurally on `globalThis.document` (the same runtime runs
in the browser and headless), so React, Preact, and RaptorJS hit exactly the same
DOM implementation. We are not comparing different DOMs.

On top of that, we patch the jsdom prototypes (`createElement`, `createTextNode`,
`appendChild`/`insertBefore`, `removeChild`, the text setters) to count the
**real DOM operations** each framework initiates. The same counters for
everyone ⇒ we honestly measure "how much work" each one does.

Scenarios (inspired by [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark), scaled for headless), N = 1000 rows:

| Scenario | What it measures |
| --- | --- |
| `create 1000` | building a list from scratch |
| `updateAll 1000` | changing the label of every row |
| `update every 10th` | changing the label of every 10th row (highlights fine-grained) |
| `clear 1000` | emptying the list |

Idiomatic implementations: React uses a memoized `Row` component + `key` +
`flushSync` for synchronous rendering; Preact uses a top-level re-`render`
(synchronous diff); RaptorJS uses a keyed `For` with a `label` signal per row.
Time = median of 25 runs after 5 warmups.

### Signals microbenchmark

Identical graph for RaptorJS and `@preact/signals-core`: 1 source → 8 parallel
chains of `derived`/`computed`, each of depth 10. Per iteration: update
the source + read (pull) the tails. Pull model, fully synchronous. **The identical
checksum** confirms that both compute exactly the same graph.

## Interpretation

- **`updateAll`**: everyone does the **same number of DOM mutations** (1000 `textUpdate`),
  but RaptorJS fine-grained avoids VDOM reconciliation ⇒ much lower time for
  identical mutations. This is the architectural win.
- **`update every 10th`**: RaptorJS scales with the *changed* rows (100);
  the VDOM reconciles the *whole* list (1000) ⇒ the gap grows with list size.
- **`create`/`clear`**: dominated by node creation/deletion; all in the same
  performance class. RaptorJS does more `removeChild` on `clear` (per-node dispose
  in `For`) — a real cost, honestly reported.
- **signals**: `@preact/signals-core` (a mature, heavily optimized library) is
  faster than the young RaptorJS reactive core on this pull-heavy workload. It's a
  benchmark to chase for future optimizations, not a cosmetically dressed-up result.

## Caveats (read them)

- **Headless, not browser.** jsdom ≠ real layout/paint. The numbers are useful for
  JS cost + logical DOM mutations, not for on-screen render time. For "sales-ready"
  figures you'd want a real js-framework-benchmark in the browser (see below).
- **Solid was excluded from the signals microbenchmark**: its model is
  push/eager and its effects depend on the scheduler in `solid-js/web`; in a
  bare Node environment memos don't recompute on pull without an observer, so any
  number would be misleading. We prefer not to report false figures.
- **A single environment/CPU.** It runs on your machine; the absolute varies, the ratios
  between frameworks are the relevant part.

## Browser benchmark (real js-framework-benchmark)

In [`browser/`](./browser) there is the full port to a **real browser** (Chromium):
RaptorJS, React 19, Preact 10, and **Solid 1.9** mounted in a real DOM, with the
standard operations from js-framework-benchmark (create 1k/10k, update every 10th, select,
swap, remove, append, clear) and a results table with the geometric mean.

```bash
cd benchmarks
npm run build:browser     # esbuild -> browser/dist/bundle.js (bundles everything)
npm run serve:browser     # http://localhost:5188/
# open the URL in a browser and click "Run all"
```

Watch mode while editing: `node browser/build.ts --watch`.

**Solid is compiled with `babel-preset-solid`** (via `esbuild-plugin-solid`, applied
only to `.tsx` files — the rest of the apps are `.ts` without JSX), so it uses its
real performance path (compile-time DOM templates), not hyperscript.

The results of a run: [`browser/results-browser.md`](./browser/results-browser.md).
In short: **RaptorJS has the best geo. mean**, dominating the surgical operations
(update/select/swap/remove) where fine-grained avoids reconciliation; it's weaker at
`clear` (per-node dispose). Compilation helped Solid a lot at create/append
(create 10k: ~167 ms hyperscript → ~52 ms compiled).

### Why it's fair

- All frameworks mount in the **same Chromium**, real DOM.
- **Synchronous commit time**: everyone applies synchronously (React `flushSync`, the rest
  synchronous), so we measure the JS update cost — the part that differs. `requestAnimation-
  Frame` is throttled in the embedded pane, so we don't measure "to paint".
- **Production** build (`NODE_ENV=production`, minified), median-of-6 + warmup.
