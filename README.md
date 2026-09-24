# RaptorJS + RaptorWire + RaptorTest + RaptorEngine

Implementare MVP a ecosistemului Raptor descris în whitepaper-urile din [`design/`](design/).
Patru piloni: **execuție**, **comunicare**, **verificare**, **compilare/build**.

- **RaptorJS** — framework/compiler TypeScript compiler-centric cu **reactivitate fine-grained** (signals): o schimbare de stare propagă direct către binding-ul DOM afectat, fără Virtual DOM și fără re-render de componentă. *(execuție)*
- **RaptorWire** — protocol binar **state-aware**: după snapshot-ul inițial, rețeaua transportă **operații semantice** (`SET`, `INC`, `APPEND`, `PATCH`, `MOVE`, ...) peste o stare de bază cunoscută, nu documente re-serializate. *(comunicare)*
- **RaptorTest** — testare comportamentală **autonomă** + backend digital twin: descoperă singur comportamentul aplicației, sintetizează un backend fals stateful și explorează spațiul de stări (observe → infer → synthesize → explore → verify → replay). *(verificare)*
- **RaptorEngine** — platforma **semantic-aware** de build/dev/runtime: parsează `.raptor` într-un **Raptor IR** cu stable IDs, construiește **Semantic Application Graph** și optimizează pe el (Dead Signal Elimination, Dependency Fusion), generează **browser + server + wire dintr-un singur graf**, cu **Stateful Reactive HMR** (patch state-preserving) și caching reproductibil. *(compilare/build)*

> Teza (whitepaper §1): avantajul nu vine dintr-un truc de performanță, ci din **eliminarea muncii redundante** dintre compiler, runtime, serializare, cache și UI — pentru că fiecare strat cunoaște aceeași schemă și același graf de stare.

Direcția v0.2: **reactive end-to-end** — `DB → reactive query → server signal → RaptorWire op → client signal → binding DOM`.

## Rulează acum (zero build, zero dependențe runtime)

Totul rulează direct pe **Node ≥ 22** (TypeScript nativ prin type-stripping). Nu e nevoie de bundler pentru demo-uri sau teste.

```bash
pnpm install          # doar leagă workspace-ul (+ devDeps opționale)
pnpm test             # 861 de teste (859 pass; 2 sărite)
pnpm typecheck        # tsc --noEmit pe tot

pnpm demo:counter     # bindings DOM fine-grained (headless)
pnpm demo:dashboard   # MVP end-to-end: server ↔ RaptorWire ↔ client ↔ DOM
pnpm demo:chat        # stare partajată între 2 clienți (APPEND/PATCH/REMOVE)
pnpm demo:raptortest  # descoperă autonom bug-uri (stale-read RT-184 + fault)
pnpm demo:engine      # RaptorEngine: .raptor → IR → optimize → codegen → HMR
pnpm demo:run         # RaptorRun: SSR + server signal ↔ RaptorWire ↔ client reactiv
pnpm demo:profile     # RaptorProfile: telemetrie → plan PGO → rebuild profile-guided
pnpm demo:desktop     # o aplicație RaptorJS într-un host desktop nativ (punte de capabilități)
pnpm demo:mobile      # aceeași aplicație într-un host mobil: navigarea vine de la adaptor
pnpm demo:web-host    # aceeași aplicație cu browserul pe post de host (headless)
pnpm demo:service     # aceeași aplicație ca serviciu HTTP: sockeți, config, drenare la SIGTERM
pnpm demo:cli         # aceeași aplicație ca unealtă CLI: argv, TTY, confirmări, coduri de ieșire
pnpm demo:device      # pe o plachetă: pini și magistrale declarate, somn, watchdog care resetează
```

CLI-ul `raptor` (whitepaper RaptorEngine §5, Appendix A):

```bash
pnpm raptor build   examples/raptorengine-app/src/App.raptor --report
pnpm raptor inspect graph examples/raptorengine-app/src/App.raptor
pnpm raptor analyze examples/raptorengine-app/src/App.raptor
pnpm raptor:run info examples/raptorengine-app/src/App.raptor    # RaptorRun (server runtime)
pnpm raptor:run ssr  examples/raptorengine-app/src/App.raptor    # SSR HTML
pnpm raptor toolchain                                            # detectează Rolldown/Oxc
pnpm raptor:dev examples/raptorengine-app/src/App.raptor         # server live: fs.watch → HMR (SSE)
```

