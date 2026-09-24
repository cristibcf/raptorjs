# Securitate — Raptor

Starea curentă a modelului de securitate și a tuturor findingurilor. Două
runde de audit, **18 findinguri**, toate închise. Ultima revizuire:
**2026-09-24 (runda 2)**.

Rapoartele de audit, cu metoda și proof-of-concept-urile:

- [`AUDIT-2026-09-24.md`](AUDIT-2026-09-24.md) — audit complet (cod, documentație,
  conținut de site, runtime nativ). 24 de pachete + crate-ul Rust.
- Auditul din 2026-09-21 acoperea ~10 pachete. Findingurile lui sunt în tabelul
  de mai jos (#1–#3); restul documentului a fost absorbit aici.

## Suprafețele de securitate, pe scurt

Proiectul are **trei** granițe distincte. Se confundă ușor, și fiecare are alt
nivel de maturitate.

| Graniță | Ce apără | Stare |
|---|---|---|
| **RaptorWire** (`wire-core`, `server`, `wire-client`) | starea locală față de un peer de pe fir | auditată de două ori; transportul WebSocket verifică `Origin` din 2026-09-24 |
| **Capability broker** (`runtime`, `runtime-cli`) | sistemul gazdă față de codul aplicației | auditată 2026-09-24; **pe motorul de bootstrap e consultativă**, vezi mai jos |
| **Puntea de host** (`host` + cele șase adaptoare) | sistemul de operare față de aplicație | contract + verificare dublă; în browser dă portabilitate, nu izolare |

### Precizarea care nu trebuie pierdută

Pe **motorul de bootstrap** (Node), capability broker-ul este **consultativ, nu
o graniță**. Codul de aplicație poate scrie `import fs from "node:fs"` și ajunge
la disc fără ca brokerul să fie întrebat. Granița reală apartine host-ului nativ
în Rust, unde `node:*` pur și simplu nu există.

Până atunci apărarea stă în unelte, nu în motor:
`raptor-runtime doctor` raportează fiecare ocol, iar `raptor-runtime run`
**refuză să pornească** în politica `production` și scrie ocolul în jurnalul de
audit în `development` (`packages/runtime-cli/src/bypass.ts`).

## Findinguri

| # | Finding | Severitate | Stare | Regresie |
|---|---|---|---|---|
| 1 | Prototype pollution la decodarea datelor de pe fir (CWE-1321) | Medie | ✅ reparat 2026-09-21 | `wire-core/tests/security.test.ts` |
| 2 | Prefix matching fără delimitator → expunere de handle-uri vecine | Medie | ✅ reparat 2026-09-21 | `server/tests/store.test.ts` |
| 3 | Clientul nu era fail-closed la frame-uri corupte | Scăzută | ✅ reparat 2026-09-21 | `wire-client/tests/client.test.ts` (adăugată 2026-09-24) |
| S1 | `process.spawn`: `env` și `cwd` treceau pe lângă broker → execuție de cod arbitrar | **Ridicată** | ✅ reparat 2026-09-24 | `runtime/tests/escapes.test.ts` |
| S2 | `net.fetch` nu re-verifica destinația după redirect → SSRF | **Ridicată** | ✅ reparat 2026-09-24 | `runtime/tests/escapes.test.ts` |
| S3 | Dev-server RaptorBundle: prefix fără delimitator + bind pe toate interfețele | Medie | ✅ reparat 2026-09-24 | `bundle/tests/dev-server-scope.test.ts` |
| S4 | `serve` deschidea porturi fără capability, în TS și în Rust | Medie | ✅ reparat 2026-09-24 | `runtime/tests/escapes.test.ts`, `modules.rs` |
| S5 | Ocolul prin `node:` era raportat doar de `doctor`, nu și de `run` | Medie | ✅ reparat 2026-09-24 | `runtime-cli/tests/bypass.test.ts` |
| S6 | Containerea de căi e pur lexicală (symlink) | Medie | ✅ reparat 2026-09-24 | `runtime/tests/symlinks.test.ts`, `paths.rs`, `capabilities.rs` |
| S7 | WebSocket fără verificare de `Origin`, fără cotă de conexiuni | Scăzută-Medie | ✅ reparat 2026-09-24 | `server/tests/websocket-origin.test.ts` |
| S8 | `spawn`: buffere nemărginite, oprire fără escaladare | Scăzută | ✅ reparat 2026-09-24 | `runtime/tests/escapes.test.ts` |
| S9 | `plain()` din puntea de host e superficial | Scăzută | ✅ reparat 2026-09-24 | `host/tests/bridge.test.ts` |
| S10 | `@raptor/wire-client` nu are niciun test | Scăzută | ✅ reparat 2026-09-24 | 11 teste în `wire-client/tests/client.test.ts` |
| R1 | Gate-ul anti-ocol se evită cu un `import()` calculat | **Ridicată** | ✅ reparat (runda 2) | `runtime-cli/tests/bypass.test.ts` |
| R2 | Verificarea ocolurilor era fail-open când graful nu se putea construi | Medie | ✅ reparat (runda 2) | `runtime-cli/tests/bypass.test.ts` |
| R3 | Lista de variabile care încarcă cod era incompletă; a apărut `env.set` | Medie | ✅ reparat (runda 2) | `runtime/tests/escapes.test.ts` |
| R4 | `Authorization` / `Cookie` treceau la altă gazdă după un redirect | Medie | ✅ reparat (runda 2) | `runtime/tests/escapes.test.ts` |
| R5 | `sanitize` recursiv fără limită de adâncime | Scăzută | ✅ reparat (runda 2) | `host/tests/bridge.test.ts` |

### Cele trei findinguri din 2026-09-21

**#1 — Prototype pollution la decodare.** O cheie `__proto__` venită de pe fir
era scrisă cu `obj[key] = value`, invocând setter-ul de prototip. Fix: helper
`setOwn()` (`wire-core/safe.ts`) prin `Object.defineProperty` — scrie mereu o
proprietate proprie.

**#2 — Prefix matching fără delimitator.** `handle.startsWith(prefix)` fără
graniță: un query autorizat pe `"cpu"` expunea și `"cpuSecret"`. Fix: un prefix
expune copii doar dacă se termină cu delimitator (`:`, `/`, `.`).

**#3 — Client nu era fail-closed.** Un frame invalid arunca o excepție
necontrolată în microtask. Fix: `try/catch` în `bindTransport`.

### Findingurile din 2026-09-24

Descrierea completă, cu proof-of-concept-ul fiecăruia, e în
[`AUDIT-2026-09-24.md`](AUDIT-2026-09-24.md) §1. Pe scurt, ce s-a schimbat în cod:

- **S1 + R3** — a seta mediul unui copil cere capabilitatea **`env.set`**,
  separată de `env.read` și implicit goală: a citi o variabilă îți spune ceva,
  a o seta pentru un copil poate schimba ce cod rulează acel copil. Peste ea,
  un blocklist de variabile care încarcă cod (`NODE_OPTIONS`, `NODE_PATH`,
  `LD_*`, `DYLD_*`, `JAVA_TOOL_OPTIONS`, `CLASSPATH`, `RUBYOPT`, `PYTHON*`,
  `BASH_ENV`, `GIT_SSH_COMMAND`, `PATH`, …) refuzate **chiar și cu `env.set`
  acordată**. Un `cwd` din afara proiectului cere `files.read` pe acea cale.
- **S2 + R4** — `redirect: "manual"` plus `broker.require` pe fiecare salt, cu
  limită de salturi; iar la un salt către altă destinație pleacă fără
  `Authorization`, `Cookie` și `Proxy-Authorization`. Clientul HTTP nativ nu
  urmărea redirect-uri deloc, deci era deja corect.
- **S3** — containere pe segmente (`resolveAsset`), decodarea căii, refuz pe
  fișiere ascunse și pe surse, `listen` implicit pe `127.0.0.1` cu `--host`
  pentru expunere explicită.
- **S4** — `net.listen` a intrat în vocabularul de capabilități, în TS și în
  Rust, cu ținta `gazdă:port` potrivită de aceeași funcție ca `net.connect`.
  Verificarea se face **înainte** de `bind`.
- **S5 + R1 + R2** — regula stă într-un singur loc (`runtime-cli/src/bypass.ts`)
  și o folosesc și `doctor`, și `run`. Contractul ei nu e „lista de ocoluri", ci
  *ce știu* și *ce nu pot ști*: un `import()` cu specificator calculat, sau un
  graf care nu poate fi construit, înseamnă **absența unei dovezi**, iar în
  regim strict absența dovezii nu e suficientă.
- **S8** — fluxurile copilului sunt plafonate la 8 MB, cu `truncated` în
  rezultat; `abort` escaladează la SIGKILL după 2 s.

## Ce rămâne deschis

**Niciun finding de securitate.** Toate cele 18 sunt închise, fiecare cu un test
de regresie.

Două probleme de **calitate** rămân deschise, numite în
[`AUDIT-2026-09-24.md`](AUDIT-2026-09-24.md): `@raptor/test` e cel mai puțin
testat pachet din repo (R9), iar `parseCapsule` validează două câmpuri dintr-un
format proiectat ca artefact partajabil (R10).
Ce rămâne sunt limitele asumate de mai jos — care sunt alegeri, nu scăpări — și
o cursă pe care nici S6 nu o închide complet, descrisă imediat.

### Lecția rundei a doua

A doua trecere a căutat anume în **reparațiile primei**, și a găsit cinci
findinguri acolo — inclusiv unul (R1) care ocolea aproape complet o reparație
proaspătă. O reparație este o afirmație despre cod; afirmațiile se auditează la
rândul lor. Trei dintre cele cinci erau în cod scris cu o zi înainte.

### S6 — symlink, și ce anume s-a închis

`packages/runtime/src/paths.ts` și `crates/.../paths.rs` au acum **două**
niveluri, cu aceleași nume de ambele părți:

- `containsPath` — pur lexical, nu atinge discul. Pentru diagnostice și teste,
  unde răspunsul nu trebuie să depindă de ce există pe disc.
- `realPath` / `containsPathReal` — rezolvă legăturile. Astea le folosește
  brokerul.

`realPath` funcționează și pentru o cale care **nu există încă** — necesar,
fiindcă `files.write` decide despre un fișier care urmează să fie creat: urcă la
cel mai adânc părinte care chiar există, îl rezolvă, și lipește înapoi
segmentele rămase. O scriere în `./date/link/nou.txt` ajunge astfel unde ajunge
și `open`: prin link, nu pe lângă el.

Domeniul se rezolvă și el, nu doar ținta — altfel pe macOS, unde `/tmp` este un
link către `/private/tmp`, accesul în propriul director ar fi refuzat.

Un refuz poartă acum și `resolved`: **unde ajungea de fapt calea**, când diferă
de cea cerută. Un jurnal care arată doar `./date/spre-parola` și nu și
`/tmp/secrete/parola.txt` spune adevărul și totuși induce în eroare.

**Ce NU se închide: cursa TOCTOU.** Între verificare și `open`-ul propriu-zis,
cine poate scrie în domeniu poate înlocui un director cu o legătură. Închiderea
completă cere `openat2(RESOLVE_BENEATH)` pe Linux sau echivalentul lui, la care
Node nu dă acces. Ce s-a închis este cazul real: un link **deja prezent** în
domeniu nu mai scoate accesul afară.

Testele construiesc legături reale pe disc. Pe Windows un symlink obișnuit cere
Developer Mode, dar o **joncțiune** de director nu cere nimic și e rezolvată de
`realpath` la fel — deci cazul principal se verifică peste tot, iar cel cu
legătură către un fișier se sare cu motivul scris când nu se poate construi.

### Cum s-au închis celelalte

**S7 — WebSocket.** `serveOverWebSocket` verifică acum `Origin` înainte de
`101`, implicit **doar same-origin** (autoritatea din `Origin` comparată cu
`Host`, nu șirul). O listă explicită de origini o înlocuiește; `"any"`
dezactivează verificarea, scris în litere ca să nu se întâmple din neatenție. O
cerere fără `Origin` trece — nu vine dintr-un browser, deci nu poartă autoritate
ambientală. Plus un plafon de conexiuni (implicit 1024) care răspunde 503 în loc
să atârne.

Restul parser-ului RFC 6455 era deja solid: mască obligatorie, plafoane de 16 MB
pe cadru și pe mesajul reasamblat, opcode necunoscut → închidere.

**S9 — `plain()`** curăță acum recursiv, inclusiv prin array-uri. Testul verifică
nu doar că cheile au dispărut, ci și că un `Object.assign({}, …)` peste oricare
sub-obiect nu atinge prototipul — care era mecanismul real de exploatare.

**S10 — `wire-client`** are 11 teste, scrise peste un server fals care poate
trimite și ce un server cinstit n-ar trimite niciodată. Fixul #3 (fail-closed)
are în sfârșit o regresie, iar testul verifică și că sesiunea rămâne utilizabilă
după un cadru aruncat.

## Limite asumate, nu bug-uri

- **Fără TLS**, nicăieri: nici în transportul RaptorWire, nici în clientul HTTP
  nativ (unde `https://` trece de verificarea de capabilitate și apoi **eșuează
  limpede**, în loc să coboare tăcut la `http`). Terminarea TLS se face în față.
- **Fără rate limiting.** Există un plafon de conexiuni simultane pe WebSocket
  (implicit 1024), dar nicio limită de rată: un client care se reconectează în
  buclă rămâne problema aplicației.
- **Fără validare de schemă la decodare.** `SchemaCodec` e opțional; codec-ul
  generic acceptă orice formă, deci o mutație trebuie să-și valideze intrarea.
- **`@raptor/ui` nu a fost revizuit pentru injecție prin props.** Singurul sink
  de HTML din bibliotecă este `RichTextEditor`, care **nu sanitizează** și o
  spune atât în sursă cât și pe pagina lui din catalog.
- **RAS e session-scoped**; formatul exact al identificatorilor rămâne deschis.
- **Fără penetration testing.**

## Standarde verificate (2026-09-24)

- **Zero dependențe runtime externe** — măsurat, nu afirmat: `pnpm stats`
  numără dependențele non-`@raptor/*` ale pachetelor publicate și dă 0.
  `typescript`/`@types/node` sunt devDependencies.
- **Fără `eval` sau constructor `Function` în `packages/*/src`.** Apar doar în
  teste și în Playground-ul site-ului, care rulează deliberat codul scris de
  vizitator, în pagina lui.
- **Acces la sistem, unde este:** 9 din 24 de pachete importă
  `node:fs`/`http`/`net`/`child_process` — `bundle`, `engine`, `forge`,
  `profile`, `run`, `runtime`, `runtime-cli`, `server`, `service-host`. Sunt
  unelte de build și runtime-uri, nu biblioteci de aplicație; nucleul reactiv și
  stratul wire nu ating sistemul.
- **Fără secrete în cod.**
- **Determinism:** nucleul reactiv nu folosește `Math.random` sau ceas de perete
   — ceea ce face posibil replay-ul din RaptorTest.
- **Margini:** `Reader` verifică limitele bufferului, `varint` respinge valori
  prea mari, cadrele WebSocket sunt plafonate la 16 MB, `VirtualClock` are
  `maxSteps`, explorarea RaptorTest are `maxDepth`, iar fluxurile unui proces
  copil sunt plafonate la 8 MB.
- **Autorizare:** hook-uri `authorize` per query/mutation; operațiile merg doar
  server → client, deci un client nu poate injecta stare în replica altuia.
