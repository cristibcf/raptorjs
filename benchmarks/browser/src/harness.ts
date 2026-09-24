/**
 * Harness js-framework-benchmark in browser real. Monteaza RaptorJS, React 19,
 * Preact 10 si Solid 1.9 in containere reale si masoara timpul de la actiune
 * pana dupa paint (dublu requestAnimationFrame), ca in benchmark-ul oficial.
 */
import type { BenchApp, MountApp } from "./contract.ts";
import { mountRaptor } from "./apps/raptor.ts";
import { mountReact } from "./apps/react.ts";
import { mountPreact } from "./apps/preact.ts";
import { mountSolid } from "./apps/solid.tsx";

interface FrameworkDef {
  name: string;
  mount: MountApp;
  color: string;
}

const FRAMEWORKS: FrameworkDef[] = [
  { name: "RaptorJS", mount: mountRaptor, color: "#e8590c" },
  { name: "React 19", mount: mountReact, color: "#149eca" },
  { name: "Preact 10", mount: mountPreact, color: "#673ab8" },
  { name: "Solid 1.9", mount: mountSolid, color: "#2c4f7c" },
];

interface OpDef {
  key: string;
  label: string;
  setup: (a: BenchApp) => void;
  action: (a: BenchApp) => void;
  /** Validare optionala dupa actiune. */
  expect?: (a: BenchApp) => boolean;
}

const OPS: OpDef[] = [
  { key: "create1k", label: "create 1,000", setup: (a) => a.clear(), action: (a) => a.run(1000), expect: (a) => a.count() === 1000 },
  { key: "update10th", label: "update every 10th", setup: (a) => a.run(1000), action: (a) => a.update() },
  { key: "select", label: "select row", setup: (a) => a.run(1000), action: (a) => a.select(1) },
  { key: "swap", label: "swap rows", setup: (a) => a.run(1000), action: (a) => a.swap() },
  { key: "remove", label: "remove row", setup: (a) => a.run(1000), action: (a) => a.remove(1), expect: (a) => a.count() === 999 },
  { key: "create10k", label: "create 10,000", setup: (a) => a.clear(), action: (a) => a.run(10000), expect: (a) => a.count() === 10000 },
  { key: "append1k", label: "append 1,000", setup: (a) => a.run(10000), action: (a) => a.append(1000), expect: (a) => a.count() === 11000 },
  { key: "clear10k", label: "clear 10,000", setup: (a) => a.run(10000), action: (a) => a.clear(), expect: (a) => a.count() === 0 },
];

const WARMUP = 3;
const REPEAT = 12;

/** Dispersia ultimei masuratori (%), ca rularile prea agitate sa fie vizibile. */
let lastSpreadPct = 0;
/** Dispersia per celula, expusa odata cu rezultatele. */
const spreads: Record<string, Record<string, number>> = {};

// --- utilitare de timing ---------------------------------------------------
// Cedeaza executia ca browserul sa aplice layout/paint intre iteratii. NU e in
// regiunea masurata (requestAnimationFrame e throttled cand pane-ul nu e vizibil,
// deci l-am scos din timing).
function settle(): Promise<void> {
  return new Promise((res) => setTimeout(res, 0));
}

/**
 * Estimator: minimul, nu mediana.
 *
 * Zgomotul unui browser (GC, un alt tab, compositor, throttling) doar *adauga*
 * timp; nu scade niciodata sub costul real al codului. Deci cea mai rapida
 * rulare observata este cea mai buna aproximare a acelui cost, iar mediana
 * amesteca semnal cu interferenta. Raportam si dispersia, ca sa se vada cand
 * mediul a fost prea agitat pentru ca numarul sa insemne ceva.
 */
function best(xs: number[]): number {
  return xs.reduce((a, b) => (b < a ? b : a), Infinity);
}

function spreadPct(xs: number[]): number {
  const lo = best(xs);
  return lo === 0 ? 0 : ((Math.max(...xs) - lo) / lo) * 100;
}

/**
 * Masuram timpul SINCRON de commit al fiecarui framework. Toate aplica
 * mutatiile sincron in `action` (React flushSync, Preact/Solid/Raptor sincron),
 * deci asta capteaza exact costul de update JS (reconciliere vs fine-grained) —
 * partea care difera — fara zgomotul async de paint.
 */
