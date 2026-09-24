# Securitate — Raptor

Starea curentă a modelului de securitate și a tuturor findingurilor, vechi și
noi. Ultima revizuire: **2026-09-24**.

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
| **RaptorWire** (`wire-core`, `server`, `wire-client`) | starea locală față de un peer de pe fir | auditată de două ori; transportul WebSocket e mai nou decât prima trecere |
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
| 3 | Clientul nu era fail-closed la frame-uri corupte | Scăzută | ✅ reparat 2026-09-21 | ⚠️ **niciuna** — `wire-client` nu are teste |
| S1 | `process.spawn`: `env` și `cwd` treceau pe lângă broker → execuție de cod arbitrar | **Ridicată** | ✅ reparat 2026-09-24 | `runtime/tests/escapes.test.ts` |
| S2 | `net.fetch` nu re-verifica destinația după redirect → SSRF | **Ridicată** | ✅ reparat 2026-09-24 | `runtime/tests/escapes.test.ts` |
| S3 | Dev-server RaptorBundle: prefix fără delimitator + bind pe toate interfețele | Medie | ✅ reparat 2026-09-24 | `bundle/tests/dev-server-scope.test.ts` |
| S4 | `serve` deschidea porturi fără capability, în TS și în Rust | Medie | ✅ reparat 2026-09-24 | `runtime/tests/escapes.test.ts`, `modules.rs` |
| S5 | Ocolul prin `node:` era raportat doar de `doctor`, nu și de `run` | Medie | ✅ reparat 2026-09-24 | `runtime-cli/tests/bypass.test.ts` |
| S6 | Containerea de căi e pur lexicală (symlink) | Medie | 📖 documentat, nereparat | — |
| S7 | WebSocket fără verificare de `Origin`, fără cotă de conexiuni | Scăzută-Medie | ⬜ deschis | — |
| S8 | `spawn`: buffere nemărginite, oprire fără escaladare | Scăzută | ✅ reparat 2026-09-24 | `runtime/tests/escapes.test.ts` |
| S9 | `plain()` din puntea de host e superficial | Scăzută | ⬜ deschis (teoretic) | — |
| S10 | `@raptor/wire-client` nu are niciun test | Scăzută | ⬜ deschis | — |

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

- **S1** — fiecare cheie din `options.env` trece prin `env.read`; variabilele
  care încarcă cod (`NODE_OPTIONS`, `LD_*`, `DYLD_*`, `BASH_ENV`,
  `GIT_SSH_COMMAND`, `PATH`, …) sunt refuzate **chiar și cu `env.read`
  acordată**, pentru că altfel „care comenzi" ar însemna „orice cod"; un `cwd`
  din afara proiectului cere `files.read` pe acea cale.
- **S2** — `redirect: "manual"` plus `broker.require` pe fiecare salt, cu limită
  de salturi. Clientul HTTP nativ nu urmărea redirect-uri deloc, deci era deja
  corect.
- **S3** — containere pe segmente (`resolveAsset`), decodarea căii, refuz pe
  fișiere ascunse și pe surse, `listen` implicit pe `127.0.0.1` cu `--host`
  pentru expunere explicită.
- **S4** — `net.listen` a intrat în vocabularul de capabilități, în TS și în
  Rust, cu ținta `gazdă:port` potrivită de aceeași funcție ca `net.connect`.
  Verificarea se face **înainte** de `bind`.
- **S5** — regula despre importurile `node:` stă acum într-un singur loc
  (`runtime-cli/src/bypass.ts`) și o folosesc și `doctor`, și `run`.
- **S8** — fluxurile copilului sunt plafonate la 8 MB, cu `truncated` în
  rezultat; `abort` escaladează la SIGKILL după 2 s.

## Ce rămâne deschis

**S6 — symlink.** `packages/runtime/src/paths.ts` și `crates/.../paths.rs`
rezolvă căile **lexical**, fără `realpath`. Un symlink aflat în domeniul acordat
duce accesul în afara lui. Partea Rust documenta deja asta; acum o documentează
și partea TS. Reparația reală cere `realpath` pe directorul-părinte, cu grija
TOCTOU care vine la pachet.

**S7 — WebSocket.** `serveOverWebSocket` verifică doar calea și prezența
`sec-websocket-key`. Fără verificare de `Origin`, orice pagină pe care o deschide
utilizatorul poate deschide o conexiune la un server Raptor. Nu există nici
limită de conexiuni simultane, nici timeout de handshake.

Restul parser-ului RFC 6455 e solid: mască obligatorie, plafoane de 16 MB pe
cadru și pe mesajul reasamblat, opcode necunoscut → închidere.

**S9 — `plain()`.** `packages/host/src/protocol.ts` curăță
`__proto__`/`constructor`/`prototype` doar la primul nivel. Nu există azi un
consumator care să transforme asta într-o problemă; merită totuși recursivitate.

**S10 — `wire-client` fără teste.** Singurul pachet fără director `tests/`, și
tocmai cel care aplică operații venite de pe rețea pe starea locală. Consecință
directă: fixul #3 nu are regresie.

## Limite asumate, nu bug-uri

- **Fără TLS**, nicăieri: nici în transportul RaptorWire, nici în clientul HTTP
  nativ (unde `https://` trece de verificarea de capabilitate și apoi **eșuează
  limpede**, în loc să coboare tăcut la `http`). Terminarea TLS se face în față.
- **Fără rate limiting sau cote de conexiuni.** Un client care se reconectează
  în buclă e problema aplicației.
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