**RaptorRuntime** — runtime de aplicație cu capabilități declarate, și un binar nativ care rulează
JavaScript și TypeScript **fără Node instalat**:

```bash
pnpm raptor:runtime init exemplu-app      # proiect nou cu raptor.runtime.json
pnpm raptor:runtime doctor                # manifest, politici, graf static, ocoluri de broker
pnpm raptor:runtime run                   # rulează cu capabilitățile declarate
pnpm raptor:runtime pack                  # unitate reproductibilă cu lockfile

pnpm native -- build --features full      # binarul Rust (prin WSL, vezi nota de mediu)
pnpm native:test                          # testele Rust (implicit si cu toate feature-urile)
```

Ce refuză, concret: cu `files.read: ["./src"]` în manifest, o citire din `./src` reușește, iar una
din `../../package.json` primește `raptor:capability/denied` — deși fișierul există pe disc.
Cu `--policy production`, un `import` de `node:fs` **oprește pornirea**, pentru că pe motorul de
bootstrap ar ocoli brokerul cu totul (vezi [SECURITY-AUDIT.md](SECURITY-AUDIT.md)).

Proiecte noi, pentru web și pentru host-uri native (vezi [`docs/NATIVE-HOSTS.md`](docs/NATIVE-HOSTS.md)):

```bash
pnpm raptor:create targets                                       # web, desktop, mobile
pnpm raptor:create "Notes Desk" --target desktop --bundle-id com.exemplu.notite
```

