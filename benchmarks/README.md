# RaptorJS Benchmarks

Suită de benchmark care compară **reactivitatea fine-grained a RaptorJS** cu
framework-uri reale: **React 19**, **Preact 10** și librăria de signals
**@preact/signals-core**.

> ⚠️ Proiect **dev-only, izolat**. Are propriul `package.json` și `node_modules`
> și **nu** face parte din workspace-ul pnpm. Garanția *zero-dependency runtime*
> a pachetelor `@raptor/*` rămâne intactă — nimic de aici nu ajunge în pachete.

## Rulare

```bash
cd benchmarks
npm install
npm run bench          # tot: DOM + signals, scrie results.json / results.md
npm run bench:dom      # doar DOM benchmark
npm run bench:signals  # doar signals microbenchmark
```

Rezultatele se scriu în [`results.md`](./results.md) și [`results.json`](./results.json).

## Metodologie

### DOM benchmark (apples-to-apples)

Cheia corectitudinii: **toate framework-urile randează în ACELAȘI `jsdom`**.
RaptorJS lucrează structural pe `globalThis.document` (același runtime rulează
în browser și headless), deci React, Preact și RaptorJS ating exact aceeași
implementare de DOM. Nu comparăm DOM-uri diferite.

În plus, patch-uim prototipurile jsdom (`createElement`, `createTextNode`,
`appendChild`/`insertBefore`, `removeChild`, setterele de text) ca să numărăm
**operațiile DOM reale** inițiate de fiecare framework. Aceleași contoare pentru
toți ⇒ măsurăm cinstit „câtă muncă” face fiecare.

Scenarii (inspirate din [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark), scalate pentru headless), N = 1000 rânduri:

| Scenariu | Ce măsoară |
| --- | --- |
| `create 1000` | construire listă de la zero |
| `updateAll 1000` | schimbă eticheta tuturor rândurilor |
| `update every 10th` | schimbă eticheta fiecărui al 10-lea rând (evidențiază fine-grained) |
| `clear 1000` | golește lista |

Implementări idiomatice: React folosește componentă `Row` memoizată + `key` +
`flushSync` pentru randare sincronă; Preact folosește re-`render` top-level
(diff sincron); RaptorJS folosește `For` keyed cu un semnal `label` per rând.
Timp = mediana a 25 rulări după 5 de warmup.

### Signals microbenchmark

Graf identic pentru RaptorJS și `@preact/signals-core`: 1 sursă → 8 lanțuri
paralele de `derived`/`computed`, fiecare de adâncime 10. Per iterație: update
pe sursă + citire (pull) a cozilor. Model pull, complet sincron. **Checksum-ul
identic** confirmă că ambele calculează exact același graf.

## Interpretare

- **`updateAll`**: toate fac **același număr de mutații DOM** (1000 `textUpdate`),
  dar fine-grained-ul RaptorJS evită reconcilierea VDOM ⇒ timp mult mai mic la
  mutații identice. Aici e câștigul arhitectural.
- **`update every 10th`**: RaptorJS scalează cu rândurile *schimbate* (100);
  VDOM-ul reconciliază *toată* lista (1000) ⇒ diferența crește cu mărimea listei.
- **`create`/`clear`**: dominate de crearea/ștergerea nodurilor; toate în aceeași
  clasă de performanță. RaptorJS face mai multe `removeChild` la `clear` (dispose
  per-nod în `For`) — un cost real, onest raportat.
- **signals**: `@preact/signals-core` (librărie matură, foarte optimizată) e mai
  rapidă decât nucleul reactiv tânăr al RaptorJS pe acest pull intens. E un reper
  de urmărit pentru optimizări viitoare, nu un rezultat cosmetizat.

## Caveats (citește-le)

- **Headless, nu browser.** jsdom ≠ layout/paint real. Numerele sunt utile pentru
  costul JS + mutații DOM logice, nu pentru timp de randare pe ecran. Pentru cifre
  „de vânzare” ar trebui js-framework-benchmark real în browser (vezi mai jos).
- **Solid a fost exclus din microbenchmark-ul de signals**: modelul lui e
  push/eager și effect-urile depind de scheduler-ul din `solid-js/web`; într-un
  mediu Node bare memo-urile nu recomputează la pull fără observer, deci orice
  număr ar fi înșelător. Preferăm să nu raportăm cifre false.
- **Un singur mediu/CPU.** Rulează pe mașina ta; absolutul variază, raporturile
  între framework-uri sunt partea relevantă.

## Browser benchmark (js-framework-benchmark real)

În [`browser/`](./browser) există portul complet în **browser real** (Chromium):
RaptorJS, React 19, Preact 10 și **Solid 1.9** montate în DOM real, cu operațiile
standard din js-framework-benchmark (create 1k/10k, update every 10th, select,
swap, remove, append, clear) și un tabel de rezultate cu media geometrică.

```bash
cd benchmarks
npm run build:browser     # esbuild -> browser/dist/bundle.js (bundle-uiește tot)
npm run serve:browser     # http://localhost:5188/
# deschide URL-ul în browser și apasă „Ruleaza tot”
```

Watch-mode la editare: `node browser/build.ts --watch`.

**Solid e compilat cu `babel-preset-solid`** (prin `esbuild-plugin-solid`, aplicat
doar fișierelor `.tsx` — restul apps sunt `.ts` fără JSX), deci folosește calea lui
reală de performanță (template-uri DOM la compile-time), nu hyperscript.

Rezultatele unei rulări: [`browser/results-browser.md`](./browser/results-browser.md).
Pe scurt: **RaptorJS are cel mai bun geo. mean**, dominând operațiile chirurgicale
(update/select/swap/remove) unde fine-grained-ul evită reconcilierea; e mai slab la
`clear` (dispose per-nod). Compilarea l-a ajutat mult pe Solid la create/append
(create 10k: ~167 ms hyperscript → ~52 ms compilat).

### De ce e corect

- Toate framework-urile montează în **același Chromium**, DOM real.
- **Timp de commit sincron**: toate aplică sincron (React `flushSync`, restul
  sincron), deci măsurăm costul de update JS — partea care diferă. `requestAnimation-
  Frame` e throttled în pane-ul embedded, așa că nu măsurăm „până la paint”.
- Build de **producție** (`NODE_ENV=production`, minified), median-of-6 + warmup.
