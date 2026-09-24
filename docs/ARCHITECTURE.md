# Arhitectură pentru o aplicație web pe stack-ul Raptor — „de unde apuci"

Ghid practic pentru cineva care vrea să **construiască o aplicație web** cu
RaptorJS / RaptorWire / RaptorEngine. Nu repetă teoria din whitepaper — îți spune
ce topologie să alegi, ce e gata de folosit, ce implementezi singur, și pașii
concreți de la zero la o pagină care rulează.

> **Status onest (README §Status):** e un **prototip** conform whitepaper §0, nu un
> produs. Reactivitatea, protocolul delta, compilerul, SSR și HMR funcționează și
> sunt testate. Golurile (transport de rețea, persistență, auth) sunt marcate
> explicit mai jos — nu sunt ascunse. Le acoperi cu adaptoare mici peste API-uri
> stabile.

## TL;DR — alege calea

```
Ai nevoie de realtime / stare partajată între clienți?
│
├─ NU  → Calea A: RaptorJS pur (client-only)
│         JSX + RaptorBundle + @raptor/dom. Reactivitate fine-grained, zero server.
│         Pornește de la: examples/counter
│
└─ DA  → Ai o singură pagină / feed simulat, sau vrei să rulezi acum?
         │
         ├─ DA  → Calea B: RaptorWire in-process (loopback)
         │         server + client în același proces, transport loopback.
         │         Cel mai simplu de pornit; bun pentru teste și demo-uri.
         │         Pornește de la: examples/realtime-dashboard, examples/chat
         │
         └─ NU (vreau client ↔ server pe rețea) →
                   Calea B peste WebSocket: `connectWebSocket` + `serveOverWebSocket`
                   Pornește de la: examples/todo-realtime
                   SAU
                   Calea C: RaptorEngine full (.raptor → SSR + HMR + runtime)
                   Pornește de la: examples/raptorengine-app
```

**Recomandare pentru majoritatea aplicațiilor:** începe cu **Calea B** (server
`@raptor/server` + client `@raptor/wire-client` peste loopback), pune-ți logica de
domeniu în mutations/queries, leagă UI-ul cu `client.signal(...)`. Când ai nevoie
de rețea reală, adaugi un adaptor `Transport` peste WebSocket — restul codului
rămâne neschimbat. Treci la **Calea C** doar dacă vrei SSR/resume, HMR
state-preserving și optimizarea pe graf semantic.

---

## Ce e gata vs. ce implementezi tu

| Preocupare | Stare | Unde / cum |
|---|---|---|
| Reactivitate fine-grained | ✅ gata | `@raptor/core`, `@raptor/dom` |
| Bindings DOM + control flow (`For`/`Show`) | ✅ gata | `@raptor/dom` |
| Două suprafețe de autoring peste același runtime: JSX (compilat) și `R` (hyperscript, fără build step) | ✅ gata | `@raptor/dom` |
| Componente reutilizabile (`Table`, `DropdownMenu`) cu stiluri separate | ✅ gata | `@raptor/ui` |
| Primitive headless (Portal, focusTrap, resizable, virtualizer, sortable, hotkeys...) | ✅ gata | `@raptor/ui` |
| Componente ⚡ cu teste de mutatii DOM (DataGrid virtualizat, Combobox, Slider, SplitPane, Sparkline, Progress) | ✅ gata | `@raptor/ui` |
| Suport SVG in runtime (`createElementNS` pentru tagurile SVG) | ✅ gata | `@raptor/dom` |
| Nucleu de formular (validare derivata) si overlay (Dialog/Popover/Tooltip/Toast) | ✅ gata | `@raptor/ui` |
| Layout, tipografie, afisare, controale, primitive de stare (persistedState/undoRedo/selectionState) | ✅ gata | `@raptor/ui` |
| Date/ora, navigare, fisiere, arbori si grafice de baza (139 componente: tot T1+T2) | ✅ gata | `@raptor/ui` |
| T3: grafice specializate, editoare, media, QRCode (generator ISO 18004 propriu), Kanban, Wizard | ✅ gata | `@raptor/ui` |
| 36 de puncte de intrare (subpath exports) | ✅ gata | `@raptor/ui` |
| Tree-shaking pe sursa ESM, condus de exporturile cerute (barrel: 58 module → 9, 527 KB → 39 KB) | ✅ gata | `@raptor/bundle` |
| JSX în browser | ✅ gata | `@raptor/bundle` (bundler propriu, zero-dep, fără Vite) |
| Dev server + live-reload (client-only) | ✅ gata | `@raptor/bundle` `raptor-bundle dev` |
| Protocol delta state-aware + RAS | ✅ gata | `@raptor/wire-core` |
| Server autoritativ, query/mutation/subscription | ✅ gata | `@raptor/server` |
| Client cu replică reactivă, reconnect delta | ✅ gata | `@raptor/wire-client` |
| Transport de rețea (WebSocket) | ✅ gata | `connectWebSocket` (client) + `serveOverWebSocket` (server), RFC 6455 propriu, zero-dep. Loopback rămâne pentru teste. |
| SSR + resume | ✅ gata (Calea C) | `@raptor/run` |
| Dev server + HMR state-preserving | ✅ gata (Calea C) | `@raptor/run`, `@raptor/engine` |
| Routing | ✅ de bază | `@raptor/run` `matchRoute` |
| **Persistență (DB)** | ⚠️ **tu** | store-ul e in-memory; îl alimentezi din DB-ul tău în `mutation.run` |
| **Autentificare / autorizare** | ⚠️ **tu** | hook-ul `authorize()` pe mutation + `QueryContext` — logica e a ta |
| Optimizare pe graf semantic (DSE/Fusion) | ✅ gata (Calea C) | `@raptor/engine` |
| Testare autonomă | ✅ gata | `@raptor/test` |