Engine-ul low-level **Rolldown/Oxc** este opțional (whitepaper §37 „progressive ownership"): nu e
dependență de workspace, se detectează dinamic la runtime, iar fără el build-ul cade grațios pe
engine-ul naiv zero-dep. Integrarea reală (izolată, ca `benchmarks/`) se verifică cu:

```bash
cd integrations/rolldown && npm install && npm run verify
# semantic RaptorEngine → Rolldown bundle → Oxc minify (ex. 955B naiv → 463B minificat)
```

Exemplu de ieșire din `demo:dashboard` (cifre **măsurate din run**, nu marketing — whitepaper P8 / §25.2):

```
tick 1: RaptorWire 39B  |  JSON full-resend 123B
...
Reducere: 68.3%
reconnect: 0 snapshot-uri noi, cpu recuperat prin delta   (automatic delta resync)
Nume de field repetate pe hot path: 0 (Reactive Address Space)
```

### Variante browser (TSX, prin RaptorBundle — fără Vite)

`examples/counter` și `examples/realtime-dashboard` au și o variantă `.tsx` care folosește
API-ul developerului din whitepaper §9 (JSX + `on:click` + `{signal}`), compilată de
**RaptorBundle**, bundler-ul propriu zero-dep (nu Vite/esbuild):

```bash
pnpm dev:counter      # sau: cd examples/counter && pnpm dev  (live-reload, :5173)
pnpm dev:dashboard    # dashboard realtime în browser
pnpm dev:web-shell    # web-shell in browser real: History API, localStorage, notificări
cd examples/counter && pnpm build   # emite dist/bundle.js + dist/index.html (static)
```

## Arhitectură (monorepo)

| Pachet | Rol | Whitepaper |
|---|---|---|
| [`@raptor/core`](packages/core) | Reactivitate: `state`, `derived`, `effect`, `batch`, `untracked`, ownership. Graf glitch-free, memo lazy, effects eager. | §6, §7 |
| [`@raptor/dom`](packages/dom) | Runtime DOM fine-grained + **jsx-runtime** (output-ul compilerului). `For` keyed, `Show`, builder hyperscript `R` (același runtime, fără build step). Include un mini-DOM headless pentru teste. | §6, §9 |
| [`@raptor/ui`](packages/ui) | Bibliotecă de componente peste bindingurile fine-grained. Roadmap-ul de 200 e la **198 implementate** (rămân `PdfViewer` și `Map`, care nu se pot face onest zero-dependency); catalogul site-ului are **211 de intrări în catalog** (componente, primitive și rețete documentate). Layout si tipografie, formular complet, overlay, date (`DataGrid` virtualizat, `TreeView`, `Kanban`), navigare, fisiere, **15 tipuri de grafic**, editoare (RichText/Code/JSON/Diff), media (playere, `Lightbox`, `QRCode` cu generator ISO 18004 propriu) si 19 primitive headless. Componentele-cheie vin cu teste care numara mutatiile DOM. Stiluri separate, zero dependențe, **36 de puncte de intrare**. Vezi [ROADMAP](packages/ui/ROADMAP.md). | §6, §9 |
| [`@raptor/bundle`](packages/bundle) | **RaptorBundle**: bundler TSX/ESM propriu (zero-dep runtime). JSX → `@raptor/dom`, rezolvă graful, **tree-shaking pe sursa ESM** (un `Button` din barrel: 58 module → 9), emite un `bundle.js`; dev server cu live-reload. Înlocuiește Vite/esbuild. | §9 |
| [`@raptor/wire-codec`](packages/wire-codec) | Primitive codec: varint, zig-zag, float64, string/bytes length-prefixed. | §12 |
| [`@raptor/wire-core`](packages/wire-core) | Opcodes, `Document` versionat, snapshot, protocol de mesaje, **Reactive Address Space**, **adaptive encoding**. | §11–14, §31 |
| [`@raptor/server`](packages/server) | SDK server: store reactiv autoritativ, `query`/`mutation`/subscription, snapshot+delta, op-log pentru resync, server WebSocket propriu (`serveOverWebSocket`, RFC 6455). | §24 |
| [`@raptor/wire-client`](packages/wire-client) | Sesiune, replică reactivă (fiecare handle = un semnal), transporturi loopback și WebSocket (`connectWebSocket`), reconnect cu delta resync. | §14, §15, §17 |
| [`@raptor/test`](packages/test) | **RaptorTest**: VirtualClock, RaptorProbe, Semantic UI, Behavior Graph, RaptorTwin (backend digital twin), Explorer, Oracle, Chaos, Replay, Coverage. | RaptorTest §6–§21 |
| [`@raptor/compiler`](packages/compiler) | **RaptorEngine** (nucleu): parser `.raptor`, **Raptor IR** (Appendix C), Semantic Application Graph, graph diff pentru HMR. Independent de bundler. | RaptorEngine §6–§9, §11 |
| [`@raptor/engine`](packages/engine) | **RaptorEngine** (orchestrare): optimizer (DSE, Fusion), codegen browser/server/wire, Stateful Reactive HMR, caching reproductibil, build manifest, CLI `raptor`. | RaptorEngine §5, §13–§18, §21, §34 |
| [`@raptor/run`](packages/run) | **RaptorRun** (server runtime): leagă `serverSignal`→store reactiv→RaptorWire→client din același graf; routing + SSR/resume, sesiuni, observability, targets Node/memory. | RaptorEngine §19–§21 |
| [`@raptor/profile`](packages/profile) | **RaptorProfile** (PGO): telemetrie runtime (signal freq, derived fan-out, route co-usage, wire payload, DOM bursts) + build planner care emite hints de **strategie** (chunk folding, preload, batch, encoding), niciodată de corectitudine. | RaptorEngine §22–§24 |
| [`@raptor/runtime`](packages/runtime) | **RaptorRuntime** (nucleu): runtime de aplicație cu **capabilități ca funcție de produs**. Spațiul de nume `raptor:` (`files`, `net`, `serve`, `process`, `kv`, `observe`, `capabilities`, `tasks`), capability broker cu țintă per cale / `gazdă:port` / variabilă / comandă, revocare la runtime și delegare explicită, fabrică de task-uri cu deadline, observabilitate structurată, adaptor de motor. Pe motorul de bootstrap brokerul e **consultativ** — vezi [SECURITY-AUDIT](SECURITY-AUDIT.md). | RaptorRuntime §5–§7 |
| [`@raptor/runtime-cli`](packages/runtime-cli) | `raptor-runtime`: `init`, `run`, `doctor`, `test`, `pack` (unitate reproductibilă cu lockfile), `trace` (urmărire compatibilă OpenTelemetry). `doctor` și `run` raportează importurile care ocolesc brokerul, cu aceeași regulă. | RaptorRuntime §4, §8 |
| [`packages/runtime-native`](packages/runtime-native) | **Binarul nativ, în Rust**: rulează JavaScript **și TypeScript fără Node instalat**. Motor QuickJS în spatele unui `EngineAdapter` (`--features quickjs`), TypeScript transformat cu oxc (`--features typescript`), modulele `raptor:` ca funcții native, HTTP/1.1 propriu peste `std::net` (client + server). Build implicit **zero dependențe** (964 KB); complet 4,4 MB. Vezi [nota de mediu](#note). | RaptorRuntime §3, §13 |
| [`@raptor/host`](packages/host) | Contractul comun al host-urilor native: matricea de capabilități, manifestul `raptor.host.json`, puntea JS↔host (cereri corelate + evenimente), mașina de lifecycle și planul de împachetare. Fără cod de platformă. | Roadmap §6 |
| [`@raptor/desktop`](packages/desktop) | **Raptor Desktop Adapter**: back-end-uri WebView (WebView2 / WKWebView / WebKitGTK), ferestre, meniuri, deep links, notificări, stocare locală, actualizări și semnare; host de referință + formate de instalator (msi, nsis, dmg, deb, AppImage). | Roadmap §6–§8 |
| [`@raptor/mobile`](packages/mobile) | **Raptor Mobile Adapter**: bridge minimal Android/iOS — navigare controlată de adaptor, stocare securizată (Keychain / EncryptedSharedPreferences), lifecycle, deep links; module native opționale, fiecare cu capabilitatea lui. | Roadmap §6–§8 |
| [`@raptor/web-host`](packages/web-host) | Browserul ca host Raptor: același contract peste History API, `localStorage`, Notification și Geolocation, ca aceeași aplicație să ruleze nemodificată pe toate trei țintele. Aici puntea dă **portabilitate, nu izolare**. | Roadmap §4 |
| [`@raptor/service-host`](packages/service-host) | Supervizorul de proces ca host: sockeți de ascultare (aplicația nu deschide porturi), configurație și secrete, semnal de sănătate și **drenare** la SIGTERM — rândul „Servicii platformă" din etapa 3. | Roadmap §3 |
| [`@raptor/cli-host`](packages/cli-host) | Terminalul ca host: argumente, fluxuri, lățime și culoare, Ctrl-C și cod de ieșire. Fără terminal interactiv, o confirmare este **refuzată, nu presupusă**. | Roadmap §4 |
| [`@raptor/device-host`](packages/device-host) | Firmware-ul unei plachete ca host: pini și magistrale declarate *per instanță*, somn profund, OTA cu rollback și un **watchdog** care resetează aplicația blocată. Singurul host care nu are încredere în aplicație. | derivat |
| [`@raptor/forge`](packages/forge) | **RaptorForge**: `raptor-create` pentru web/desktop/mobile — generează `raptor.runtime.json` valid, granița nativă `raptor.host.json`, descriptorul de împachetare și workflow-ul de instalatoare, toate din aceeași sursă. | Roadmap §5, §8 |

Exemple: [`counter`](examples/counter), [`realtime-dashboard`](examples/realtime-dashboard) (MVP headline), [`chat`](examples/chat), [`raptortest-crud`](examples/raptortest-crud) (descoperire autonomă de bug-uri), [`raptorengine-app`](examples/raptorengine-app) (compilare end-to-end: `.raptor` → cod care rulează pe runtime-ul real), [`site`](examples/site) (**site de prezentare + documentație construit CU stack-ul Raptor**: UI RaptorJS, demo realtime RaptorWire în pagină, compilat cu RaptorBundle — `pnpm dev:site`), [`desktop-shell`](examples/desktop-shell) (**o aplicație RaptorJS care rulează într-un host desktop nativ**: fereastră, meniu, stocare locală, deep links și notificări, toate prin puntea de capabilități — `pnpm demo:desktop`), [`mobile-shell`](examples/mobile-shell) (**aceeași aplicație, host mobil**: navigare condusă de adaptor, stocare securizată, suspendare și reluare, module native opționale — `pnpm demo:mobile`), [`web-shell`](examples/web-shell) (**a treia oară aceeași aplicație, cu browserul pe post de host**: History API și butonul de back, `localStorage`, notificări cu permisiune — `pnpm dev:web-shell`), [`service-shell`](examples/service-shell) (**a patra oară, ca serviciu HTTP**: server real `node:http`, configurație de la supervizor, drenare curată — `pnpm demo:service`), [`cli-shell`](examples/cli-shell) (**a cincea oară, ca unealtă de linie de comanda**: `raptor-notes add/list/clear`, cu refuz de confirmare când nu există terminal — `pnpm demo:cli`), [`device-shell`](examples/device-shell) (**a șasea, pe o plachetă**: logger de senzor cu LED, I2C, somn între citiri și watchdog — `pnpm demo:device`), [`native-hello`](examples/native-hello) (**TypeScript rulat de binarul nativ**, fără Node și fără tsc: tipuri, generice, interfețe — plus dovada că refuzul de capabilitate chiar blochează un fișier care există), [`native-server`](examples/native-server) (**un server HTTP scris în TypeScript care răspunde la `curl` real**, pe binarul nativ).

> `@raptor/test` mapează structura de pachete din whitepaper-ul RaptorTest (§32: probe, semantic-ui, behavior-graph, twin-core, explorer, oracle, chaos, replay, coverage) într-un singur pachet, ca submodule.

## Ce demonstrează (mapat pe whitepaper)

**RaptorJS — fine-grained (§6):** un click actualizează **exact** un text-node; zero elemente
recreate, zero componente re-executate. `For` reutilizează nodurile la reordonare (mutări minime).
Verificat prin `mini-dom` care numără fiecare mutație (vezi `demo:counter` și testele dom).

**RaptorWire — state-aware (§13):** operații delta pe un `Document` versionat. Testul-teză arată
că un `INC` pe un field e de >10× mai mic decât re-serializarea obiectului ca JSON.

**MVP end-to-end (§28, M1–M8):** `realtime-dashboard` leagă totul: handshake → snapshot →
operații delta versionate → semnale client → binding DOM exact, cu măsurarea octeților.

**RaptorTest — verificare autonomă (RaptorTest §4, §28, §31):** `demo:raptortest` rulează ciclul
`observe → infer → synthesize → explore → verify → replay` peste o aplicație cart CRUD, **fără
teste scrise de mână**. Descoperă singur secvențe de acțiuni (BFS ghidat de coverage), sintetizează
un backend digital twin stateful, injectează scenarii de rețea (RaptorChaos) și verifică invariante
(RaptorOracle). Găsește autonom:
- **bug-ul stale-read RT-184** (Anexa A): `Add to cart` → navigare imediată → un `GET /cart` întârziat suprascrie UI-ul cu starea veche (UI arată 0, serverul are 1). Minimizat la 2 acțiuni, reprodus determinist dintr-o capsulă `.raptorcap`.
- un **bug de robustețe**: la `POST 500`, aplicația citește orbește `.count` dintr-un răspuns de eroare.

Totul e determinist prin **timp virtual** (`VirtualClock` = scheduler discret de evenimente): aceeași
capsulă produce identic aceeași execuție (whitepaper §14, §20).

### Nou în v0.2

| Feature | Unde | Whitepaper |
|---|---|---|
| **Reactive Address Space** — ID-uri compacte, session-scoped, pe hot path (numele de field trimis o singură dată) | `AddressBook`, `encodeOpsFrame`/`decodeOpsFrame` | §5.2, §5.3 |
| **Network transaction / single DOM commit** — batch atomic aplicat cu un singur commit UI | flag `atomic` pe `OpsBatch`, `batch()` pe client | §5.4, §16.1 |
| **Automatic delta resync** — reconnect fără full resend (op-log + `resume(sinceVersion)`) | `ReactiveStore.resyncSince`, `RaptorClient.resume` | §14.3 |
| **Adaptive encoding** — codec schema-aware (percentage→1B, money→scaled int, enum→index) | `SchemaCodec` | §13.2 |
| **Performance budgets** — verificate ca teste (0 field names repetate, 1 commit/frame atomic, 0 snapshot la reconnect eligibil) | `examples/realtime-dashboard/tests/v2.test.ts` | §25.2 |

### RaptorEngine (whitepaper separat: `RaptorEngine_Build_Runtime_Platform`)

Al patrulea pilon: platforma de build/dev/runtime care **deține semantica** aplicației, nu doar
modulele. Engine-ul low-level (bundling/minify) rămâne un adapter schimbabil în spatele unei
interfețe mici (§37 "progressive ownership") — în v0.1 e un engine naiv; teza e că optimizarea
valoroasă se face pe **graful semantic**, ceva ce un bundler generic nu poate face.

| Capabilitate | Unde | Whitepaper |
|---|---|---|
| **Raptor IR + stable IDs** — componenta descompusă în signals/deriveds/bindings/effects/wire, serializabilă pentru cache | `@raptor/compiler` `ir.ts`, `parser.ts`, `expr.ts` | §7, Appendix C |
| **Semantic Application Graph** — module→component→signal→derived→DOM binding, serverSignal→schema→RAS | `graph.ts` (`buildGraph`, liveness) | §8 |
| **Dead Signal Elimination** — elimină reactive fără drum spre un output observabil (nu doar variabile nefolosite textual) | `@raptor/engine` `optimize.ts` (`runDSE`) | §14.1 |
| **Dependency Fusion** — colapsează un derived cu consumator unic; **blocată la `@debug`** | `optimize.ts` (`fuseComponent`) | §14.2, §24 |
| **Codegen multi-target dintr-un graf** — browser (rulează pe `@raptor/core`+`@raptor/dom`), server producers, wire schema + RAS manifest | `codegen.ts` | §9, §15 |
| **Stateful Reactive HMR** — graph diff → patch state-preserving; fallback explicit la remount cu motiv | `@raptor/compiler` `diff.ts`, `@raptor/engine` `dev.ts` | §11, §12 |
| **Caching reproductibil** — cache key = source + compiler version + profile + target + schema compat | `cache.ts`, `manifest.ts` (Appendix B) | §21 |
| **Build profiles + chunking** — `realtime` izolează componentele cu server signals în chunk separat | `config.ts`, `build.ts` | §16, §18 |
| **Inspect/analyze** — dump graf, invalidation trace (blast radius), optimization trace | `inspect.ts`, CLI `raptor inspect/analyze` | §12, §27, §5 |
| **RaptorRun** — server runtime: `serverSignal`→store→RaptorWire→client, SSR/resume, sesiuni, observability, target Node HTTP real + memory | `@raptor/run` `runtime.ts`, `ssr.ts`, `router.ts`, `node.ts` | §19–§21 |
| **RaptorDev live server** — `fs.watch` → recompilare incrementală → diff → HMR push prin SSE + refresh SSR; client HMR care face swap pe `#raptor-root` | `@raptor/run` `dev-server.ts`, CLI `raptor:dev` | §10–§12 |
| **RaptorProfile** — telemetrie tehnică + build planner PGO; **adaptive strategies, nu adaptive correctness** (§24): ce nu apare în profil e păstrat, nu eliminat | `@raptor/profile` `collector.ts`, `scenario.ts`, `planner.ts` | §22–§24 |
| **Rolldown/Oxc** — engine low-level real prin seam-ul `LowLevelEngine` (bundle + tree-shake + minify), detectat dinamic, opțional, fallback naiv zero-dep | `@raptor/engine` `lowlevel.ts`, `buildModuleAsync`, `integrations/rolldown` | §2, §37 |

**Demonstrat end-to-end** (`examples/raptorengine-app`): sursa `.raptor` e compilată, iar codul
browser **generat rulează pe runtime-ul real** (mini-dom), cu update-uri fine-grained verificate
(0 elemente recreate la click). DSE elimină `unused`, Fusion colapsează `label`, `price` devine o
adresă RAS `0x18A1` cu schemă `money` — totul dintr-un singur graf. **RaptorRun** (`pnpm demo:run`)
închide bucla: același graf → SSR pe server (cu valoarea live a `price`) + un client RaptorWire care
urmărește reactiv update-urile produse de server (`produce("BTC.price", …)` → semnal client), plus un
server Node HTTP real testat cu `fetch`.

## Status

Prototip conform whitepaper §0: arhitectură propusă, nu produs. Toate țintele de performanță
sunt **bugete de design validate experimental**, nu comparații de marketing. Cifrele wire sunt
măsurate local; comparațiile cu React/Preact/Solid sunt în [`benchmarks/`](benchmarks) — inclusiv
microbenchmark-ul de signals, **unde RaptorJS pierde** față de `@preact/signals-core`.
Vezi [`SPEC-RaptorWire-v0.2.md`](SPEC-RaptorWire-v0.2.md).

### Note

- **Zero dependențe runtime.** `typescript`/`@types/node` sunt doar pentru typecheck și pentru
  transformul de build al `@raptor/bundle`. Codul de producție al pachetelor nu importă nimic extern.
  **Nu există Vite/esbuild** în graful de dependențe: varianta browser e compilată de `@raptor/bundle`.
- **Rolldown/Oxc sunt opționale** și izolate în `integrations/rolldown` (în afara pnpm-workspace, ca
  `benchmarks/`), detectate dinamic la runtime. Pachetele `@raptor/*` rămân zero-dep; `raptor build`
  cade grațios pe engine-ul naiv când nu sunt instalate (whitepaper §37).
- Pentru variantele browser: `pnpm dev:counter` / `pnpm dev:dashboard` (dev server RaptorBundle cu
  live-reload) sau `pnpm build` în directorul exemplului (emite `dist/bundle.js` static). Fără toolchain extern.
- Convenție de cod: **sintaxă TS erasabilă** (fără `enum`/`namespace`-runtime/parameter properties)
  ca să ruleze nativ pe Node. Binarul nativ acceptă un **superset**: oxc transformă și `enum`/`namespace`,
  deci cod care merge nativ poate să nu meargă sub `node --experimental-strip-types`.
- **Build-ul Rust pe Windows**: `rustc.exe` nu pornește când **Smart App Control** e activ
  (`0xC0E90002`, la încărcarea `rustc_driver-*.dll`). `cargo.exe` merge, ceea ce induce în eroare.
  Reinstalarea toolchain-ului nu rezolvă. Soluția folosită aici: build în **WSL2 Ubuntu**, prin
  `pnpm native` / `pnpm native:test`. A **nu** se dezactiva Smart App Control — e ireversibil fără
  reinstalare de Windows.

### Ce NU e făcut (ca să nu fie prezentat ca făcut)

- **Buclă de evenimente și promisiuni în binarul nativ.** Fără ele nu există `fetch` asincron și nici
  forma `serve({ fetch })`; bucla de acceptare aparține aplicației, deliberat și documentat.
- **TLS**, nicăieri. `https://` trece de verificarea de capabilitate și apoi eșuează limpede, în loc
  să coboare tăcut la `http`.
- **`tasks`, `test` și `trace` legate la izolatul nativ** — există în runtime-ul TS, sunt `pending` în cel nativ.
- **Shell-ul nativ complet** (WebView2/WKWebView/WebKitGTK + launcher) și comanda `raptor-package`.
  Fără ele, criteriul „pornește o aplicație cu fereastră fără Node instalat" nu e atins — deși
  *binarul* rulează deja JS și TS fără Node.
- **Minify în `@raptor/bundle`.** Pentru asta există calea opțională Rolldown/Oxc.
- **Cursa TOCTOU la verificarea căilor.** Containerea urmărește acum legăturile simbolice, deci un link
  deja prezent în domeniul acordat nu mai scoate accesul afară — dar între verificare și `open` cineva
  care poate scrie în domeniu poate înlocui un director cu o legătură. Închiderea completă cere
  `openat2(RESOLVE_BENEATH)`, la care Node nu dă acces. Vezi [SECURITY-AUDIT.md](SECURITY-AUDIT.md).

## Licență

MIT — vezi [LICENSE](LICENSE).