async function measure(app: BenchApp, op: OpDef): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < WARMUP + REPEAT; i++) {
    op.setup(app);
    await settle();
    const t0 = performance.now();
    op.action(app);
    const dt = performance.now() - t0;
    if (op.expect && !op.expect(app)) {
      throw new Error(`[${op.key}] validare esuata (count=${app.count()})`);
    }
    if (i >= WARMUP) times.push(dt);
    await settle();
  }
  lastSpreadPct = spreadPct(times);
  return best(times);
}

// --- DOM harness -----------------------------------------------------------
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

const stage = $("#stage");
const statusEl = $("#status");
const resultsBody = $("#results tbody");
const resultsHead = $("#results thead tr");

interface Mounted {
  def: FrameworkDef;
  app: BenchApp;
  container: HTMLElement;
}

const mounted = new Map<string, Mounted>();

function getMounted(def: FrameworkDef): Mounted {
  let m = mounted.get(def.name);
  if (!m) {
    const container = document.createElement("div");
    container.className = "stage-app";
    container.style.display = "none";
    stage.appendChild(container);
    const app = def.mount(container);
    m = { def, app, container };
    mounted.set(def.name, m);
  }
  return m;
}

function showOnly(name: string): void {
  for (const m of mounted.values()) {
    m.container.style.display = m.def.name === name ? "block" : "none";
  }
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

// --- tabel rezultate -------------------------------------------------------
const results: Record<string, Record<string, number>> = {};

function buildResultsTable(): void {
  resultsHead.innerHTML =
    "<th>Operatie</th>" + FRAMEWORKS.map((f) => `<th>${f.name}</th>`).join("");
  resultsBody.innerHTML = OPS.map(
    (op) =>
      `<tr data-op="${op.key}"><td class="op">${op.label}</td>` +
      FRAMEWORKS.map((f) => `<td data-fw="${f.name}" class="num">–</td>`).join("") +
      "</tr>",
  ).join("");
  // Rand geomean.
  resultsBody.innerHTML +=
    `<tr class="geo"><td class="op">geo. mean (ms)</td>` +
    FRAMEWORKS.map((f) => `<td data-fw="${f.name}" class="num">–</td>`).join("") +
    "</tr>";
}

function setCell(opKey: string, fw: string, ms: number): void {
  const row = resultsBody.querySelector(`tr[data-op="${opKey}"]`)!;
  const cell = row.querySelector(`td[data-fw="${fw}"]`) as HTMLElement;
  cell.textContent = ms.toFixed(1);
  (results[opKey] ||= {})[fw] = ms;
  highlightRow(opKey);
}

function highlightRow(opKey: string): void {
  const row = resultsBody.querySelector(`tr[data-op="${opKey}"]`)!;
  const vals = FRAMEWORKS.map((f) => results[opKey]?.[f.name]).filter((v) => v != null) as number[];
  if (!vals.length) return;
  const best = Math.min(...vals);
  for (const f of FRAMEWORKS) {
    const cell = row.querySelector(`td[data-fw="${f.name}"]`) as HTMLElement;
    const v = results[opKey]?.[f.name];
    cell.classList.toggle("best", v != null && v === best);
  }
}

// Floor sub-rezolutie: performance.now() poate da 0 pentru operatii foarte
// rapide (ex. select fine-grained). Punem un prag mic ca media geometrica sa
// ramana reprezentativa in loc sa colapseze la 0.
const EPS = 0.05;
function geomeanOf(fw: string): number {
  const vals = OPS.map((op) => results[op.key]?.[fw]).filter((v) => v != null) as number[];
  if (vals.length !== OPS.length) return NaN;
  return Math.exp(vals.reduce((s, v) => s + Math.log(Math.max(v, EPS)), 0) / vals.length);
}

function updateGeomean(): void {
  const geoRow = resultsBody.querySelector("tr.geo")!;
  for (const f of FRAMEWORKS) {
    const cell = geoRow.querySelector(`td[data-fw="${f.name}"]`) as HTMLElement;
    const geo = geomeanOf(f.name);
    cell.textContent = Number.isNaN(geo) ? "–" : geo.toFixed(2);
  }
  // Highlight best geomean.
  const geoVals = FRAMEWORKS.map((f) => geomeanOf(f.name));
  const best = Math.min(...geoVals.filter((v) => !Number.isNaN(v)));
  FRAMEWORKS.forEach((f, i) => {
    const cell = geoRow.querySelector(`td[data-fw="${f.name}"]`) as HTMLElement;
    cell.classList.toggle("best", geoVals[i] === best);
  });
}

// --- rulare completa -------------------------------------------------------
let running = false;

async function runAll(): Promise<void> {
  if (running) return;
  running = true;
  ($("#runAll") as HTMLButtonElement).disabled = true;
  results && Object.keys(results).forEach((k) => delete results[k]);
  buildResultsTable();

  for (const def of FRAMEWORKS) {
    const m = getMounted(def);
    showOnly(def.name);
    for (const op of OPS) {
      setStatus(`${def.name} · ${op.label} …`);
      await settle();
      try {
        const ms = await measure(m.app, op);
        setCell(op.key, def.name, ms);
        (spreads[op.key] ??= {})[def.name] = lastSpreadPct;
      } catch (err) {
        setStatus(`${def.name} · ${op.label}: EROARE — ${(err as Error).message}`);
        console.error(err);
      }
      updateGeomean();
    }
    m.app.clear();
  }

  setStatus("Gata. (mai putin = mai bine; verde = cel mai rapid pe rand)");
  ($("#runAll") as HTMLButtonElement).disabled = false;
  running = false;
  exposeResults();
}

/**
 * Acces direct la o aplicatie montata, pentru masuratori punctuale A/B din
 * consola: comparatiile pe o singura operatie au nevoie de mult mai multe
 * repetari decat o rulare completa, si de propriul estimator.
 */
(window as any).__BENCH_APP__ = (name: string) =>
  getMounted(FRAMEWORKS.find((f) => f.name === name)!).app;

function exposeResults(): void {
  (window as any).__BENCH_RESULTS__ = {
    frameworks: FRAMEWORKS.map((f) => f.name),
    ops: OPS.map((o) => ({ key: o.key, label: o.label })),
    results,
    spreads,
    ua: navigator.userAgent,
  };
}

// --- mod manual ------------------------------------------------------------
function buildManualControls(): void {
  const fwBar = $("#fwBar");
  fwBar.innerHTML = FRAMEWORKS.map(
    (f, i) => `<button class="fw" data-fw="${f.name}" style="--c:${f.color}">${f.name}</button>`,
  ).join("");
  let active = FRAMEWORKS[0]!.name;

  function activate(name: string): void {
    active = name;
    getMounted(FRAMEWORKS.find((f) => f.name === name)!);
    showOnly(name);
    for (const b of fwBar.querySelectorAll("button.fw")) {
      b.classList.toggle("active", (b as HTMLElement).dataset.fw === name);
    }
  }

  fwBar.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button.fw") as HTMLElement | null;
    if (btn) activate(btn.dataset.fw!);
  });

  const opBar = $("#opBar");
  const manualOps: Array<{ label: string; fn: (a: BenchApp) => void }> = [
    { label: "create 1k", fn: (a) => a.run(1000) },
    { label: "create 10k", fn: (a) => a.run(10000) },
    { label: "append 1k", fn: (a) => a.append(1000) },
    { label: "update 10th", fn: (a) => a.update() },
    { label: "select #2", fn: (a) => a.select(1) },
    { label: "swap", fn: (a) => a.swap() },
    { label: "remove #2", fn: (a) => a.remove(1) },
    { label: "clear", fn: (a) => a.clear() },
  ];
  opBar.innerHTML = manualOps.map((o, i) => `<button class="op" data-i="${i}">${o.label}</button>`).join("");
  opBar.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest("button.op") as HTMLElement | null;
    if (!btn) return;
    const m = getMounted(FRAMEWORKS.find((f) => f.name === active)!);
    const op = manualOps[Number(btn.dataset.i)]!;
    await settle();
    const t0 = performance.now();
    op.fn(m.app);
    const dt = performance.now() - t0;
    await settle();
    setStatus(`${active} · ${op.label}: ${dt.toFixed(1)} ms · ${m.app.count()} randuri`);
  });

  activate(active);
}

// --- init ------------------------------------------------------------------
buildResultsTable();
buildManualControls();
($("#runAll") as HTMLButtonElement).addEventListener("click", () => void runAll());
setStatus("Gata de rulare. Apasa „Ruleaza tot” sau foloseste butoanele manuale.");
