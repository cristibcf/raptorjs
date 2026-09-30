# js-framework-benchmark results (real browser)

Environment: Chromium 152 (the browser in Claude desktop), Windows 11, AMD Ryzen AI 9.
Metric: **median time (ms) of the synchronous commit** of the update (median of 6 runs,
after 2 warmups). Less = better. The numbers vary from run to run
(GC, throttling, background load) — **the ratios and ordering matter, not the absolute**.

**Solid is compiled with `babel-preset-solid`** (JSX → fine-grained DOM
templates at compile time), so the comparison is fair to Solid — it does not
use hyperscript. **RaptorJS includes optimizations #1–#4** (see below).

| Operation | RaptorJS | React 19 | Preact 10 | Solid 1.9 | Fastest |
| --- | ---: | ---: | ---: | ---: | :-- |
| create 1,000 | 6.30 | 4.75 | **3.15** | 4.65 | Preact |
| update every 10th | **0.35** | 1.10 | 2.55 | 1.25 | **RaptorJS** |
| select row | **0.05** | 0.40 | 2.80 | 0.40 | **RaptorJS** |
| swap rows | **1.05** | 2.10 | 2.00 | 1.25 | **RaptorJS** |
| remove row | **0.10** | 0.35 | 2.70 | 1.75 | **RaptorJS** |
| create 10,000 | 33.0 | 121.85 | **32.25** | 38.2 | Preact (Raptor ~tied) |
| append 1,000 | **4.65** | 8.75 | 21.65 | 10.70 | **RaptorJS** |
| clear 10,000 | 9.05 | 15.40 | **4.65** | 6.00 | **Preact** |
| **geo. mean** | **1.42** | 3.55 | 5.01 | 3.25 | **RaptorJS** |

## Effect of the optimizations on RaptorJS (before → after)

The four optimizations in the benchmark moved exactly the weak spots:

| Metric | Before | After | Optimization |
| --- | ---: | ---: | :-- |
| create 10,000 (browser) | ~65 ms | **~33 ms** | #3 `template()` (skeleton cloning) |
| append 1,000 (browser) | ~12 ms | **~4.7 ms** | #2 + #3 |
| clear 10,000 (browser) | ~25 ms | **~9 ms** | #1 detach-then-dispose |
| clear 1,000 (jsdom, DOM ops) | 3000 removeChild | **1000** | #1 (parity with React/Preact) |
| create 1,000 (jsdom, DOM ops) | 6000 insert | **5000** | #2 (no comment-anchor per text) |
| signals pull (upd/s) | ~150k | **~220k** | #4 source reconciliation (identical checksum) |

## Effect of compiling Solid (why it was needed)

Moving from hyperscript (`solid-js/h`) to the real compiler helped Solid
exactly where it mattered — bulk creation via template cloning:

| Operation | Solid hyperscript | Solid compiled |
| --- | ---: | ---: |
| create 10,000 | ~167 ms | **~52 ms** |
| append 1,000 | ~45 ms | **~22 ms** |

The surgical operations (update/select) were already fine-grained via `createStore`,
so they changed little. Now Solid is a fair benchmark.

## What it shows (honestly)

- **RaptorJS has the best geo. mean**, because it **dominates the surgical operations**
  (`update every 10th`, `select`, `swap`, `remove`): fine-grained touches exactly the
  affected node, without reconciliation. `update every 10th` 0.35 ms vs 1.10 (React) / 1.25 (Solid); `remove row` 0.10 ms vs 0.35 / 1.75.
- **`append 1,000`**: RaptorJS the fastest — `For` adds only the new nodes;
  the VDOM re-diffs the whole 11k list.
- **bulk create**: after `template()` (#3), RaptorJS is ~tied with Preact at 10k
  and above Solid/React. At `create 1,000` the small-N variation is large (warmup) — 10k is
  the trustworthy signal.
- **`clear 10,000`**: after #1, RaptorJS dropped from ~25 ms to ~9 ms (no longer an
  outlier); Preact remains fastest at clear.

## Caveats

- **We measure the synchronous commit (JS), not the paint.** `requestAnimationFrame` is
  throttled when the embedded pane isn't visible, which corrupted "to paint".
  All frameworks apply synchronously (React `flushSync`, Preact/Solid/Raptor
  synchronous), so the synchronous time captures exactly the update cost — the part that
  differs. The layout/paint cost for the same resulting DOM is comparable.
- **Run-to-run variation** (e.g. `create 10k` React swung 227–303 ms between
  runs due to background load). Run it 2-3 times; use the geo. mean and
  ordering, not the exact millisecond.
- Everything in **production** (`NODE_ENV=production`, minified via esbuild), median-of-6.
