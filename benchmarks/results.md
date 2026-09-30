# RaptorJS benchmark results

Generated: 2026-09-23T08:42:22.709Z
Node v24.16.0 · win32/x64 · AMD Ryzen AI 9 465 w/ Radeon 880M              

All DOM frameworks render in the SAME jsdom, with DOM operation counters
patched onto the jsdom prototypes => an apples-to-apples comparison.

### DOM benchmark — median time (ms), same jsdom

| Scenario | RaptorJS | React 19 | Preact 10 |
| --- | ---: | ---: | ---: |
| create 1000 | 37.41 | 40.40 | 32.82 |
| updateAll 1000 | 1.66 | 23.30 | 5.49 |
| update every 10th (100) | 0.27 | 5.61 | 3.85 |
| clear 1000 | 8.12 | 10.29 | 8.59 |

### Real DOM operations per scenario (create el / text / insert / remove / textUpdate)

| Scenario | RaptorJS | React 19 | Preact 10 |
| --- | --- | --- | --- |
| create 1000 | 3000/2000/5000/0/0 | 3000/0/3000/0/2000 | 0/2000/5000/0/0 |
| updateAll 1000 | 0/0/0/0/1000 | 0/0/0/0/1000 | 0/0/0/0/1000 |
| update every 10th (100) | 0/0/0/0/100 | 0/0/0/0/100 | 0/0/0/0/100 |
| clear 1000 | 0/0/0/1000/0 | 0/0/0/1000/0 | 0/0/0/1000/0 |

### Signals microbenchmark — pull propagation, updates/sec (more = better)

| Library | updates/sec | total time (ms) | checksum |
| --- | ---: | ---: | ---: |
| RaptorJS | 185,615 | 215.5 | 6420032000 |
| @preact/signals | 455,395 | 87.8 | 6420032000 |

> Identical checksum = identically computed graph (correctness check).

## How to read the results

- **updateAll**: all frameworks do the same number of DOM mutations (textUpdate),
  but RaptorJS/fine-grained avoids VDOM reconciliation => much lower time for the same mutations.
- **update every 10th**: RaptorJS scales with the *changed* rows; VDOM scales with
  the *total* rows (diff over the whole list) => the gap grows with list size.
- **create/clear**: dominated by node creation/deletion; all in the same class.
- **signals**: RaptorJS vs a mature, production signals library (@preact/signals-core).

