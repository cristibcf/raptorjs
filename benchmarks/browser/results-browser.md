# Rezultate js-framework-benchmark (browser real)

Mediu: Chromium 152 (browser-ul din Claude desktop), Windows 11, AMD Ryzen AI 9.
Metrică: **timp median (ms) de commit sincron** al update-ului (median din 6 rulări,
după 2 de warmup). Mai puțin = mai bine. Numerele variază de la rulare la rulare
(GC, throttling, background load) — **contează raporturile și ordinea, nu absolutul**.

**Solid este compilat cu `babel-preset-solid`** (JSX → template-uri DOM
fine-grained la compile-time), deci comparația e corectă față de Solid — nu
folosește hyperscript. **RaptorJS include optimizările #1–#4** (vezi mai jos).

| Operație | RaptorJS | React 19 | Preact 10 | Solid 1.9 | Cel mai rapid |
| --- | ---: | ---: | ---: | ---: | :-- |
| create 1,000 | 6.30 | 4.75 | **3.15** | 4.65 | Preact |
| update every 10th | **0.35** | 1.10 | 2.55 | 1.25 | **RaptorJS** |
| select row | **0.05** | 0.40 | 2.80 | 0.40 | **RaptorJS** |
| swap rows | **1.05** | 2.10 | 2.00 | 1.25 | **RaptorJS** |
| remove row | **0.10** | 0.35 | 2.70 | 1.75 | **RaptorJS** |
| create 10,000 | 33.0 | 121.85 | **32.25** | 38.2 | Preact (Raptor ~egal) |
| append 1,000 | **4.65** | 8.75 | 21.65 | 10.70 | **RaptorJS** |
| clear 10,000 | 9.05 | 15.40 | **4.65** | 6.00 | **Preact** |
| **geo. mean** | **1.42** | 3.55 | 5.01 | 3.25 | **RaptorJS** |

## Efectul optimizărilor pe RaptorJS (before → after)

Cele patru optimizări din benchmark au mutat exact punctele slabe:

| Metrică | Înainte | După | Optimizare |
| --- | ---: | ---: | :-- |
| create 10,000 (browser) | ~65 ms | **~33 ms** | #3 `template()` (clonare schelet) |
| append 1,000 (browser) | ~12 ms | **~4.7 ms** | #2 + #3 |
| clear 10,000 (browser) | ~25 ms | **~9 ms** | #1 detach-then-dispose |
| clear 1,000 (jsdom, DOM ops) | 3000 removeChild | **1000** | #1 (paritate cu React/Preact) |
| create 1,000 (jsdom, DOM ops) | 6000 insert | **5000** | #2 (fără comment-anchor per text) |
| signals pull (upd/s) | ~150k | **~220k** | #4 reconciliere surse (checksum identic) |

## Efectul compilării Solid (de ce era nevoie)

Trecerea de la hyperscript (`solid-js/h`) la compilatorul real l-a ajutat pe Solid
exact unde conta — crearea în masă prin clonare de template-uri:

| Operație | Solid hyperscript | Solid compilat |
| --- | ---: | ---: |
| create 10,000 | ~167 ms | **~52 ms** |
| append 1,000 | ~45 ms | **~22 ms** |

Operațiile chirurgicale (update/select) erau deja fine-grained prin `createStore`,
deci s-au schimbat puțin. Acum Solid e un reper corect.

## Ce arată (onest)

- **RaptorJS are cel mai bun geo. mean**, pentru că **domină operațiile chirurgicale**
  (`update every 10th`, `select`, `swap`, `remove`): fine-grained-ul atinge exact
  nodul afectat, fără reconciliere. `update every 10th` 0.35 ms vs 1.10 (React) / 1.25 (Solid); `remove row` 0.10 ms vs 0.35 / 1.75.
- **`append 1,000`**: RaptorJS cel mai rapid — `For` adaugă doar nodurile noi;
  VDOM-ul re-diff-uiește toată lista de 11k.
- **create în masă**: după `template()` (#3), RaptorJS e ~egal cu Preact la 10k
  și peste Solid/React. La `create 1,000` variația small-N e mare (warmup) — 10k e
  semnalul de încredere.
- **`clear 10,000`**: după #1, RaptorJS a coborât de la ~25 ms la ~9 ms (nu mai e
  outlier); Preact rămâne cel mai rapid la clear.

## Caveats

- **Măsurăm commit-ul sincron (JS), nu paint-ul.** `requestAnimationFrame` e
  throttled când pane-ul embedded nu e vizibil, ceea ce corupea „până la paint”.
  Toate framework-urile aplică sincron (React `flushSync`, Preact/Solid/Raptor
  sincron), deci timpul sincron captează exact costul de update — partea care
  diferă. Costul de layout/paint pentru același DOM rezultat e comparabil.
- **Variație între rulări** (ex. `create 10k` React a oscilat 227–303 ms între
  rulări din cauza background load). Rulează de 2-3 ori; folosește geo. mean și
  ordinea, nu milisecunda exactă.
- Toate în **producție** (`NODE_ENV=production`, minified prin esbuild), median-of-6.