Cele două ⚠️ rămase sunt **adaptoare mici peste interfețe stabile**, nu rescrieri. Exemple mai jos.

---

## Calea A — RaptorJS pur (client-only)

Pentru dashboard-uri, tool-uri interne, formulare, orice UI reactiv fără backend
partajat. E cea mai simplă și 100% gata.

### Structură

```
my-app/
├─ index.html            # <div id="app"></div> + <script type="module" src="/src/main.tsx">
├─ tsconfig.json         # jsx: "react-jsx", jsxImportSource: "@raptor/dom"
├─ package.json          # deps: @raptor/core, @raptor/dom ; devDep: @raptor/bundle
└─ src/
   ├─ main.tsx           # render(App, #app)
   ├─ components/        # componente .tsx
   └─ state/             # signals/deriveds partajate (state stores)
```

Nu există fișier de config de bundler: `@raptor/bundle` are `jsxImportSource:
"@raptor/dom"` încorporat. Nu există Vite, esbuild sau Rolldown în graful de
dependențe.

### Cablare (exact ca `examples/counter`)

`package.json` (scripturi):
```json
{
  "scripts": {
    "dev": "raptor-bundle dev src/main.tsx --root . --port 5173",
    "build": "raptor-bundle build src/main.tsx --out dist/bundle.js --html index.html"
  },
  "devDependencies": { "@raptor/bundle": "workspace:*" }
}
```

`index.html` (același fișier merge în dev și în build — scriptul e rescris automat
către bundle):
```html
<div id="app"></div>
<script type="module" src="/src/main.tsx"></script>
```

`tsconfig.json` (doar pentru typecheck în editor; runtime-ul nu are nevoie de el):
```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@raptor/dom",
    "allowImportingTsExtensions": true,
    "noEmit": true
  }
}
```

`src/main.tsx`:
```tsx
import { render, state, derived } from "@raptor/dom";

function Counter() {
  const count = state(0);
  const parity = derived(() => (count() % 2 === 0 ? "par" : "impar"));
  return (
    <section>
      <h2>{count}</h2>              {/* {count} = accesor → text-node fine-grained */}
      <p>Valoare {parity}</p>
      <button on:click={() => count.update((n) => n + 1)}>+1</button>
    </section>
  );
}
render(Counter, document.getElementById("app"));
```

