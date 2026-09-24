# Rezultate benchmark RaptorJS

Generat: 2026-09-23T08:42:22.709Z
Node v24.16.0 · win32/x64 · AMD Ryzen AI 9 465 w/ Radeon 880M              

Toate framework-urile DOM randeaza in ACELASI jsdom, cu contoare de operatii
DOM patch-uite pe prototipurile jsdom => comparatie apples-to-apples.

### DOM benchmark — timp median (ms), acelasi jsdom

| Scenariu | RaptorJS | React 19 | Preact 10 |
| --- | ---: | ---: | ---: |
| create 1000 | 37.41 | 40.40 | 32.82 |
| updateAll 1000 | 1.66 | 23.30 | 5.49 |
| update every 10th (100) | 0.27 | 5.61 | 3.85 |
| clear 1000 | 8.12 | 10.29 | 8.59 |

### Operatii DOM reale pe scenariu (create el / text / insert / remove / textUpdate)

| Scenariu | RaptorJS | React 19 | Preact 10 |
| --- | --- | --- | --- |
| create 1000 | 3000/2000/5000/0/0 | 3000/0/3000/0/2000 | 0/2000/5000/0/0 |
| updateAll 1000 | 0/0/0/0/1000 | 0/0/0/0/1000 | 0/0/0/0/1000 |
| update every 10th (100) | 0/0/0/0/100 | 0/0/0/0/100 | 0/0/0/0/100 |
| clear 1000 | 0/0/0/1000/0 | 0/0/0/1000/0 | 0/0/0/1000/0 |

### Signals microbenchmark — propagare pull, updates/sec (mai mult = mai bine)

| Librarie | updates/sec | timp total (ms) | checksum |
| --- | ---: | ---: | ---: |
| RaptorJS | 185,615 | 215.5 | 6420032000 |
| @preact/signals | 455,395 | 87.8 | 6420032000 |

> Checksum identic = graf calculat identic (verificare de corectitudine).

## Cum se citesc rezultatele

- **updateAll**: toate framework-urile fac acelasi numar de mutatii DOM (textUpdate),
  dar RaptorJS/fine-grained evita reconcilierea VDOM => timp mult mai mic la aceleasi mutatii.
- **update every 10th**: RaptorJS scaleaza cu randurile *schimbate*; VDOM scaleaza cu
  *totalul* randurilor (diff peste toata lista) => diferenta creste cu marimea listei.
- **create/clear**: dominate de crearea/stergerea nodurilor; toate sunt in aceeasi clasa.
- **signals**: RaptorJS vs o librarie de signals matura de productie (@preact/signals-core).

