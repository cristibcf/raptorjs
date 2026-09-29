# RaptorJS / RaptorWire / RaptorTest / RaptorEngine — ghid de utilizare

Documentație de utilizare, pachet cu pachet, cu exemple **rulabile** extrase din
demo-urile reale (`examples/`). README-ul descrie *arhitectura*; acest ghid arată
*cum se folosește fiecare API*.

Toate exemplele rulează direct pe **Node ≥ 22** (TypeScript nativ prin type-stripping).
Pachetele `@raptor/*` sunt **zero-dep**: nu importă nimic extern.

> Convenție de cod obligatorie: **sintaxă TS erasabilă** — fără `enum` runtime, fără
> `namespace` cu valori, fără parameter properties. Folosește `const X = { ... } as const`
> și `type`/`interface`. Altfel codul nu rulează nativ pe Node.

## Cuprins

- [Rulare rapidă](#rulare-rapidă)
- [Harta pachetelor](#harta-pachetelor)
- [raptorjs — reactivitate fine-grained](#raptorcore--reactivitate-fine-grained)
- [raptorjs/dom — runtime DOM + control flow](#raptordom--runtime-dom--control-flow)
- [raptorjs/ui — componente reutilizabile](#raptorui--componente-reutilizabile)
- [@raptor/engine/bundle — bundler TSX propriu (fără Vite)](#raptorbundle--bundler-tsx-propriu-fără-vite)
- [@raptor/wire/codec — primitive de codec](#raptorwire-codec--primitive-de-codec)
- [@raptor/wire — opcodes, Document, protocol](#raptorwire-core--opcodes-document-protocol)
- [@raptor/wire/server — SDK server RaptorWire](#raptorserver--sdk-server-raptorwire)
- [@raptor/wire/client — sesiune + replică reactivă](#raptorwire-client--sesiune--replică-reactivă)
- [End-to-end: server ↔ RaptorWire ↔ client ↔ DOM](#end-to-end-server--raptorwire--client--dom)
- [@raptor/engine/compiler — parser `.raptor`, IR, graf semantic](#raptorcompiler--parser-raptor-ir-graf-semantic)
- [@raptor/engine — build, optimize, codegen, HMR, CLI](#raptorengine--build-optimize-codegen-hmr-cli)
- [@raptor/engine/run — server runtime + SSR + dev server](#raptorrun--server-runtime--ssr--dev-server)
- [@raptor/engine/profile — telemetrie + PGO](#raptorprofile--telemetrie--pgo)
- [@raptor/test — testare comportamentală autonomă](#raptortest--testare-comportamentală-autonomă)
- [Formatul `.raptor`](#formatul-raptor)
- [Referință CLI](#referință-cli)

---

## Rulare rapidă

```bash
pnpm install          # leagă workspace-ul (+ devDeps opționale)
pnpm test             # rulează toată suita de teste
pnpm typecheck        # tsc --noEmit pe tot monorepo-ul

pnpm demo:counter     # bindings DOM fine-grained (headless)
pnpm demo:dashboard   # server ↔ RaptorWire ↔ client ↔ DOM
pnpm demo:chat        # stare partajată între 2 clienți
pnpm demo:raptortest  # descoperă autonom bug-uri
pnpm demo:engine      # .raptor → IR → optimize → codegen → HMR
pnpm demo:run         # SSR + server signal ↔ RaptorWire ↔ client reactiv
pnpm demo:profile     # telemetrie → plan PGO → rebuild
```

## Harta pachetelor

Ordinea de dependență (jos → sus). Poți folosi fiecare strat independent.

```
raptorjs ── reactivitate (signals)
   └─ raptorjs/dom ── bindings DOM + JSX

@raptor/wire/codec ── varint / zig-zag / string
   └─ @raptor/wire ── opcodes, Document, protocol
        ├─ @raptor/wire/server ── store autoritativ + query/mutation
        └─ @raptor/wire/client ── sesiune + replică reactivă

@raptor/engine/compiler ── .raptor → IR → graf semantic
   └─ @raptor/engine ── optimize + codegen + HMR + CLI `raptor`
        ├─ @raptor/engine/run ── server runtime + SSR + dev server
        └─ @raptor/engine/profile ── telemetrie + planner PGO

@raptor/test ── testare comportamentală autonomă (independent)
```

---

## raptorjs — reactivitate fine-grained

Nucleul reactiv glitch-free. Semnalele sunt **accesori apelabili**: `count()` citește
și înregistrează dependență; `count.set(v)` / `count.update(fn)` scriu.

**Exportă:** `state`, `derived`, `memo` (alias pt. `derived`), `effect`, `batch`,
`untracked`, `createRoot`, `onCleanup`, `getOwner`, `runWithOwner` + tipurile
`State`, `Derived`, `Accessor`, `Dispose`, `StateOptions`.

### API esențial

```ts
import { state, derived, effect, batch, untracked } from "raptorjs";

// --- signal mutabil ---
const count = state(0);
count();                     // 0   (citește + înregistrează dependență)
count.set(5);                // scrie
count.update((n) => n + 1);  // 6   (scrie în funcție de valoarea anterioară)
count.peek();                // 6   (citește FĂRĂ a înregistra dependență)

// --- derived (memo lazy, read-only) ---
const doubled = derived(() => count() * 2);
doubled();                   // 12

// --- effect (eager: rulează acum + la fiecare schimbare de dependență) ---
const dispose = effect(() => {
  console.log("count =", count());
});
count.set(10);               // effect-ul re-rulează automat
dispose();                   // oprește effect-ul

// --- batch: grupează scrieri, effects rulează O SINGURĂ dată la final ---
batch(() => {
  count.set(1);
  count.set(2);
});                          // effect-ul rulează o dată, cu valoarea finală

// --- untracked: citește fără a crea dependență ---
const snapshot = untracked(() => count());
```

### Comparator de egalitate

```ts
// `equal: false` forțează notificarea la fiecare set, chiar dacă valoarea e egală.
const forced = state(0, { equal: false });
// comparator custom (ex. pentru obiecte):
const point = state({ x: 0 }, { equal: (a, b) => a.x === b.x });
```

### Ownership și cleanup

```ts
import { createRoot, onCleanup } from "raptorjs";

createRoot((dispose) => {
  const s = state(0);
  effect(() => console.log(s()));
  onCleanup(() => console.log("cleanup!"));  // rulează la dispose()
  // ...
  dispose();  // dispune tot arborele reactiv creat în acest root
});
```

> **Model mental (whitepaper §6):** graful e *glitch-free* — un `derived` nu se
> vede niciodată într-o stare intermediară inconsistentă. `derived`-urile sunt
> **lazy** (se recalculează la citire), `effect`-urile sunt **eager**.

---

## raptorjs/dom — runtime DOM + control flow

Output-ul compilerului: bindinguri DOM fine-grained + control flow. Re-exportă și
primitivele din `raptorjs` pentru ergonomie (nu mai importe separat).

**Exportă:** `render`, `onMount`, `createElement`, `template`, `applyProps`,
`mountChild`, `block`, `isBlock`, `disposeDetached`; control flow `For`, `Show`;
JSX runtime `jsx`, `jsxs`, `Fragment`; builder hyperscript `R`; + tot din
`raptorjs`.

### Mini-DOM headless pentru teste

`raptorjs/dom/testing` oferă un DOM fals care **numără fiecare mutație** — util ca
să dovedești că update-urile sunt fine-grained (0 noduri recreate).

```ts
import { installMiniDom, stats, resetStats } from "raptorjs/dom/testing";
import { render, mountChild, applyProps } from "raptorjs/dom";
import { state, derived } from "raptorjs";

const doc = installMiniDom();

function Counter() {
  const count = state(0);
  const parity = derived(() => (count() % 2 === 0 ? "par" : "impar"));

  const section = doc.createElement("section");
  const h2 = doc.createElement("h2");
  mountChild(h2, () => count(), null);           // text-node legat fine-grained
  section.appendChild(h2);

  const button = doc.createElement("button");
  applyProps(button, { "on:click": () => count.update((n) => n + 1) });
  mountChild(button, "+1", null);
  section.appendChild(button);
  return section;
}

const root = doc.createElement("div");
render(Counter, root);

resetStats();
root.querySelector("button").click();

// Dovada fine-grained: doar text-node mutat, zero elemente noi.
stats.createElement;  // 0
stats.textUpdate;     // 1   (exact bindingul afectat)
```

- `mountChild(parent, child, anchor)` — montează un copil. `child` poate fi text
  static (`"+1"`), un accesor (`() => count()` → text-node reactiv), sau un `Block`.
- `applyProps(el, props)` — aplică atribute și handlere. `on:click` etc. sunt
  event bindings; atributele reactive primesc un accesor.

### Control flow: `For` (keyed) și `Show`

```ts
import { For, Show } from "raptorjs/dom";

// For keyed: reutilizează nodurile pentru itemii neschimbați (mutări DOM minime).
For({
  each: () => items(),                       // Accessor<readonly T[]>
  children: (item, index) => renderRow(item), // (item, index) => Child
});

// Show: montează `children` când `when` e truthy, altfel `fallback`.
Show({
  when: () => isVisible(),   // Accessor<unknown>
  children: renderPanel(),   // Child
  fallback: renderEmpty(),   // opțional
});
```

### JSX (varianta browser, `.tsx`)

Scrii componente în JSX; le compilează [`@raptor/engine/bundle`](#raptorbundle--bundler-tsx-propriu-fără-vite)
(bundler propriu, fără Vite). Configurează `tsconfig` cu `jsxImportSource:
"raptorjs/dom"` doar pentru typecheck în editor. Apoi:

```tsx
function Counter() {
  const count = state(0);
  return (
    <button on:click={() => count.update((n) => n + 1)}>
      clicks: {count()}
    </button>
  );
}
render(Counter, document.getElementById("app"));
```

### `R` — hyperscript, aceleași bindinguri fără build step

`R` construiește exact ce construiește JSX — noduri DOM reale, cu bindinguri
fine-grained — dar e cod JavaScript obișnuit, deci nu are nevoie de compilator.
Util când codul e evaluat la runtime (playground, REPL, snippet-uri din baza de
date) sau într-un proiect fără build step.

```ts
import { R, state, render } from "raptorjs/dom";

function Counter() {
  const count = state(0);
  return R.div({ class: "row" },
    R.span({ style: () => (count() > 9 ? "color:red" : "") }, () => count()),
    R.button({ "on:click": () => count.update((n) => n + 1) }, "+1"),
  );
}
render(Counter, document.getElementById("app"));
```

Echivalentul JSX al aceluiași arbore compilează în aceleași apeluri de runtime;
diferența e doar de sintaxă, nu de comportament sau de performanță.

- **`R.<tag>(props?, ...children)`** — primul argument e `props` doar dacă e un
  obiect simplu. Orice altceva (string, number, nod, accesor, array, `Block`) e
  copil, deci `R.p("text")` și `R.p({ class: "x" }, "text")` merg amândouă.
- **`R(Component, props?, ...children)`** — apelul direct montează o componentă;
  copiii ajung în `props.children`.
- **Reactivitatea se exprimă la fel ca în JSX**: o *funcție* e un binding, o
  valoare e statică. `R.div(count())` scrie valoarea o dată și nu se mai schimbă;
  `R.div(() => count())` leagă un text-node de semnal. Același lucru pentru
  atribute: `{ style: () => ... }` se re-evaluează, `{ style: "..." }` nu.
- `For` și `Show` se folosesc identic — întorc `Block`-uri, care sunt copii valizi:
  `R.ul(For({ each: () => items(), children: (x) => R.li(x.name) }))`.

Builder-ul per tag e memoizat (`R.div === R.div`), deci `R` nu alocă nimic în plus
la fiecare apel.

---

## raptorjs/ui — componente reutilizabile

Componente gata făcute peste runtime-ul fine-grained: `Table` și `DropdownMenu`.
Zero dependențe runtime, construite cu `R` (deci fără build step) și testate
împotriva mini-DOM-ului care numără mutațiile.

**Importă adânc** (`raptorjs/ui/button`), nu din barrel — vezi tabelul de mai jos;
diferența e de 13× pe bundle.

**Stilurile sunt separate și opționale.** Componentele pun doar clase (`rui-*`)
și atribute ARIA; CSS-ul stă în `raptorjs/ui/styles` și îl injectezi tu dacă vrei:

```ts
import { installStyles } from "raptorjs/ui/styles";
installStyles();   // sau: importă RUI_CSS și pune-l în propriul bundle
```

### Importuri: barrel vs subpath

`raptorjs/ui` expune **36 de puncte de intrare**. De când RaptorBundle face
[tree-shaking](#tree-shaking), barrel-ul nu mai e scump:

```ts
import { Button } from "raptorjs/ui";          // 9 module, 39 KB
import { Button } from "raptorjs/ui/button";   // 8 module, 38 KB
```

Fără tree-shaking (`--no-treeshake`, sau alt bundler care nu-l face), același
barrel dă **58 de module și 527 KB**.

**Regula practică:** importă adânc oricum. Tree-shaking-ul lucrează la nivel de
modul, nu de declarație — `raptorjs/ui/chart` aduce doar scale + Line/Area/Bar,
în timp ce un simbol luat din barrel poate ajunge într-un fișier care conține
încă zece componente înrudite. Diferența e mică, dar reală, iar importul adânc
spune și cititorului de unde vine componenta.

#### Harta punctelor de intrare

| Subpath | Ce conține |
|---|---|
| `raptorjs/ui` | tot (barrel) |
| `/styles` | `RUI_CSS`, `installStyles` |
| `/primitives` | cele 21 de primitive headless |
| `/button` | `Button`, `IconButton`, `ButtonGroup` |
| `/input` | `Input`, `Textarea`, `Checkbox`, `Switch`, `RadioGroup` |
| `/controls` | `NumberInput`, `PinInput`, `SearchInput`, `TagsInput`, `SegmentedControl`… |
| `/input-extra` | `MaskedInput`, `CurrencyInput`, `PhoneInput`, `Mentions`, `Rating`, `ColorPicker`, `TransferList`, `TreeSelect`, `Cascader` |
| `/select`, `/combobox` | `Select`, `Combobox` |
| `/form` | `Form`, `FormField`, `FormSection`, `ValidationSummary`, `field`, `validators` |
| `/layout`, `/layout-extra` | `Stack`, `Grid`, `Container`… / `Masonry`, `Affix`, `Dock`, `SplitButton`, `FAB` |
| `/typography` | `Text`, `Heading`, `Link`, `CodeBlock`, `Mark` |
| `/display` | `Card`, `Badge`, `Avatar`, `Alert`, `Skeleton`, `Timeline` |
| `/disclosure` | `Collapsible`, `Accordion` |
| `/table`, `/data-grid` | `Table` / `DataGrid` virtualizat |
| `/data-views` | `TreeView`, `ListView`, `MultiSelect`, `Autocomplete`, `CommandPalette` |
| `/menu`, `/tabs` | `DropdownMenu` / `Tabs` |
| `/overlay`, `/overlay-extra` | `Dialog`, `Popover`, `Tooltip` / `Drawer`, `ContextMenu`, `Backdrop`, `ErrorBoundary` |
| `/toast` | `createToaster`, `Toaster` |
| `/navigation` | `Breadcrumbs`, `Pagination`, `Stepper`, `Navbar`, `AppShell` |
| `/date` | `Calendar`, `DatePicker`, `TimePicker`, `MonthPicker` + utilitarele de dată |
| `/files` | `FileInput`, `Dropzone`, `FileList`, `validateFiles` |
| `/progress`, `/slider`, `/sparkline`, `/split-pane` | componentele ⚡ mici |
| `/chart`, `/chart-extra` | scale + Line/Area/Bar / celelalte 11 tipuri |
| `/editors` | `RichTextEditor`, `CodeEditor`, `JsonViewer`, `DiffViewer` |
| `/media` | `Carousel`, `Lightbox`, playere, `Waveform` |
| `/qrcode` | `QRCode` + codificatorul |
| `/advanced` | `Kanban`, `Wizard`, `Menubar`, `HoverCard`, `Tour` |

> **Notă de reorganizare:** `idle` și `networkStatus` au trecut în
> `raptorjs/ui/primitives` (acolo le e locul, sunt primitive fără randare),
> `FormSection` și `ValidationSummary` în `/form`, iar `DateTimePicker`,
> `MonthPicker` și `YearPicker` în `/date`. Barrel-ul le exportă la fel ca
> înainte, deci nimic nu se rupe.

### Primitive headless (`raptorjs/ui/primitives`)

Nu randează nimic și nu au CSS. Se atașează prin `ref` sau întorc semnale. Toate
își scot singure listenerele globale la dispose — niciun handler nu supraviețuiește
componentei. Sunt fundația pentru restul bibliotecii: `Dialog` are nevoie de
`Portal` + `focusTrap`, `Popover` de `clickOutside`, `DataGrid` de `virtualizer`.

| Primitivă | Formă | Ce face |
|---|---|---|
| `Portal` | componentă | montează conținutul în alt nod (implicit `document.body`) |
| `focusTrap()` | ref | ține focusul înăuntru, ciclează Tab, îl restaurează la ieșire |
| `clickOutside(fn, opt?)` | ref | rulează `fn` la click în afară; `ignore` și `enabled` |
| `VisuallyHidden(...)` | componentă | ascuns vizual, prezent pentru screen reader |
| `Transition` | componentă | ține nodul montat pe durata ieșirii |
| `draggable(opt?)` | `{ ref, dragging, delta }` | drag cu pointer events, axă și prag |
| `droppable(payload, opt)` | `{ ref, over }` | zonă de drop cu filtru `accepts` |
| `sortable({ items })` | `{ item, dragging, over, move }` | reordonare care mută nodurile |
| `resizable(opt?)` | `{ handle, size, style, nudge, ... }` | redimensionare prin drag + tastatură |
| `virtualizer(opt)` | `{ ref, indices, itemStyle, ... }` | fereastră peste zeci de mii de rânduri |
| `infiniteScroll(opt)` | `{ ref, loading, load }` | încărcare la capăt, fără suprapuneri |
| `intersects(opt?)` | `{ ref, visible, trigger }` | vizibilitate ca semnal |
| `clipboard(ms?)` | `{ copy, copied, error, reset }` | copiere cu stare temporară |
| `hotkeys(map, opt?)` | efect | scurtături; `mod` = Cmd/Ctrl, sărite în input-uri |
| `mediaQuery(q, fallback?)` | accesor | media query ca semnal |

```ts
import { resizable, clickOutside, hotkeys } from "raptorjs/ui";

function SplitPane() {
  const left = resizable({ axis: "x", initial: 240, min: 160, max: 520 });
  hotkeys({ "mod+b": () => left.setSize(left.size() > 0 ? 0 : 240) });

  return R.div({ style: "display:flex" },
    R.aside({ style: () => left.style() }, "sidebar"),
    R.div({ class: "rui-resize-handle", ref: left.handle }),
    R.main("conținut"));
}
```

**De ce `resizable` e componenta-teză.** Un drag produce `pointermove` la
60–120Hz. Testul din `packages/ui/tests/primitives.test.ts` trage 60 de
evenimente și verifică: `stats.createElement === 0`, `stats.createText === 0`,
`stats.setAttribute === 60` — exact o scriere de atribut pe frame, niciun nod
atins. Într-un framework cu VDOM fiecare eveniment ar declanșa un re-render și
o reconciliere.

**`virtualizer` întoarce indici, nu obiecte.** `For` e keyed pe identitatea
valorii; un obiect `{index, start, size}` nou la fiecare recalcul ar fi o cheie
nouă, deci fereastra s-ar reconstrui la fiecare pixel de scroll — exact opusul
scopului. Numerele sunt primitive, deci indicele 5 e aceeași cheie mereu:

```ts
const v = virtualizer({ count: () => rows().length, itemSize: 32 });

R.div({ ref: v.ref, style: "overflow:auto;height:400px" },
  R.div({ style: () => v.spacerStyle() },
    For({ each: () => v.indices(),
          children: (i) => R.div({ style: v.itemStyle(i) }, rows()[i].name) })));
```

Testul verifică: cu 10.000 de rânduri sunt randate 7, iar un scroll de exact un
rând creează **cel mult un element nou**, nu 7.

> Primitivele care depind de API-uri de browser (`matchMedia`,
> `IntersectionObserver`, `navigator.clipboard`, `focus()`) funcționează și
> acolo unde acestea lipsesc — cad pe un fallback și expun un `trigger()` /
> `load()` manual, ca logica să rămână testabilă fără layout real.

### Valul 2 — componentele ⚡

Componente unde fine-grained nu e o preferință de stil, ci un raport măsurabil.
Fiecare are un test care numără mutațiile DOM.

| Componentă | Teza, verificată în test |
|---|---|
| `Progress` | 100 de pași → 0 noduri, exact 200 de scrieri de atribut (lățime + `aria-valuenow`) |
| `Slider` / `RangeSlider` | drag de 60 de frame-uri → 0 noduri create |
| `SplitPane` | drag de 60 de frame-uri → 0 noduri create |
| `Sparkline` | 200 de tick-uri de date live → 0 noduri, exact 200 de rescrieri ale lui `d` |
| `Combobox` | filtrare la tastare → opțiunile rămase își păstrează nodurile |
| `DataGrid` | 50.000 de rânduri, 14 în DOM; derulare cu un rând → cel mult un rând nou |

```ts
import { Progress, Slider, Sparkline, SplitPane, Combobox, DataGrid } from "raptorjs/ui";

const volume = state(40);
Slider({ value: volume, min: 0, max: 100, step: 5, label: "Volum" });

Progress({ value: () => uploaded(), max: 100, caption: true });

Sparkline({ data: () => history(), width: 120, height: 32, area: true, lastPoint: true });
```

**`Slider`** ține valoarea într-un semnal pe care îl deții tu. Tastatură completă
(săgeți cu `step`, `PageUp`/`PageDown` cu 10%, `Home`/`End`), ARIA `role="slider"`
cu `aria-valuenow`/`aria-valuetext`. `RangeSlider` are două mânere care nu se
depășesc. Geometria pistei vine din `getBoundingClientRect`, dar `setTrack(start, size)`
o poate împinge din afară — de aceea cuantizarea și plafonarea sunt testabile fără
layout real.

**`DataGrid`** nu folosește `<table>`: un tabel real nu poate fi virtualizat corect,
fiindcă rândurile poziționate absolut strică layout-ul de tabel. Folosește grid cu
roluri ARIA de tabel (`role="grid"`, `columnheader`, `gridcell`, `aria-rowcount`),
ca toate grid-urile virtualizate serioase. Coloanele se redimensionează prin
`resizable` — tragerea rescrie un singur `grid-template-columns`.

**`Combobox`** urmează pattern-ul ARIA combobox: focusul rămâne în input (ca să
poți scrie mai departe), iar opțiunea evidențiată e semnalată prin
`aria-activedescendant`. Poziționarea listei trece prin `positioner`.

### `positioner` — poziționare fără tăiere la margine

```ts
const pos = positioner({ placement: "bottom-start", flip: true, shift: true });
R.button({ ref: pos.reference }, "deschide");
R.div({ ref: pos.floating, style: () => pos.style() }, "conținut");
```

`flip` întoarce plasamentul pe partea opusă când nu încape, `shift` îl glisează pe
axa secundară cât să rămână în ecran. Rezultatul e un semnal, deci repoziționarea
rescrie un singur atribut de stil. `update({ reference, floating, viewport })`
acceptă dreptunghiuri date explicit, deci logica de flip/shift se testează fără
layout real.

> **SVG.** `Sparkline` și `CircularProgress` au cerut suport de namespace în
> `raptorjs/dom`: `document.createElement("svg")` produce în browser un element
> HTML necunoscut, care nu randează nimic. `createElement` folosește acum
> `createElementNS` pentru tagurile exclusiv SVG. Tagurile ambigue (`a`, `script`,
> `style`, `title`) nu sunt tratate ca SVG — pentru ele dai namespace-ul explicit
> ca al doilea argument.

### Valul 3 — nucleul de formular și overlay

Componentele pe care le are orice aplicație. Nu toate sunt teze de performanță;
valoarea lor e în detaliile de accesibilitate și comportament pe care fiecare
proiect le rescrie prost.

```ts
import {
  Button, Input, Checkbox, Switch, RadioGroup, Select,
  Form, FormField, field, formGroup, validators,
  Dialog, ConfirmDialog, Popover, Tooltip,
  createToaster, Toaster, Tabs,
} from "raptorjs/ui";
```

#### Formulare — validare derivată

```ts
const email = field("", { validate: [validators.required(), validators.email()], label: "Email" });
const pass  = field("", { validate: validators.minLength(8), label: "Parolă" });
const group = formGroup([email, pass]);

Form({
  group,
  onSubmit: () => api.signup(email.value(), pass.value()),
  children: [
    FormField({ field: email, label: "Email", required: true,
                children: Input({ value: email.value, id: email.id }) }),
    FormField({ field: pass, label: "Parolă",
                children: Input({ value: pass.value, id: pass.id, type: "password" }) }),
    Button({ type: "submit", children: "Creează cont" }),
  ],
});
```

Fiecare regulă e un `derived` peste semnalul câmpului. Nu există „ciclu de
validare" de declanșat, iar o tastare recalculează doar erorile care depind de
acel câmp. **Teza, verificată în test:** un formular cu 30 de câmpuri, o tastare
într-unul singur → `createElement === 0` și exact **un** text-node atins.

- Eroarea apare după prima ieșire din câmp (`validateOnBlur`, implicit `true`) —
  altfel formularul e roșu înainte să fi scris ceva.
- Submit-ul pe un grup invalid marchează toate câmpurile ca atinse și nu rulează.
- `ErrorMessage` stă montat permanent cu `aria-live="polite"`. Dacă ar apărea
  odată cu textul, multe screen readere n-ar anunța nimic.

#### Overlay-uri

`Dialog`, `Popover` și `Tooltip` sunt montate prin `Portal`, deci nu le taie
`overflow` sau `z-index`-ul unui părinte. Când sunt închise **nu există noduri**
pentru ele.

- `Dialog`: `focusTrap`, `aria-modal`, Escape, click pe fundal. **Scroll lock-ul
  are contor**, nu flag: cu două dialoguri suprapuse, închiderea celui de
  deasupra nu redă scroll-ul cât timp cel de dedesubt e deschis.
- `Tooltip` apare la **focus**, nu doar la hover — altfel e invizibil pentru cine
  navighează la tastatură. Escape îl ascunde chiar dacă pointerul e deasupra
  (cerință WCAG). Legat prin `aria-describedby`, nu `aria-label`: un tooltip
  descrie, nu înlocuiește numele elementului.
- `Popover` și `Select` folosesc `positioner`, deci nu se taie la marginea
  ecranului. `DropdownMenu` a fost mutat și el pe `positioner`.

#### Toast-uri

```ts
const toaster = createToaster({ duration: 4000, max: 5 });
Toaster({ toaster, position: "bottom-right" });

toaster.success("Salvat");
toaster.push({ message: "Șters", key: "delete", action: { label: "Anulează", onClick: undo } });
```

Magazinul e al tău, componenta doar îl randează — poți anunța ceva dintr-un
handler de rețea, fără context de componentă. Cronometrele se pun în pauză la
hover: altfel un mesaj citit pe jumătate dispare exact când întinzi mâna după
butonul de acțiune. `key` deduplică în loc să stivuiască același mesaj.
`aria-live="polite"`, nu `assertive` — un toast nu trebuie să întrerupă cititorul
în mijlocul propoziției; erorile critice merg în `Dialog`.

#### Controale

- `Checkbox` acoperă `indeterminate`, care **nu e atribut HTML ci proprietate
  DOM** — setat ca atribut n-ar avea niciun efect, iar arborele de accesibilitate
  ar minți. Componenta setează proprietatea și `aria-checked="mixed"`.
- `Switch` are `role="switch"`, nu checkbox stilizat: un comutator comunică
  „pornește acum", nu „bifează pentru mai târziu".
- `RadioGroup` și `Tabs` folosesc **roving tabindex**: un singur element al
  grupului e în ordinea de Tab, săgețile mută înăuntru. Un set de 8 taburi nu
  trebuie să coste 8 apăsări de Tab ca să-l depășești.
- `Select` are typeahead (tastezi „pi" și sari la „Piersică"), fără de care o
  listă de 200 de țări e inutilizabilă la tastatură.
- `Button` e implicit `type="button"`, nu `submit`. Un `onClick` care întoarce o
  promisiune pune butonul singur în `loading` și blochează clickurile — bug-ul
  clasic al dublei trimiteri.

#### Tabs

`activation: "manual"` (implicit) mută focusul cu săgețile fără să schimbe
panoul; Enter/Space confirmă. Contează când panourile încarcă date. Panourile
inactive rămân în DOM cu `hidden`, deci Ctrl+F le găsește și nu pierzi starea
din ele. `lazy: true` construiește un panou la prima activare și îl ține montat.

### Valul 4 — layout, tipografie, afișare, controale

Tranșa cea mai mare ca număr și cea mai mică ca dificultate. Puține sunt teze de
performanță; valoarea lor e în detaliile pe care fiecare proiect le rescrie prost.

#### Layout

`Box`, `Flex`, `Stack`, `Group`, `Grid`, `SimpleGrid`, `Container`, `Center`,
`Spacer`, `Divider`, `AspectRatio`, `ScrollArea`.

```ts
Stack({ gap: 4, children: [
  Group({ gap: 2, justify: "between", children: [Heading({ level: 2, children: "Proiecte" }), Button({ children: "Nou" })] }),
  SimpleGrid({ minColumnWidth: "240px", children: projects().map(card) }),
]})
```

Spațierea e o **scară de trepte** (`0..8` → 0, 2, 4, 8, 12, 16, 24, 32, 48px), nu
pixeli liberi. O scară mică ținută cu disciplină arată mai bine decât valori
alese ad-hoc, iar `gap: 4` e mai ușor de citit decât `gap: 12px`.

`SimpleGrid` rezolvă responsive-ul fără media queries — `auto-fill` + `minmax`
într-o singură declarație. `ScrollArea` primește `tabindex="0"`, fiindcă o zonă
derulabilă trebuie să fie parcurgibilă de la tastatură (WCAG 2.1.1).

> Props-urile suplimentare trec prin `attrs`, nu printr-un index signature.
> Motivul e tipizarea: cu `[key: string]: unknown`, `Omit<FlexProps, "direction">`
> ar șterge **toți** membrii declarați (`keyof T` devine `string`), iar
> `StackProps` ar pierde `gap`, `align` și restul.

#### Tipografie

`Text`, `Heading`, `Link`, `Code`, `CodeBlock`, `Kbd`, `TextList`, `Truncate`,
`Blockquote`, `Mark`.

**`Heading` separă nivelul semantic de mărimea vizuală.** `level` alege tagul
(`h1`..`h6`), `size` alege cum arată. Fără separarea asta oamenii sar de la `h2`
la `h4` doar ca să obțină text mai mic, iar structura documentului devine de
necitit pentru un screen reader.

`Link` extern primește `rel="noopener noreferrer"` automat, iar `onNavigate`
lasă Ctrl/Cmd+click și click-mijloc în seama browserului. `Mark` evidențiază
potrivirile case-insensitive **păstrând textul original** — evidențierea nu
trebuie să schimbe ce citește utilizatorul.

#### Afișare

`Card`, `Badge`, `Tag`, `Avatar`, `AvatarGroup`, `Stat`, `DescriptionList`,
`Alert`, `Callout`, `Banner`, `EmptyState`, `Result`, `Spinner`, `Skeleton`,
`LoadingOverlay`, `Timeline`, `Image`.

Ce rezolvă, concret:

- `Card` cu `onClick` primește `role="button"` **și** handler de Enter/Space — un
  `div` cu rol de buton nu răspunde singur la tastatură.
- `Badge` cu număr cere `label`: „3" singur nu spune nimic la screen reader. Un
  badge-punct fără etichetă e marcat `aria-hidden`, fiind pur decorativ.
- `Avatar` pune numele **o singură dată**, pe container; imaginea și inițialele
  de dedesubt sunt decorative, altfel ar fi citite de două ori.
- `Stat` are `invertDelta`: la majoritatea metricilor creșterea e bună, la churn
  nu e.
- `Alert` folosește `role="alert"` doar pentru erori; restul sunt `status`, ca să
  nu întrerupă cititorul.
- `Skeleton` e `aria-hidden` — un placeholder nu are ce anunța. Starea de
  încărcare se comunică din containerul cu `aria-busy`, ceea ce face
  `LoadingOverlay`.
- Animațiile de `Skeleton` și `Spinner` se opresc la `prefers-reduced-motion`.

#### Disclosure

`Collapsible` și `Accordion` nu folosesc `<details>`: acela nu poate fi animat și
nu permite modul „un singur panou deschis". Conținutul rămâne în DOM cu `hidden`
(deci Ctrl+F îl găsește și nu pierzi starea din el); `unmount: true` îl
demontează când chiar vrei asta.

Titlul unei secțiuni de `Accordion` e un **heading cu buton înăuntru**, nu un
buton stilizat ca titlu: așa apare în lista de titluri a screen readerului și
rămâne acționabil.

#### Controale, runda a doua

`NumberInput`, `PasswordInput`, `SearchInput`, `PinInput`, `TagsInput`,
`Editable`, `NativeSelect`, `CheckboxGroup`, `SegmentedControl`, `ToggleButton`,
`ToggleGroup`, `CloseButton`, `CopyButton`, `InputGroup`, `Fieldset`,
`HelperText`.

- **`NumberInput` nu produce `0.30000000000000004`.** Rotunjește la precizia
  pasului. Și nu plafonează în timpul tastării — ai bloca scrierea lui `-` sau
  `0.` — ci la `blur`.
- **`PinInput` acceptă un cod lipit întreg.** Utilizatorul copiază `123456` din
  SMS și îl lipește în prima casetă; fără tratarea lui `paste` ar primi un `1`.
- **`SearchInput` debounce-uiește** (250ms implicit), Enter caută imediat,
  Escape golește.
- `PasswordInput`: eticheta butonului descrie **acțiunea** („Arată parola"), nu
  starea — altfel utilizatorul nu știe ce se întâmplă dacă apasă.
- `TagsInput`: virgulă/Enter confirmă, Backspace pe input gol șterge ultimul tag,
  iar ce e în curs de scriere se confirmă la `blur` în loc să se piardă.
- `CheckboxGroup` cu `selectAll` expune `aria-checked="mixed"` pentru starea
  parțială.

#### Primitive de stare

```ts
const theme = persistedState("theme", "light");     // se salvează singur
const doc = undoRedo(initialDoc, { limit: 100 });   // istoric mărginit
const sel = selectionState({ items: () => rows() }); // click/Ctrl/Shift
```

Sunt aici fiindcă fiecare aplicație le rescrie, de fiecare dată cu aceleași trei
bug-uri:

- **`persistedState`** nu aruncă în mod privat sau cu cookies blocate — accesul
  la `localStorage` poate el însuși să arunce, nu doar citirea. O valoare coruptă
  cade pe `initial` în loc să pice aplicația. Sincronizează între file prin
  evenimentul `storage`.
- **`undoRedo`** are limită obligatorie, nu opțională: un editor lăsat deschis o
  zi cu istoric nelimitat ține în memorie fiecare stare intermediară. `replace()`
  modifică fără intrare nouă, pentru mijlocul unui drag.
- **`selectionState`** tratează cazul în care ancora a dispărut după o filtrare:
  Shift+click cade pe click simplu în loc să selecteze un interval aiurea.

### Valul 5 — date, navigare, fișiere, arbori, grafice

Ultimele 30 de componente T1/T2. Cu asta, T1 și T2 sunt complete.

#### Date și oră

`Calendar`, `DatePicker`, `DateRangePicker`, `TimePicker` — plus utilitarele
`addDays`, `addMonths`, `parseIso`, `monthGrid`, `daysInMonth`, exportate și
testabile separat.

**Zero dependințe: fără date-fns, fără luxon.** Formatarea și numele zilelor vin
din `Intl`, care e în runtime, nu în `node_modules`.

```ts
const date = state<CalendarDate | null>(null);
DatePicker({ value: date, min: today(), locale: "ro-RO" });
```

Capcana evitată peste tot: **`new Date("2026-03-15")` e parsată ca UTC** și,
într-un fus la vest de Greenwich, dă 14 martie. Lucrăm cu triplete `{y, m, d}` și
construim `Date` doar prin `new Date(y, m, d)`, care e local. Aritmetica pe zile
nu folosește niciodată `+ 86400000` — o zi nu are mereu 24h. Testele acoperă
trecerile de lună, anii bisecți și `31 ianuarie + 1 lună = 28/29 februarie`.

`DatePicker` acceptă și tastare directă. Text invalid **restaurează** valoarea
anterioară în loc să o șteargă tacit. `TimePicker` folosește segmente separate,
nu `<input type="time">` (care arată diferit în fiecare browser și nu poate fi
stilizat); fiecare segment e un `spinbutton` care ciclează la capete.

#### Navigare

`Breadcrumbs`, `Pagination`, `Stepper`, `Anchor`, `Navbar`, `NavigationMenu`,
`SidebarNav`, `Sidebar`, `AppShell`.

Regula comună: **navigarea e o listă de linkuri**, nu `div`-uri cu `onClick`. Un
`nav` cu `ul`/`li` și `aria-current` spune unui screen reader câte elemente sunt
și unde te afli.

- `paginationRange(page, total, siblings)` e exportată separat — e partea în care
  se greșește și e ușor de testat. Pune elipsă doar când se sar **cel puțin
  două** pagini; altfel afișează numărul.
- `Breadcrumbs`: ultimul element nu e link, e locul unde te afli deja.
- `Stepper`: nu poți sări înainte, fiindcă pașii următori pot depinde de ce
  completezi acum.
- `Anchor` (scroll-spy) nu folosește `IntersectionObserver` cu `threshold`, care
  dă rezultate greșite pentru secțiuni mai înalte decât ecranul: compară pozițiile
  față de o linie la `offset` px de sus.
- `NavigationMenu` deschide submeniul la hover **și** la focus; închiderea are o
  mică întârziere, altfel drumul cu mouse-ul de la buton la submeniu îl închide.
- `AppShell` expune un `<main id="rui-main">` pentru link-ul „sari la conținut".

#### Arbori și liste

`TreeView`, `ListView`, `MultiSelect`, `Autocomplete`, `CommandPalette`.

`TreeView` urmează pattern-ul ARIA tree: săgeata dreapta expandează sau coboară
la primul copil, stânga colapsează sau urcă la părinte, `*` expandează toți
frații. Doar un nod e tabbable — Tab iese din tot arborele, nu trece prin cele
400 de noduri. Suportă încărcare lazy și nu reîncarcă ce a adus deja.

**`Autocomplete` rezolvă cursa dintre cereri.** Dacă tastezi „ab" apoi „abc",
răspunsul pentru „ab" poate sosi *după* cel pentru „abc" și îl suprascrie.
Fiecare cerere primește un număr de ordine și doar cea mai recentă are voie să
scrie rezultatele — există test care livrează răspunsurile în ordine inversă.

`MultiSelect` ține chipurile **în afara** inputului: un chip pus într-un input e
inaccesibil (nu poate fi buton) și se rupe la scroll orizontal.

`CommandPalette` nu înregistrează singură `mod+k` — ți-o legi tu cu `hotkeys`, ca
să nu-ți fure scurtătura fără să știi. Filtrarea resetează selecția, altfel ai
putea rula comanda greșită.

#### Fișiere

`FileInput`, `Dropzone`, `FileList` — cu `validateFiles`, `matchesAccept` și
`formatSize` exportate separat.

Validarea e **aceeași funcție** pentru dialogul de selecție și pentru drag & drop.
Altfel ajungi cu două seturi de reguli care diverg. Limita de număr se aplică
*după* filtrele de tip și mărime, ca un fișier respins să nu consume un loc.

`Dropzone` numără `dragenter`/`dragleave`: evenimentele se declanșează și când
cursorul trece peste un **copil** al zonei, așa că un simplu boolean face zona să
pâlpâie.

#### Overlay-uri rămase

`Drawer`, `ContextMenu`, `Notification`, `Backdrop`, `ErrorBoundary`.

`Drawer` cu `modeless: true` e un panou obișnuit (filtre, detalii): fără focus
trap, fără blocarea scroll-ului, fără `aria-modal`. Un sertar de filtre care
blochează restul paginii e o greșeală frecventă.

`ContextMenu` se deschide și cu tasta Menu sau Shift+F10, nu doar cu mouse-ul.

**`ErrorBoundary` promite doar ce poate ține.** Prinde excepțiile aruncate
sincron când `children()` își construiește nodurile, și reconstruirea după
`retry()`. **NU** prinde erori din handlere de evenimente, din promisiuni
respinse, sau apărute mai târziu într-un `effect` dintr-un binding deja montat —
într-un runtime fine-grained nu există o fază de randare care să poată fi reluată.

#### Grafice

`scaleLinear`, `scaleBand`, `niceTicks`, `extent`, `Axis`, `Legend`, plus
`LineChart`, `AreaChart`, `BarChart`.

```ts
LineChart({
  series: () => [{ label: "Vizite", values: history() }],
  labels: months,
  area: true,
  summary: "Vizite lunare în ultimul an",
});
```

**Teza, verificată în test:** date live într-un `LineChart` rescriu doar atributul
`d` — zero noduri create. Asta a cerut ca plotul să fie `For` keyed pe **indici**
(primitive, deci chei stabile), nu o regiune care remapează serii la fiecare tick.
Aceeași lecție ca la `virtualizer`.

Graficul e `role="img"` cu `aria-label` din `summary`; marcajele axelor sunt
`aria-hidden`, fiindcă un screen reader care citește 40 de numere de pe axă nu
ajută pe nimeni.

> **Limitele lor:** sunt grafice de bază, nu o bibliotecă de vizualizare. Acoperă
> serie în timp și comparație între categorii. Pentru sankey, treemap, hărți sau
> interacțiuni complexe (brush, zoom, pan) ai nevoie de o bibliotecă dedicată, și
> e în regulă.

### Valul 6 — T3: specializatele

Ultima tranșă. **59 din cele 61 de componente T3**; două au fost lăsate
deliberat nefăcute și motivul e mai jos.

#### Ce s-a livrat

**Layout și acțiuni:** `Masonry`, `Affix`, `SafeArea`, `SkipNav`,
`BottomNavigation`, `Dock`, `SplitButton`, `FloatingActionButton`.

**Inputuri specializate:** `MaskedInput`, `CurrencyInput`, `PhoneInput`,
`DateInput`, `Mentions`, `Rating`, `ColorPicker`, `ColorSwatchPicker`,
`TransferList`, `TreeSelect`, `Cascader`.

**Grafice:** `PieChart`, `DonutChart`, `ScatterChart`, `BubbleChart`, `Heatmap`,
`Gauge`, `RadarChart`, `FunnelChart`, `CandlestickChart`, `Treemap`,
`SankeyDiagram`, `Meter`.

**Editoare și vizualizatoare:** `RichTextEditor`, `CodeEditor`, `JsonViewer`,
`DiffViewer`, `ComparisonTable`.

**Media:** `Carousel`, `Gallery`, `Lightbox`, `ImageZoom`, `VideoPlayer`,
`AudioPlayer`, `Waveform`, `QRCode`, `ImageUpload`, `UploadProgress`,
`FilePreview`.

**Restul:** `Kanban`, `Wizard`, `Menubar`, `HoverCard`, `Tour`, `FormSection`,
`ValidationSummary`, `DateTimePicker`, `MonthPicker`, `YearPicker`, plus
primitivele `idle()` și `networkStatus()`.

#### Algoritmii, exportați separat și testați fără DOM

Partea care chiar poate fi greșită nu stă ascunsă în componente:

| Funcție | Ce face |
|---|---|
| `applyMask`, `unmask` | mască de input, cu poziția cursorului |
| `diffLines`, `diffStats` | diff pe linii, prin cea mai lungă subsecvență comună |
| `squarify` | așezare treemap „squarified" (Bruls–Huizing–van Wijk) |
| `sankeyLayout` | adâncimi, debite și curbe pentru diagrama Sankey |
| `arcPath` | sectoare de cerc pentru pie/donut |
| `reedSolomon`, `encodeData`, `buildMatrix` | codificarea QR completă |
| `contrastRatio`, `readableOn` | contrast WCAG și alegerea culorii de text |
| `computePeaks`, `formatDuration` | reducerea eșantioanelor audio, formatarea timpului |
| `activeMention`, `groupDigits`, `formatCurrency` | tokenul `@`, grupări, bani |

#### `QRCode` — generator complet, nu un wrapper

Implementează ISO/IEC 18004 pentru modul byte, versiunile 1–10, toate cele patru
niveluri de corecție: aritmetică în GF(256), coduri Reed-Solomon, întreţeserea
blocurilor, cele opt măști cu scorul lor de penalizare și biții BCH de format.

```ts
QRCode({ value: () => url(), level: "H", label: "Link către pagină" });
```

Codul se randează ca **un singur `path`** — un `<rect>` per modul ar însemna
~1000 de elemente pentru versiunea 5. Testul verifică inclusiv că formatul scris
poate fi citit înapoi corect (deci BCH-ul e bun) și că masca aleasă e cea scrisă.

Părțile astea nu pot fi aproximate: un QR cu Reed-Solomon greșit nu se scanează
deloc, iar unul cu masca prost aleasă se scanează prost.

#### Decizii care merită știute

- **`Kanban` se poate folosi de la tastatură.** Fiecare carte are un meniu
  „Mută în…". Drag & drop-ul singur ar face tabla inutilizabilă fără mouse — e
  eșecul clasic de accesibilitate al acestei componente.
- **`Carousel` oprește autoplay-ul la hover și la focus.** Un carusel care se
  mișcă în timp ce citești încalcă WCAG 2.2.2, nu e doar enervant. Slide-urile
  ascunse primesc `inert`, ca să nu fie tabbable.
- **`ScatterChart` scalează raza bulelor după rădăcina valorii.** Aria trebuie
  să fie proporțională, nu raza — altfel o valoare dublă arată de patru ori mai
  mare. Există test.
- **`CurrencyInput` ține banii în întregi** (bani, cenți). `0.1 + 0.2 !== 0.3`,
  iar o eroare de rotunjire într-un coș de cumpărături e un bug real.
- **`Meter` are `role="meter"`, nu `progressbar`.** Unul măsoară cât de plin e
  ceva, celălalt înaintarea unei sarcini; screen readerele le anunță diferit.
- **`HoverCard` e `dialog`, nu `tooltip`**, fiindcă are conținut interactiv — de
  aici și întârzierea la închidere, ca să poți ajunge cu mouse-ul în el.
- **`applyMask` nu adaugă separatorul final** până nu tastezi caracterul de
  după: altfel cursorul ajunge după o liniuță pe care n-ai scris-o.

#### Limitele declarate

**`RichTextEditor`** folosește `contenteditable` + `document.execCommand`.
`execCommand` e deprecated și produce HTML ușor diferit în fiecare browser.
Alternativa reală — un model de document propriu cu gestiunea selecției, ca
ProseMirror — e un proiect de luni de zile, nu o componentă. Acoperă cazul „câmp
de descriere cu bold și linkuri". Nu sanitizează HTML-ul.

**`Waveform` nu decodează audio.** Decodarea cere `AudioContext` și fișierul
întreg în memorie, ceea ce n-are ce căuta într-o componentă de UI. Calculează
vârfurile pe server sau într-un worker și trimite-le ca `peaks`.

**`diffLines` e O(n·m).** Suficient pentru fișiere de ordinul miilor de linii,
care e cazul pentru care există componenta. Pentru fișiere uriașe ai nevoie de
Myers cu bandă, deci de o bibliotecă dedicată.

**Graficele acoperă cazurile uzuale.** Fără brush, zoom, pan sau axe
logaritmice.

### `Table` — tabel sortabil

```ts
import { Table, type Column } from "raptorjs/ui";
import { state, R, render } from "raptorjs/dom";

interface Row { id: number; name: string; qty: number }
const rows = state<readonly Row[]>([
  { id: 1, name: "Keyboard", qty: 3 },
  { id: 2, name: "Mouse", qty: 10 },
]);

const columns: Column<Row>[] = [
  { key: "name", header: "Name", cell: (r) => r.name,
    sort: (a, b) => a.name.localeCompare(b.name) },
  { key: "qty", header: "Qty", align: "right", cell: (r) => String(r.qty),
    sort: (a, b) => a.qty - b.qty },
];

render(() => Table({ rows: () => rows(), columns, empty: "Nimic aici" }), app);
```

- **Sortarea mută rândurile, nu le reconstruiește.** `For` e keyed pe identitatea
  obiectului-rând, iar sortarea întoarce un array nou cu aceleași referințe —
  deci nodurile existente sunt doar reordonate prin `insertBefore`. Testul din
  `packages/ui/tests/table.test.ts` verifică exact asta: după un click pe header,
  `stats.createElement === 0` și `stats.createText === 0`.
- **O coloană fără `sort` nu e sortabilă** — nu există comparator implicit pe
  string, ca să nu ordonezi greșit numere sau date.
- **Celule reactive:** `cell` poate întoarce un accesor
  (`cell: (r) => () => total(r)`) și atunci se actualizează doar text-node-ul ei.
- **Selecție opțională:** dă-i `selected`, un semnal pe care îl deții tu
  (`state<ReadonlySet<Row>>(new Set())`). Fără el, tabelul n-are selecție.
  `multiple: false` păstrează un singur rând.

> Atenție: fiindcă `For` e keyed pe valoare, rândurile trebuie să fie obiecte
> stabile. Dacă regenerezi obiectele la fiecare citire (`rows().map(...)`),
> reutilizarea nodurilor se pierde.

### `DropdownMenu` — meniu cu tastatură

```ts
import { DropdownMenu, menuItem, menuSeparator } from "raptorjs/ui";

DropdownMenu({
  trigger: "Actions",
  entries: [
    menuItem("Copy", () => copy(), { hint: "Ctrl+C" }),
    menuItem("Paste", () => paste(), { disabled: true }),
    menuSeparator(),
    menuItem("Delete", () => remove()),
  ],
});
```

- **Când e închis nu există noduri pentru el** — meniul e montat prin `Show`.
- **Tastatură:** `ArrowDown`/`ArrowUp` ciclează și sar peste separatoare și
  itemi dezactivați, `Home`/`End`, `Enter`/`Space` selectează, `Escape` închide
  și readuce focusul pe trigger.
- **Click în afară** închide meniul. Handlerele globale sunt atașate pe
  `document` **doar cât timp meniul e deschis** și scoase în `onCleanup`, deci nu
  rămân agățate după `dispose`.
- **ARIA:** `aria-haspopup`, `aria-expanded` (reactiv), `role="menu"`,
  `role="menuitem"`, `aria-disabled`.
- **Controlat din afară:** dă-i `open`, un `State<boolean>` al tău, dacă vrei să
  deschizi meniul programatic.
- Mutarea itemului activ rescrie două atribute; itemii nu se recreează.

---

## @raptor/engine/bundle — bundler TSX propriu (fără Vite)

Bundler-ul propriu al proiectului pentru varianta browser: transformă JSX către
runtime-ul fine-grained `raptorjs/dom`, rezolvă graful (inclusiv `exports` map către
sursa `.ts` a pachetelor `@raptor/*`) și emite un singur `bundle.js`. **Zero
dependențe la runtime**; folosește compilatorul TypeScript doar ca primitivă de
transform la build-time. Fără Vite / esbuild / Rolldown.

**Exportă:** `bundleApp` (+ `BundleOptions`, `BundleResult`), `startDevServer`
(+ `DevServerOptions`), `transpile` (+ `TranspileOptions`, `DEFAULT_JSX_IMPORT_SOURCE`),
`resolveSpecifier`, `rewriteHtml`, `runBundleCli`.

### Proba de fum a catalogului

`examples/site/tests/catalog.test.ts` construiește demo-ul **fiecărei**
componente documentate pe site și verifică faptic că randează. Rulează la
`pnpm test`, ~3,5 secunde.

Ce prinde:

- o componentă care aruncă (raportează grupul și numele exact);
- `NaN` ajuns în output — aritmetică pe valori lipsă, capcana clasică a scalelor
  de grafic;
- un obiect stringificat ca `[object Object]`;
- output gol.

E și un test end-to-end al bundler-ului: paginile de catalog sunt `.tsx`, deci
trec prin RaptorBundle (transform JSX, rezolvare de subpath-uri, tree-shaking)
înainte de a fi evaluate pe mini-dom. Dacă se strică ceva pe lanțul ăla, aici se
vede.

**Cum e ținut onest.** Verificările sunt puține intenționat. Am încercat întâi să
semnalez și `null`/`undefined` randate ca text și am primit patru fals pozitive:
demo-urile de `Select`, `Combobox`, `TreeSelect` și `Cascader` afișează dinadins
`value = null` ca să arate starea inițială. Un test care țipă la conținut corect
e mai rău decât unul care tace la o problemă rară.

Demo-urile sunt montate în containere reale, nu interogate prin `toHTML` pe
valoarea întoarsă: un demo poate întoarce un `Block` (`ErrorBoundary`, `Portal`),
un array sau un accesor — toate sunt `Child` valizi, niciunul nu e element.
Raportul se citește după ce se scurg microtask-urile, fiindcă `ErrorBoundary`
își publică fallback-ul într-un `queueMicrotask`.

Timerele pornite de demo-uri (autoplay de carusel, toast, tooltip) sunt
instrumentate și oprite la final — altfel `node --test` n-ar mai ieși niciodată.

### Tree-shaking

`raptor-bundle` elimină re-exporturile nefolosite **înainte de transpilare**,
pornind de la ce cere entry-ul. Activ implicit; `--no-treeshake` îl oprește.

Măsurat pe o aplicație care folosește un singur `Button`, importat din barrel:

| | Module | Bundle |
|---|---|---|
| `--no-treeshake` | 58 | 527 499 B |
| implicit | **9** | **39 029 B** |
| import adânc (`raptorjs/ui/button`) | 8 | 38 009 B |

**13,5× mai mic**, iar barrel-ul ajunge la 3% de importul adânc. Testele
verifică nu doar dimensiunea, ci și că bundle-ul tăiat se evaluează și dă
același rezultat ca cel întreg.

#### De ce analiza se face pe sursă

Bundler-ul emite CommonJS, unde `export * from "x"` devine
`__exportStar(require("x"), exports)` — o cerere dinamică, imposibil de analizat
static. Așa că citim graful de importuri/exporturi din **sursa ESM**, cât încă
mai e ESM, cu parserul TypeScript (deja dependință de build; nu s-a adăugat
nimic).

Algoritmul: pornim din entry, propagăm ce nume sunt cerute și urmăm **doar
steaua care chiar furnizează simbolul**. Dintr-un barrel cu 35 de
`export * from`, un singur `Button` urmează exact una.

Instrucțiunile tăiate sunt înlocuite cu spații, nu șterse: liniile rămân la
locul lor, deci numerele din source map continuă să corespundă fișierului
original.

#### Ce nu face

**Nu elimină declarații din interiorul unui modul.** Dacă imporți un singur tip
de grafic dintr-un fișier care conține unsprezece, toate unsprezece rămân. Asta
ar cere un graf de dependențe între declarații; granularitatea de modul acoperă
cazul barrel-ului, care e cel care doare. De-asta importul adânc rămâne
recomandat: `raptorjs/ui/chart` aduce doar scale + Line/Area/Bar, nu și cele 11
tipuri din `chart-extra`.

#### Siguranță

Un re-export se taie **doar dacă modulul țintă e fără efecte secundare**. Sursa
adevărului e `"sideEffects": false` din cel mai apropiat `package.json` — toate
pachetele `@raptor/*` îl declară, fiind grafuri de module pure.

Fără declarație, cădem pe o euristică conservatoare: orice instrucțiune de nivel
înalt care nu e declarație (apel, atribuire, `if`, `for`) înseamnă „poate avea
efecte", deci modulul rămâne. Două teste fixează exact acest comportament, în
ambele sensuri.

Mai sunt trei cazuri în care nu se taie nimic, intenționat:

- `import * as ns from "x"` — nu știm ce se folosește din namespace;
- `import "x"` — modulul e cerut tocmai pentru efectele lui;
- un simbol care nu se găsește nicăieri în graf (tip șters la transpilare, sau
  import greșit) — păstrăm toate stelele, ca să nu stricăm build-ul.


### CLI

```bash
# build: un singur fișier + index.html cu scriptul rescris
raptor-bundle build src/main.tsx --out dist/bundle.js --html index.html

# dev: server node:http cu live-reload (SSE) pe fs.watch
raptor-bundle dev src/main.tsx --root . --port 5173
```

În `package.json`-ul aplicației:
```json
{
  "scripts": {
    "dev": "raptor-bundle dev src/main.tsx --root . --port 5173",
    "build": "raptor-bundle build src/main.tsx --out dist/bundle.js --html index.html"
  },
  "devDependencies": { "@raptor/engine/bundle": "workspace:*" }
}
```

### API din cod

```ts
import { bundleApp, startDevServer, transpile } from "@raptor/engine/bundle";

// 1. build programatic → string cu registru de module + require lazy
const { code, files } = bundleApp("/abs/path/src/main.tsx");
//   files = graful inclus (entry primul); code = un singur bundle browser

// 2. dev server (returnează http.Server)
startDevServer({ entry: "src/main.tsx", root: ".", port: 5173 });

// 3. doar transformul (JSX → raptorjs/dom/jsx-runtime, strip de tipuri)
const js = transpile("const x: number = 1; const el = <b>{x}</b>;", "m.tsx");
```

**Cum funcționează:** transform per-modul (JSX + strip de tipuri, prin compilatorul
TS) → descoperă `require("spec")`-urile emise → le rezolvă cu rezolverul Node → le
rescrie la ID-uri numerice interne → împachetează într-un IIFE cu registru și
`require` lazy. Graful `@raptor/*` e ESM închis și zero-dep, deci împachetarea e
completă și deterministă.

**Limitări (v0.1):** fără code-splitting, fără minificare (pentru minificare,
folosește pipeline-ul Căii C / RaptorEngine cu Oxc opțional); tree-shaking-ul
lucrează la nivel de modul, nu de declarație (vezi [Tree-shaking](#tree-shaking));
transportă doar module bundle-abile (`.ts/.tsx/.js/.jsx`), lasă `node:*` și
externii neatinși.

---

## @raptor/wire/codec — primitive de codec

Nivelul cel mai de jos: encodare binară compactă (whitepaper §12). Îl folosești
direct doar dacă scrii un transport sau un codec propriu; altfel `wire-core` îl
împachetează pentru tine.

**Exportă:** `Writer`, `Reader`.

```ts
import { Writer, Reader } from "@raptor/wire/codec";

const w = new Writer();
w.varint(300);          // varint LEB128 (numere mici = 1 byte)
w.zigzag(-7);           // zig-zag pentru întregi cu semn
w.float64(3.14);        // 8 bytes IEEE-754
w.string("hello");      // length-prefixed UTF-8
w.bytes(new Uint8Array([1, 2, 3]));
const buf = w.finish(); // Uint8Array

const r = new Reader(buf);
r.varint();   // 300
r.zigzag();   // -7
r.float64();  // 3.14
r.string();   // "hello"
r.bytes();    // Uint8Array [1,2,3]
```

---

## @raptor/wire — opcodes, Document, protocol

Inima protocolului **state-aware**: operații semantice delta peste un `Document`
versionat, plus Reactive Address Space (RAS) și codec schema-aware.

**Exportă:** `Document`, operațiile (`encodeOp`/`decodeOp`, `encodeOpsBatch`/`decodeOpsBatch`
+ tipurile `SetOp`, `IncOp`, `AppendOp`, `InsertOp`, `RemoveOp`, `MoveOp`, `PatchOp`,
`ClearOp`, `ReplaceOp`, `OpsBatch`), `Opcode`/`FrameType`, `AddressBook`, `SchemaCodec`,
valorile (`writeValue`/`readValue`), protocolul de mesaje (`encodeMessage`/`decodeMessage`,
`encodeOpsFrame`/`decodeOpsFrame`, `peekFrameType`).

### Document versionat + operații delta

Operațiile identifică ținta prin `handle` (obiectul) + `field` (câmpul). Fiecare
`apply` întoarce un `Change` și crește `version`.

```ts
import { Document } from "@raptor/wire";

const doc = new Document();
doc.apply({ kind: "set",    handle: "job:1", field: "progress", value: 10 });
doc.apply({ kind: "inc",    handle: "job:1", field: "progress", delta: 5 }); // 15
doc.apply({ kind: "patch",  handle: "job:1", fields: { name: "build", progress: 40 } });
doc.apply({ kind: "append", handle: "jobs",  value: 1 });
doc.apply({ kind: "insert", handle: "jobs",  index: 0, value: 9 });
doc.apply({ kind: "remove", handle: "jobs",  index: 0 });

doc.get("job:1");    // { name: "build", progress: 40 }
doc.version;         // crește la fiecare aplicare — cheia pentru delta resync
// alte kind-uri: "move", "clear", "replace". applyBatch(batch) setează resultVersion.
```

**Teza state-aware (whitepaper §13):** un `INC` pe un câmp e >10× mai mic pe fir
decât re-serializarea întregului obiect ca JSON, pentru că trimiți *operația*, nu
*documentul*.

### Reactive Address Space (RAS)

Numele de câmp se trimit o singură dată; pe hot path circulă un ID compact
session-scoped.

```ts
import { AddressBook } from "@raptor/wire";

const book = new AddressBook();               // ID-uri compacte din 0x1000
const { address, isNew } = book.assign("job:1.progress"); // alocă / refolosește ID
book.handleOf(address);                        // "job:1.progress"
book.addressOf("job:1.progress");              // address
book.define(0x18A1, "BTC.price");              // fixează o adresă (ex. din manifest)
// Pe fir zboară `address` (varint), nu string-ul de field repetat.
```

### Codec schema-aware (adaptive encoding, v0.2)

Constructorul primește direct un `Schema` = `Record<string, FieldSchema>`.
Tipuri de field: `bool`, `uint`, `int`, `float`, `string`, `percentage` (→ 1 byte),
`money` (int scalat prin `scale`), `enum` (index din `values`).

```ts
import { SchemaCodec } from "@raptor/wire";

const codec = new SchemaCodec({
  progress: { type: "percentage" },
  price:    { type: "money", scale: 2 },
  status:   { type: "enum", values: ["sent", "delivered", "read"] },
});
```

---

## @raptor/wire/server — SDK server RaptorWire

Store reactiv **autoritativ** + `query`/`mutation`/subscription. Serverul deține
adevărul; clienții primesc snapshot + delta.

**Exportă:** `raptorServer`, `PROTOCOL_VERSION`, `ReactiveStore` + tipurile
`RaptorServer`, `RaptorServerOptions`, `QueryDef`, `QueryContext`, `MutationDef`,
`MutationContext`, `ServerConnection`, `Subscription`.

### Definirea unui server

```ts
import { raptorServer, type RaptorServer, type ReactiveStore } from "@raptor/wire/server";

export function buildDashboardApp(): RaptorServer {
  const app = raptorServer({ build: "dashboard-0.1.0" });

  // query = proiecția expusă clientului (ce prefixe de chei poate vedea)
  app.query("dashboard", {
    select: () => ["cpu", "memory", "jobs", "job:"],
  });

  // mutation = comandă tipată client → server
  app.mutation("addJob", {
    authorize: () => true,               // opțional: control de acces
    run: ({ input, store }) => {
      const job = input as { id: number; name: string };
      store.transaction(() => {          // batch atomic → 1 commit pe client
        store.setField(`job:${job.id}`, "name", job.name);
        store.setField(`job:${job.id}`, "progress", 0);
        store.append("jobs", job.id);
      });
      return { ok: true, id: job.id };
    },
  });

  app.mutation("setProgress", {
    run: ({ input, store }) => {
      const { id, progress } = input as { id: number; progress: number };
      store.patch(`job:${id}`, { progress });  // un singur field → delta minim
      return { id, progress };
    },
  });

  // seed inițial
  app.store.setSignal("cpu", 12);
  app.store.setSignal("memory", 40);
  return app;
}
```

### API-ul `ReactiveStore`

```ts
store.setSignal("cpu", 12);                 // scrie un signal scalar
store.setField("job:1", "name", "build");   // scrie un field pe un obiect
store.patch("job:1", { progress: 40 });     // patch parțial de fields
store.append("jobs", 1);                     // adaugă la o colecție
store.remove("jobs", index);                 // scoate din colecție după index
store.transaction(() => { /* ... */ });      // batch atomic (1 commit / frame)
store.doc.get("messages");                   // acces la Document-ul subiacent
```

### Expunere pe transport

```ts
app.serve(link.server);   // leagă serverul de un transport (ex. loopback)
```

---

## @raptor/wire/client — sesiune + replică reactivă

Clientul: handshake, subscription, **replică reactivă** (fiecare handle e un
signal `raptorjs`), reconnect cu delta resync. Include transportul loopback
pentru rulare in-process (teste, demo-uri).

**Exportă:** `RaptorClient` + `RaptorClientOptions`; transport `createLoopback`,
`flushLoopback`, + tipurile `Transport`, `Loopback`, `LoopbackStats`.

```ts
import { createLoopback, flushLoopback, RaptorClient } from "@raptor/wire/client";

// 1. Transport loopback (client ↔ server in-process)
const link = createLoopback();
app.serve(link.server);

// 2. Handshake + subscribe
const client = new RaptorClient(link.client, { build: "web-0.1.0" });
await client.connect();
client.subscribe("dashboard");
await flushLoopback();          // livrează mesajele în coadă

// 3. Citește starea ca SIGNALS reactive
client.signal("cpu")();                       // valoarea curentă
client.signal<number[]>("jobs")();            // array de id-uri
// un effect() pe client.signal(...) se re-rulează la fiecare delta primit

// 4. Metadate de sesiune
client.sessionId;          // id sesiune
client.epoch;              // epoca de conexiune
client.version;            // versiunea Document-ului replicat
client.snapshotsReceived;  // câte snapshot-uri full a primit (buget: 1)

// 5. Mutații tipate
const res = await client.mutate("addJob", { id: 4, name: "notify" });
await flushLoopback();
res.value;   // { ok: true, id: 4 }

// 6. Automatic delta resync la reconnect (v0.2 §14.3)
client.close();                         // offline
app.store.setSignal("cpu", 999);        // schimbare pierdută cât e offline
const link2 = createLoopback();
app.serve(link2.server);
await client.resume(link2.client, "dashboard");  // cere delta de la versiunea cunoscută
await flushLoopback();
// client.snapshotsReceived NU crește: starea s-a recuperat prin delta, nu full resend.
```

---

## End-to-end: server ↔ RaptorWire ↔ client ↔ DOM

Bucla completă din `examples/realtime-dashboard`, headless pe Node:

```ts
import { installMiniDom, resetStats, stats } from "raptorjs/dom/testing";
import { createLoopback, flushLoopback, RaptorClient } from "@raptor/wire/client";
import { buildDashboardApp } from "./app.ts";

const doc = installMiniDom();

// server + transport
const app = buildDashboardApp();
const link = createLoopback();
app.serve(link.server);

// client + subscribe
const client = new RaptorClient(link.client, { build: "web-0.1.0" });
await client.connect();
client.subscribe("dashboard");
await flushLoopback();

// randare fine-grained: leagă client.signal(...) de text-node-uri prin mountChild
const root = doc.createElement("div");
renderDashboard(client, doc, root);   // vezi examples/.../view.ts

// tick live: 1 batch delta → doar textul afectat se mută în DOM
resetStats();
app.store.transaction(() => {
  app.store.setSignal("cpu", 40);
  app.store.patch("job:1", { progress: 55 });
});
await flushLoopback();
stats.createElement;   // 0  — niciun nod recreat
stats.textUpdate;      // exact bindingurile afectate

// măsoară octeții pe fir
link.stats.serverToClientBytes;   // delta RaptorWire (mult sub JSON full-resend)
```

---

## @raptor/engine/compiler — parser `.raptor`, IR, graf semantic

Nucleul semantic **stabil**, independent de bundler. Parsează `.raptor` în Raptor
IR (cu stable IDs), construiește Semantic Application Graph și calculează diff-ul
pentru HMR.

**Exportă:** `parseModule`, `RaptorParseError`; IR (`serializeIR`, `stableId`,
`canonicalize`, `IRNodeKind` + tipuri `IRModule`, `IRComponent`, `IRSignal`,
`IRDerived`, `IRServerSignal`, `IREffect`, `IRElement`, …); expresii
(`parseExpression`, `analyze`, `exprToJs`, `ExprKind`, …); graf (`buildGraph`,
`SemanticGraph`, `GraphNodeKind`, `EdgeType`); diff (`diffModules`, `GraphDiff`,
`ComponentPatch`, `WireChange`).

```ts
import { parseModule, buildGraph, diffModules, serializeIR } from "@raptor/engine/compiler";

// 1. sursă .raptor → IR
const ir = parseModule(source, "App.raptor");
ir.components;                    // IRComponent[] (signals, deriveds, bindings, wire)
console.log(serializeIR(ir));    // formă canonică, serializabilă pentru cache

// 2. IR → graf semantic (module → component → signal → derived → DOM binding)
const graph = buildGraph(ir);
// nodurile au stable IDs; liveness = are drum spre un output observabil?

// 3. diff între două versiuni (baza pentru Stateful Reactive HMR)
const next = parseModule(editedSource, "App.raptor");
const diff = diffModules(ir, next);
diff.componentPatches;   // ce se poate patcha state-preserving
diff.wireChanges;        // schimbări de schemă/RAS
```

> Acest pachet e „creierul": `@raptor/engine`, `@raptor/engine/run` și `@raptor/engine/profile`
> consumă IR-ul și graful de aici. E deliberat separat de orice bundler.

---

## @raptor/engine — build, optimize, codegen, HMR, CLI

Orchestrarea RaptorEngine: optimizer semantic (Dead Signal Elimination, Dependency
Fusion), codegen multi-target (browser/server/wire) **dintr-un singur graf**,
Stateful Reactive HMR, caching reproductibil, manifest, și CLI-ul `raptor`.

**Exportă:** `buildModule`, `buildModuleAsync` (+ `BuildResult`, `BuildOptions`, `Chunk`);
`optimize`; codegen `emitBrowser`/`emitServer`/`emitWireManifest`; `defineConfig`/`resolveConfig`/`BuildProfile`;
`DevEngine`/`formatUpdateLog`; caching `computeCacheKey`/`SemanticCache`/`ENGINE_VERSION`;
`buildManifest`; low-level `NaiveEngine`/`createRolldownEngine`/`loadLowLevelEngine`/`detectToolchain`;
inspect `inspectGraph`/`invalidationTrace`/`formatOptimizationTrace`/`analyzeReport`;
CLI `runCli`/`runCliAsync`.

### Build dintr-un singur graf

```ts
import {
  buildModule, inspectGraph, formatOptimizationTrace,
  analyzeReport, DevEngine, formatUpdateLog,
} from "@raptor/engine";
import { readFileSync } from "node:fs";

const source = readFileSync("App.raptor", "utf8");
const result = buildModule(source, "App.raptor");

console.log(analyzeReport(result));                    // raport lizibil
console.log(formatOptimizationTrace(result.optimization)); // ce a eliminat DSE/Fusion
console.log(inspectGraph(result.graph));               // dump graf semantic

result.browser;        // cod browser generat (rulează pe raptorjs + raptorjs/dom)
result.server.code;    // producers server
result.server.producers;   // [{ address: "BTC.price", ... }]
result.wire;           // manifest RAS (addresses cu schemă)
result.manifest;       // build manifest reproductibil (Appendix B)
result.chunks;         // chunking per profil
result.ir;             // IR-ul (result.ir.components)
```

**Ce face optimizerul** (din `App.raptor` exemplu):
- `unused` derived (fără drum spre output) → **eliminat** de Dead Signal Elimination.
- `label` (consumator unic) → **fuzionat** în binding de Dependency Fusion
  (blocat dacă are `@debug`).
- `price` server signal → adresă RAS `0x18A1` cu schema `money` în manifestul wire.

### Stateful Reactive HMR

```ts
const dev = new DevEngine();
dev.update("App.raptor", source);

// edit de expresie (nu atinge structura) → patch state-preserving
const edited = source.replace("count * 2", "count * 3");
console.log(formatUpdateLog(dev.update("App.raptor", edited)));   // "patched", state păstrat

// edit structural (adaugă un element) → remount, cu MOTIV explicit
const structural = source.replace("<hr/>-ul lipsă", "...");
console.log(formatUpdateLog(dev.update("App.raptor", structural))); // "remount: reason=..."
```

### Build async cu engine low-level opțional (Rolldown/Oxc)

```ts
import { buildModuleAsync, detectToolchain } from "@raptor/engine";

console.log(detectToolchain());   // { rolldown: false, oxc: false } dacă nu-s instalate
// buildModuleAsync detectează dinamic Rolldown/Oxc; fără ele → fallback naiv zero-dep.
const out = await buildModuleAsync(source, "App.raptor", { minify: true });
```

### Caching reproductibil

```ts
import { computeCacheKey, SemanticCache } from "@raptor/engine";

// cheia = source + versiune compiler + profil + target + compat schemă
const key = computeCacheKey({ source, target: "browser", profile: "production" });
const cache = new SemanticCache();
if (!cache.has(key)) cache.set(key, result);
```

---

## @raptor/engine/run — server runtime + SSR + dev server

Leagă `serverSignal` → store reactiv → RaptorWire → client **din același graf**,
plus routing, SSR/resume, sesiuni, observability, și un dev server live (fs.watch
→ HMR prin SSE).

**Exportă:** `RaptorRuntime` (+ `RunConfig`, `ServerSignalDef`, `RuntimeMetrics`,
`RuntimeEvent`, `HttpResult`, `Channel`); `renderComponent`/`renderDocument` (+ `SsrResult`,
`ResumePayload`, `SsrOptions`); `matchRoute`/`RouteDef`; `evalExpr`/`Env`; nod HTTP real
`createNodeServer`/`listen`/`closeServer`; `RaptorDevServer`/`readFirstSseEvent`; CLI `runRunCli`.

### Runtime din build + SSR + server signal reactiv

```ts
import { buildModule } from "@raptor/engine";
import { RaptorRuntime, renderDocument } from "@raptor/engine/run";
import { RaptorClient } from "@raptor/wire/client";

const result = buildModule(source, "App.raptor");
const runtime = RaptorRuntime.fromBuild(result, { initial: { "BTC.price": 60000 } });

// SSR: HTML server-rendered din același graf
const ssr = runtime.ssr("/");
console.log(renderDocument(ssr, ssr.resume.component));

// server signal → RaptorWire → client reactiv
const client = new RaptorClient(runtime.connect());
await client.connect();
client.subscribe("signals");

runtime.produce("BTC.price", 61000);   // serverul produce
// → client.signal("BTC.price")() devine 61000 reactiv

// observability
runtime.metrics;              // { activeConnections, ... }
runtime.log;                  // event log
runtime.shutdown();
```

### Server Node HTTP real

```ts
import { createNodeServer, listen, closeServer } from "@raptor/engine/run";

const server = createNodeServer(runtime);
const { port } = await listen(server, 0);
const res = await fetch(`http://localhost:${port}/`);
await closeServer(server);
```

### Dev server live (HMR prin SSE)

```ts
import { RaptorDevServer } from "@raptor/engine/run";

const dev = new RaptorDevServer({ entry: "App.raptor" });
// fs.watch → recompilare incrementală → diff → push HMR pe /  (SSE)
// clientul face swap pe #raptor-root; SSR se re-randează.
```

CLI echivalent: `pnpm raptor:dev examples/raptorengine-app/src/App.raptor`.

---

## @raptor/engine/profile — telemetrie + PGO

Colectează telemetrie runtime (frecvența signalelor, fan-out de derived, co-usage
de rute, payload wire, DOM bursts) și emite un **plan de hints de strategie**
(chunk folding, preload, batch, encoding) consumat de `buildModule({ planHints })`.

> **Regula de aur (whitepaper §24): adaptive *strategies*, nu adaptive *correctness*.**
> Ce nu apare în profil e **păstrat**, niciodată eliminat. Profilul nu schimbă
> vreodată corectitudinea, doar strategia.

**Exportă:** `Profiler`/`DEFAULT_THRESHOLDS`; `runScenario`/`wireByteSize` (+ `Scenario`,
`ScenarioStep`); `planFromProfile`/`DEFAULT_PLAN_OPTIONS` (+ `PlanResult`, `PlanContext`,
`PlanOptions`); `emptyProfile`/`serializeProfile`/`PROFILE_VERSION`; CLI `runProfileCli`.

### Bucla PGO completă

```ts
import { buildModule } from "@raptor/engine";
import { RaptorRuntime } from "@raptor/engine/run";
import { Profiler, runScenario, planFromProfile, serializeProfile } from "@raptor/engine/profile";

const result = buildModule(source, "App.raptor");
const runtime = RaptorRuntime.fromBuild(result, { initial: { "BTC.price": 60000 } });

// 1. rulează un scenariu reprezentativ pe runtime, colectând telemetrie
const profiler = new Profiler(result.graph);
runScenario(runtime, profiler, {
  sessions: [
    [{ visit: "/" }, { produce: { address: "BTC.price", value: 60250 } }],
    [{ visit: "/" }, { produce: { address: "BTC.price", value: 60875 } }],
  ],
});
const profile = profiler.finish();
console.log(serializeProfile(profile));   // raptor.profile

// 2. profil → plan de hints (strategie)
const plan = planFromProfile(profile, {
  routes: [{ path: "/", component: "App" }],
  components: result.ir.components.map((c) => c.name),
  serverSignals: result.server.producers.map((p) => p.address),
});
plan.hints.preloadRoutes;
plan.hints.encodingSpecialization;
plan.hints.batchSizes;
plan.keptDespiteUnseen;    // dovada §24: păstrat deși nevăzut în profil

// 3. rebuild profile-guided
const guided = buildModule(source, "App.raptor", { planHints: plan.hints });
guided.manifest.hintsApplied;
guided.wire.addresses;      // adresele rămân — corectitudinea nu depinde de profil
```

---

## @raptor/test — testare comportamentală autonomă

Descoperă singur comportamentul aplicației, sintetizează un backend digital twin
stateful și explorează spațiul de stări:
`observe → infer → synthesize → explore → verify → replay`. **Fără teste scrise de mână.**

**Exportă:** `RaptorTest` (+ `RaptorTestConfig`, `ScenarioResult`, `Finding`);
`VirtualClock`; `VirtualDB`/`RaptorTwin` (+ `TwinRequest`, `TwinResponse`, `RouteHandler`);
`NetworkController`/`defaultSchedule`/`DEFAULT_TIMING`; `BehaviorGraph`/`stateId`;
`Coverage`; explorer `actionScore`/`pickBest`; oracle (`evaluate`, `BUILTIN_INVARIANTS`,
`noExceptions`, `noInfiniteLoading`, `Invariant`, …); `chaosSchedules`; replay
`serializeCapsule`/`parseCapsule`; semantic (`semanticId`, `stableKey`, `actionId`, …);
+ tipurile din `types.ts` (`AppHarness`, `Capsule`, `ProbeEvent`, `NetworkSchedule`, …).

### Ciclul autonom complet

```ts
import { RaptorTest, serializeCapsule } from "@raptor/test";
import { buildCartApp } from "./app.ts";

const app = buildCartApp();       // furnizează harness + twin + invariants
const rt = new RaptorTest({
  harness: app.harness,
  twin: app.twin,
  invariants: app.invariants,
  maxDepth: 3,
  buildFingerprint: "cart@demo",
});

// 1. descoperire autonomă de secvențe (BFS ghidat de coverage)
const sequences = rt.discover();
rt.coverage.count("uiStates");
rt.coverage.count("transitions");
rt.coverage.count("apiInteractions");

// 2. explorare + chaos (RaptorChaos) + oracle (RaptorOracle) → capsule
const findings = rt.explore();
for (const finding of findings) {
  const c = finding.capsule;
  c.failedOracle;      // ce invariant a picat
  c.actionLog;         // reproducere MINIMIZATĂ
  c.detail;

  // 3. replay determinist (timp virtual → reproducere identică)
  const replay = rt.replay(c);
  replay.reproduced;   // true
}

// 4. artefact executabil .raptorcap
if (findings.length > 0) {
  console.log(serializeCapsule(findings[0].capsule));
}
```

### Ce descoperă autonom (din demo)

- **Bug stale-read RT-184:** `Add to cart` → navigare imediată → un `GET /cart`
  întârziat suprascrie UI-ul cu starea veche (UI arată 0, serverul are 1).
  Minimizat la 2 acțiuni, reprodus determinist dintr-o capsulă `.raptorcap`.
- **Bug de robustețe:** la `POST 500`, aplicația citește orbește `.count` dintr-un
  răspuns de eroare.

Totul e determinist prin **timp virtual** (`VirtualClock` = scheduler discret de
evenimente): aceeași capsulă → identic aceeași execuție.

### Componente refolosibile

```ts
import { VirtualClock, RaptorTwin, VirtualDB, Coverage, evaluate, BUILTIN_INVARIANTS } from "@raptor/test";

const clock = new VirtualClock();          // scheduler discret determinist
const db = new VirtualDB();                 // stare backend in-memory
const twin = new RaptorTwin(db, routes);    // backend digital twin din rute observate
const cov = new Coverage();                 // urmărește uiStates / transitions / apiInteractions
evaluate(BUILTIN_INVARIANTS, context);      // rulează oracolele pe o stare
```

---

## Formatul `.raptor`

Un fișier `.raptor` descrie o componentă declarativ; compilerul o descompune în
signals / deriveds / server signals / bindings și generează browser + server + wire
dintr-un singur graf.

```raptor
component App {
  const count = state(0)
  const doubled = derived(() => count * 2)          // 2 consumatori → supraviețuiește fuziunii
  const label = derived(() => "clicks: " + count)   // consumator unic → fuzionat în binding
  const unused = derived(() => doubled + count + 999) // fără output → eliminat (DSE)
  const price = serverSignal("BTC.price", schema.money) // → schemă + adresă RAS în manifest

  <div class="app">
    <button on:click={count++}>increment</button>
    <span class="count">{label}</span>
    <span class="double" data-value={doubled}>doubled = {doubled}</span>
    <span class="price">price = {price}</span>
  </div>
}
```

- `state(v)` — signal local mutabil.
- `derived(() => expr)` — valoare derivată; fuzionată dacă are consumator unic
  (blocată la `@debug`); eliminată dacă nu ajunge la un output observabil.
- `serverSignal("addr", schema.T)` — signal produs de server; devine o adresă RAS
  cu schemă în manifestul wire.
- `on:click={count++}` — event binding; `{expr}` în markup — text/attr binding fine-grained.

Compilează-l cu `buildModule(source, "App.raptor")` sau CLI `raptor build`.

---

## Referință CLI

Trei CLI-uri, expuse prin scripturi npm și ca binare `raptor` / `raptor-run` / `raptor-profile`.

### `raptor` (build/inspect — `@raptor/engine`)

```bash
pnpm raptor build   examples/raptorengine-app/src/App.raptor --report
pnpm raptor inspect graph examples/raptorengine-app/src/App.raptor
pnpm raptor analyze examples/raptorengine-app/src/App.raptor
pnpm raptor toolchain          # detectează Rolldown/Oxc instalate
```

### `raptor:run` (server runtime — `@raptor/engine/run`)

```bash
pnpm raptor:run info examples/raptorengine-app/src/App.raptor
pnpm raptor:run ssr  examples/raptorengine-app/src/App.raptor    # emite HTML SSR
pnpm raptor:dev      examples/raptorengine-app/src/App.raptor    # dev server live (HMR/SSE)
```

### `raptor:profile` (PGO — `@raptor/engine/profile`)

```bash
pnpm raptor:profile examples/raptorengine-app/src/App.raptor
```

### Engine low-level opțional (Rolldown/Oxc)

```bash
cd integrations/rolldown && npm install && npm run verify
# semantic RaptorEngine → Rolldown bundle → Oxc minify
```

---

*Vezi și [`README.md`](../README.md) (arhitectură), [`SPEC-RaptorWire-v0.2.md`](../SPEC-RaptorWire-v0.2.md)
(protocol) și whitepaper-urile din [`design/`](../design/).*
