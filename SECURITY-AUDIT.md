# Audit de securitate și coding standards — Raptor

> **DEPĂȘIT (2026-09-24).** Acesta este instantaneul de la 21 septembrie, păstrat
> pentru istoric. Acoperea ~10 pachete; repo-ul are azi 24 + un runtime nativ în
> Rust. Trei afirmații din el **nu mai sunt adevărate**: „75/75 teste" (sunt 804),
> „typecheck curat" (7 erori) și „niciun acces `fs`/`child_process`/rețea în cod
> runtime" (9 pachete fac asta acum). Starea curentă, cu findinguri noi verificate
> cu proof-of-concept: [`AUDIT-2026-09-24.md`](AUDIT-2026-09-24.md).

Data: 2026-09-21 · Scope: pachetele și exemplele scrise în această sesiune
(`packages/*`, `examples/*`). `benchmarks/` este un proiect izolat dev-only,
adăugat separat — scanat superficial, în afara scope-ului principal.

## Rezumat

| # | Finding | Severitate | Status |
|---|---|---|---|
| 1 | Prototype pollution la decodarea datelor de pe fir (CWE-1321) | Medie | ✅ Reparat |
| 2 | Prefix matching fără delimitator → expunere de handle-uri vecine | Medie | ✅ Reparat |
| 3 | Clientul nu era fail-closed la frame-uri corupte | Scăzută | ✅ Reparat |

Nu s-au găsit: execuție dinamică de cod (`eval`/`Function`), acces `fs`/`child_process`/
rețea în cod runtime, secrete hardcodate, dependențe runtime (zero-dep confirmat),
bucle nemărginite (toate au bound: buffer, `maxDepth`, `maxSteps`).

Verificare: **75/75 teste** (`pnpm test`, include 5 teste de regresie de securitate),
**typecheck curat** (`pnpm typecheck`), toate demo-urile rulează.

## Findings detaliate

### 1. Prototype pollution la decodare (CWE-1321) — Medie

**Unde:** `wire-core/value.ts` (`readValue` OBJECT), `wire-core/operation.ts`
(`decodeOp` PATCH), `wire-core/document.ts` (`apply` SET/INC/PATCH),
`test/twin.ts` (`VirtualDB.update`).

**Problemă:** o cheie `__proto__` provenită din date de pe fir era scrisă cu
`obj[key] = value`, invocând setter-ul de prototip. Un peer malițios putea muta
prototipul obiectului decodat / al unei înregistrări din starea clientului și
corupe integritatea valorii. `Object.prototype` global **nu** era poluat (scope
limitat), dar suprafața e reală la stratul care aplică operații netăgăduite pe
starea locală.

**Fix:** helper `setOwn()` (`wire-core/safe.ts`) care folosește
`Object.defineProperty` → scrie mereu o proprietate **proprie**, neutralizează
setter-ul și păstrează round-trip-ul corect. `VirtualDB.update` nu mai folosește
`Object.assign`. Regresie: `wire-core/tests/security.test.ts`.

### 2. Prefix matching fără delimitator — Medie

**Unde:** `server/store.ts` (`matches`, folosit de `snapshotFor` și `resyncSince`).

**Problemă:** proiecția unui query folosea `handle.startsWith(prefix)` fără
graniță, deci un query autorizat pe `"cpu"` expunea și `"cpuSecret"` / `"cpu2"`
(scurgere de date către un subscriber neautorizat pentru acele handle-uri).

**Fix:** un prefix expune copii doar dacă se termină cu delimitator (`:`, `/`,
`.`); altfel se cere potrivire exactă. Regresie: `server/tests/store.test.ts`.

### 3. Client nu era fail-closed la frame-uri corupte — Scăzută

**Unde:** `wire-client/client.ts` (`bindTransport`).

**Problemă:** serverul prindea erorile de decodare, dar clientul nu — un frame
invalid/corupt arunca o excepție necontrolată în microtask.

**Fix:** decodarea pe client e într-un `try/catch` care ignoră frame-ul invalid
(fail-closed, conform whitepaper §21 „state machine fail-closed pentru mesaje
imposibile").

## Coding standards — verificat

- **Zero dependențe runtime**: confirmat; `typescript`/`@types/node` sunt doar dev (typecheck + transformul de build al `@raptor/bundle`). Vite/esbuild au fost eliminate — varianta browser folosește bundler-ul propriu `@raptor/bundle`.
- **Sintaxă TS erasabilă** (fără `enum`/`namespace`-runtime/parameter properties): respectată; `pnpm typecheck` cu `erasableSyntaxOnly` trece.
- **Cod mort eliminat**: `scheduleFlush()` (no-op) scos din nucleul reactiv.
- **`for...in` → `Object.keys`** în `dom/runtime.ts` (evită proprietăți moștenite).
- **Determinism** (cerință RaptorTest): nucleul nu folosește `Math.random`/wall-clock; `Math.random` apare doar în demo-ul de UI din browser.
- **Bounds / DoS**: `Reader` verifică limitele bufferului; `varint` respinge valori negative/prea mari; `VirtualClock.runUntilIdle` are `maxSteps`; explorarea RaptorTest e mărginită de `maxDepth`.
- **Autorizare**: hook-uri `authorize` per query/mutation pe server; clientul nu poate injecta operații la alți clienți (ops sunt doar server→client).

## Limitări cunoscute (documentate, nu blocante pentru MVP)

- RAS este session-scoped per conexiune; la reconnect address space-ul se renegociază (starea se păstrează). Formatul exact al ID-urilor rămâne de ales după benchmark (whitepaper §5.2).
- `onMount` folosește o coadă la nivel de modul — corectă în modelul sincron de montare; un runtime concurent ar cere ownership per-render.
- Codec-ul generic de valori nu impune o schemă; `SchemaCodec` (adaptive encoding) e opțional. O validare strictă pe schemă ar respinge din start câmpuri rezervate.