Rulează: `pnpm dev` (dev server cu live-reload pe `http://localhost:5173`) sau
`pnpm build` (emite `dist/bundle.js` + `dist/index.html`, servibile ca fișiere
statice). Vezi și [„Cum funcționează RaptorBundle"](#cum-funcționează-raptorbundle).

**Pattern de „store" partajat:** pune signals într-un modul și importă-i unde ai
nevoie — nu există provider/context, e doar reactivitate.
```ts
// src/state/cart.ts
import { state, derived } from "@raptor/core";
export const items = state<CartItem[]>([]);
export const total = derived(() => items().reduce((s, i) => s + i.price, 0));
export const add = (i: CartItem) => items.update((xs) => [...xs, i]);
```

### Cum funcționează RaptorBundle

`@raptor/bundle` e bundler-ul propriu al proiectului — înlocuiește complet Vite,
în spiritul zero-dep / compiler-centric al stack-ului. Are **zero dependențe la
runtime**; folosește compilatorul TypeScript (deja în repo, ca `typescript`) doar
ca primitivă de transform la build-time.

Ce face, în ordine:
1. **Transform** — fiecare `.tsx`/`.ts` e transformat: JSX → apeluri către
   `@raptor/dom/jsx-runtime` (fine-grained, fără Virtual DOM), tipurile sunt șterse.
2. **Rezolvare** — specifierele (`./x.ts`, `@raptor/dom`, `@raptor/dom/jsx-runtime`)
   sunt rezolvate cu rezolverul Node, inclusiv `exports` map către sursa `.ts` a
   pachetelor `@raptor/*`.
3. **Împachetare** — graful (închis și zero-dep) e strâns într-un singur fișier cu
   un registru de module și `require` lazy — un `dist/bundle.js` servibil static.
4. **Dev** — `raptor-bundle dev` pornește un server `node:http` care servește
   `index.html` (cu scriptul rescris către bundle), reconstruiește la cerere și face
   **live-reload** prin SSE la fiecare `fs.watch`.

```bash
raptor-bundle build src/main.tsx --out dist/bundle.js --html index.html
raptor-bundle dev   src/main.tsx --root . --port 5173
```

Poți folosi și API-ul din cod (`bundleApp`, `startDevServer`, `transpile`) — vezi
[`USAGE.md`](USAGE.md#raptorbundle--bundler-tsx-propriu-fără-vite). Face
tree-shaking pe sursa ESM (re-exporturile nefolosite dintr-un barrel sunt tăiate
înainte de transpilare). Limitări actuale (v0.1): fără code-splitting, fără
minificare (pentru minificare, treci pe Calea C, unde engine-ul poate folosi Oxc
opțional), iar tree-shaking-ul e la nivel de modul, nu de declarație.

> De ce contează: forma de scriere JSX nu mai atârnă de un toolchain extern.
> Bundler-ul, dev server-ul și HMR-ul-de-bază sunt cod Raptor, ~400 de linii, pe care
> le poți citi și modifica.

---

## Calea B — RaptorWire in-process (realtime, recomandat de start)

Server autoritativ + client cu replică reactivă. UI-ul se leagă de
`client.signal(...)`; serverul mută starea prin operații delta. **Aici pui logica
de domeniu.**

### Topologie

```
┌─────────────────────────── același proces (v0.1) ───────────────────────────┐
│                                                                              │
│   @raptor/server                    Transport                @raptor/wire-client
│   ┌───────────────┐   ops delta   ┌──────────┐   ops delta   ┌───────────────┐
│   │ ReactiveStore │ ────────────▶ │ loopback │ ────────────▶ │ replică (signals)│
│   │ (autoritativ) │ ◀──────────── │ (in-mem) │ ◀──────────── │  client.signal() │
│   │ query/mutation│   mutații      └──────────┘   subscribe   └───────┬───────┘
│   └───────────────┘                                                   │
│         ▲                                              @raptor/dom     ▼
│         │ store.setSignal/patch/append           mountChild / For / {signal}
│    logica ta de domeniu                                    DOM fine-grained
│    (DB, reguli, auth)                                                        │
└──────────────────────────────────────────────────────────────────────────────┘
       ⚠️ Pentru client ↔ server pe MAȘINI DIFERITE: înlocuiește `loopback`
          cu un adaptor `Transport` peste WebSocket (vezi mai jos). Nimic altceva nu se schimbă.
```

### 1. Serverul (logica de domeniu)

```ts
// server/app.ts
import { raptorServer, type RaptorServer, type ReactiveStore } from "@raptor/server";

export function buildApp(): RaptorServer {
  const app = raptorServer({ build: "my-app-0.1.0" });

  // query = ce prefixe de chei poate vedea clientul
  app.query("board", { select: () => ["cards", "card:"] });

  // mutation = comandă tipată; AICI validezi, persistezi, autorizezi
  app.mutation("addCard", {
    authorize: ({ input }) => isAllowed(input),        // ⚠️ auth = codul tău
    run: ({ input, store }) => {
      const { id, title } = input as { id: number; title: string };
      db.insert("card", id, { title, done: false });    // ⚠️ persistență = codul tău
      store.transaction(() => {                          // batch atomic → 1 commit UI
        store.setField(`card:${id}`, "title", title);
        store.setField(`card:${id}`, "done", false);
        store.append("cards", id);
      });
      return { ok: true, id };
    },
  });

  app.mutation("toggle", {
    run: ({ input, store }) => {
      const { id, done } = input as { id: number; done: boolean };
      db.update("card", id, { done });
      store.patch(`card:${id}`, { done });               // delta minim pe fir
      return { id, done };
    },
  });

  return app;
}
```

### 2. Clientul + UI

```tsx
// client/main.tsx
import { render, For } from "@raptor/dom";
import { createLoopback, RaptorClient } from "@raptor/wire-client";
import { buildApp } from "../server/app.ts";

const app = buildApp();
const link = createLoopback();     // ⚠️ înlocuit cu WebSocket pt. rețea reală
app.serve(link.server);

const client = new RaptorClient(link.client, { build: "web-0.1.0" });
await client.connect();
client.subscribe("board");

function Board() {
  return (
    <ul>
      <For each={() => (client.signal<number[]>("cards")() ?? []) as number[]}>
        {(id) => (
          <li>
            {() => {
              const c = client.signal(`card:${id}`)() as { title?: string; done?: boolean };
              return `${c?.done ? "✓" : "○"} ${c?.title ?? ""}`;
            }}
            <button on:click={() => client.mutate("toggle", { id, done: true })}>done</button>
          </li>
        )}
      </For>
    </ul>
  );
}
render(Board, document.getElementById("app"));
```

Regula de aur a UI-ului: **nu ține stare în componentă**. Sursa de adevăr e
serverul; UI-ul e o proiecție reactivă a `client.signal(...)`. Un `mutate()`
trimite comanda; delta care se întoarce actualizează exact bindingurile afectate.

### 3. Trecerea la rețea reală — adaptorul `Transport`

`Transport` are trei metode. Un adaptor WebSocket e direct:

```ts
// shared/ws-transport.ts
import { type Transport } from "@raptor/wire-client";

export function wsTransport(ws: WebSocket): Transport {
  ws.binaryType = "arraybuffer";
  return {
    send: (data) => ws.send(data),
    onMessage: (handler) => {
      ws.addEventListener("message", (e) => handler(new Uint8Array(e.data as ArrayBuffer)));
    },
    close: () => ws.close(),
  };
}
```

Client:
```ts
const ws = new WebSocket("wss://api.exemplu.ro/raptor");
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
const client = new RaptorClient(wsTransport(ws));
await client.connect();
client.subscribe("board");
```

Pe server (Node), pui capătul opus al aceleiași interfețe peste conexiunea WS și
îl dai lui `app.serve(serverTransport)`. La reconnect, `client.resume(newTransport,
"board")` cere delta de la versiunea deja cunoscută de client (`this.version`),
deci op-log-ul îți dă **reconnect fără full resend** — vezi
[`USAGE.md`](USAGE.md#raptorwire-client--sesiune--replică-reactivă).

> De ce merită: chiar și fără WebSocket gata făcut, granița e o interfață de 3
> metode. Tot restul aplicației (server, client, UI, delta, reconnect) e neschimbat.

### 4. Persistență

Store-ul RaptorWire e memoria de lucru autoritativă, **nu** baza ta de date.
Modelul corect:

- **Scriere:** în `mutation.run` scrii mai întâi în DB, apoi reflecți în store
  (`setField`/`patch`/`append`). Store-ul emite delta către clienți.
- **Pornire / rehidratare:** la boot, citești din DB și faci seed în store
  (`store.setSignal(...)`), exact ca `buildDashboardApp` face seed inițial.
- **Consistență:** `store.transaction(() => ...)` grupează scrierile într-un commit
  atomic (un singur frame pe client), potrivit cu granițele tranzacției din DB.

---

## Calea C — RaptorEngine full (`.raptor` → SSR + HMR + runtime)

Când vrei ca **compilerul să dețină semantica**: SSR/resume din același graf,
HMR state-preserving, DSE/Fusion, codegen browser+server+wire dintr-o singură
sursă. Mai experimental, dar închide bucla end-to-end.

### Flux

```
App.raptor ──buildModule──▶ { browser, server, wire, graph, manifest, chunks }
                                   │
                RaptorRuntime.fromBuild(result)
                                   │
        ┌──────────────┬───────────┴────────────┬───────────────┐
        ▼              ▼                         ▼               ▼
     ssr("/")     produce("addr", v)        connect()      metrics/log
    HTML+resume   server signal → wire   client reactiv   observability
                                   │
                RaptorDevServer: fs.watch → recompilă → diff → HMR (SSE)
```

### Minim

```ts
import { readFileSync } from "node:fs";
import { buildModule } from "@raptor/engine";
import { RaptorRuntime, renderDocument, createNodeServer, listen } from "@raptor/run";

const source = readFileSync("src/App.raptor", "utf8");
const result = buildModule(source, "App.raptor");
const runtime = RaptorRuntime.fromBuild(result, { initial: { "BTC.price": 60000 } });

// SSR pe request
const ssr = runtime.ssr("/");
const html = renderDocument(ssr, ssr.resume.component);

// server signal → clienți RaptorWire abonați
runtime.produce("BTC.price", 61000);

// server Node HTTP real
const server = createNodeServer(runtime);
await listen(server, 3000);
```

Dev cu HMR: `pnpm raptor:dev src/App.raptor`. Vezi
[`USAGE.md`](USAGE.md#raptorrun--server-runtime--ssr--dev-server) și
[`examples/raptorengine-app`](../examples/raptorengine-app).

> Când merită Calea C: aplicații mari unde optimizarea pe graf (elimini reactive
> mort, fuzionezi deriveds) și HMR-ul care păstrează starea contează. Pentru un MVP,
> Calea B e mai puțin cod și la fel de reactivă.

---

## Structură de referință pentru o aplicație realtime (Calea B)

```
my-app/
├─ package.json
├─ shared/
│  ├─ protocol.ts        # nume de query, prefixe de chei, tipuri input/output
│  └─ ws-transport.ts    # adaptorul Transport (client + server)
├─ server/
│  ├─ app.ts             # raptorServer: query + mutations (logica de domeniu)
│  ├─ db.ts              # accesul tău la DB (Postgres/SQLite/…)
│  ├─ auth.ts            # authorize() + context de sesiune
│  └─ main.ts            # WS server Node → app.serve(transport) per conexiune
└─ web/
   ├─ index.html         # <script type="module" src="/main.tsx">
   ├─ main.tsx           # RaptorClient(wsTransport(ws)) + render(App, #app)
   └─ components/        # componente .tsx legate de client.signal(...)
       # dev/build cu `raptor-bundle` (fără fișier de config)
```

Reguli de organizare:
- **`shared/protocol.ts`** ține numele de query, prefixele de chei și tipurile
  input/output ale mutațiilor — o singură sursă de adevăr pentru ambele capete
  (ca `DASHBOARD_QUERY`/`DASHBOARD_PREFIXES` în exemple).
- **Serverul nu importă cod de UI**; **UI-ul nu importă `db`/`auth`**. Granița
  trece prin query/mutation + transport.
- **Un `Transport` per conexiune** pe server; store-ul e partajat între conexiuni.

---

## Checklist „production readiness"

Ce trebuie să adaugi tu peste prototip, în ordinea priorității:

1. **Transport real** — adaptor `Transport` peste WebSocket (client + server). Fără
   asta rămâi in-process. *(interfață stabilă, ~40 linii)*
2. **Persistență** — DB în spatele mutațiilor + seed la boot. Store-ul e memoria de
   lucru, nu adevărul durabil.
3. **Auth** — implementează `authorize()` pe fiecare mutation și pune identitatea în
   contextul de sesiune. Nu expune query-uri fără control de acces.
4. **Backpressure / limite** — validează input-ul mutațiilor; limitează dimensiunea
   colecțiilor și rata de op-uri.
5. **Reconnect** — folosește `client.resume(newTransport, query)` (delta resync de la
   versiunea cunoscută) în loc de reconnect cu full snapshot. Op-log-ul e deja acolo.
6. **Observability** — pe Calea C ai `runtime.metrics` / `runtime.log`; pe Calea B
   instrumentează în jurul `app.serve` și al mutațiilor.
7. **Testare** — folosește `@raptor/test` pentru descoperire autonomă de bug-uri +
   teste de buget (0 field names repetate, 1 commit/frame) ca în
   `examples/realtime-dashboard/tests`.

---

## De unde să pornești, concret

1. **Rulează întâi demo-urile** ca să vezi fiecare cale live:
   `pnpm demo:counter` (A), `pnpm demo:dashboard` și `pnpm demo:chat` (B),
   `pnpm demo:run` (C).
2. **Copiază exemplul cel mai apropiat** de aplicația ta:
   - UI reactiv simplu → `examples/counter`
   - realtime / stare partajată → `examples/realtime-dashboard` sau `examples/chat`
   - compilare end-to-end → `examples/raptorengine-app`
3. **Înlocuiește logica de domeniu** în `mutation.run` / query `select`.
4. **Leagă UI-ul** doar prin `client.signal(...)` (nu ține stare în componente).
5. Când ai nevoie de rețea → **scrie adaptorul `Transport`** și schimbă o singură
   linie de instanțiere. Restul rămâne.

*Detalii de API pentru fiecare pas: [`USAGE.md`](USAGE.md). Arhitectură conceptuală
și țintele de design: [`README.md`](../README.md) + whitepaper-urile din
[`design/`](../design/).*
