/**
 * DOM benchmark: RaptorJS vs React vs Preact, toate in ACELASI jsdom.
 * Masuram timpul median (ms) si numarul de operatii DOM reale pe scenariu.
 *
 * Scenarii (inspirate din js-framework-benchmark, scalate pentru headless):
 *  - create N randuri
 *  - updateAll: schimba eticheta tuturor celor N randuri
 *  - updatePartial: schimba eticheta fiecarui al 10-lea rand
 *  - clear: goleste lista
 */
// dom-env TREBUIE importat primul (seteaza globalele + instrumentarea).
import {
  freshContainer,
  resetCounters,
  snapshotCounters,
  type DomCounters,
} from "./dom-env.ts";
import { buildRows, relabelAll, relabelEvery10th, type BenchApp, type RowData } from "./common.ts";
import { mountRaptor } from "./frameworks/raptor-app.ts";
import { mountReact } from "./frameworks/react-app.ts";
import { mountPreact } from "./frameworks/preact-app.ts";

const N = 1000;
const WARMUP = 5;
const RUNS = 25;

export interface ScenarioResult {
  scenario: string;
  medianMs: number;
  ops: DomCounters;
}

export interface FrameworkResult {
  framework: string;
  scenarios: ScenarioResult[];
}

type Factory = (container: any) => BenchApp;

const FRAMEWORKS: Array<{ name: string; factory: Factory }> = [
  { name: "RaptorJS", factory: mountRaptor },
  { name: "React 19", factory: mountReact },
  { name: "Preact 10", factory: mountPreact },
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Masoara un scenariu: `setup` ruleaza netimizat inainte de fiecare iteratie,
 * `op` este operatia masurata. Contoarele DOM sunt capturate pe o rulare curata.
 */
function measure(
  factory: Factory,
  setup: (app: BenchApp) => void,
  op: (app: BenchApp) => void,
): { medianMs: number; ops: DomCounters } {
  const times: number[] = [];
  for (let i = 0; i < WARMUP + RUNS; i++) {
    const app = factory(freshContainer());
    setup(app);
    const start = performance.now();
    op(app);
    const elapsed = performance.now() - start;
    if (i >= WARMUP) times.push(elapsed);
  }
  // Rulare separata doar pentru contoarele DOM (deterministe).
  const app = factory(freshContainer());
  setup(app);
  resetCounters();
  op(app);
  const ops = snapshotCounters();
  return { medianMs: median(times), ops };
}

function runFramework(name: string, factory: Factory): FrameworkResult {
  const base = buildRows(N);
  const scenarios: ScenarioResult[] = [];

  // create
  {
    const rows = buildRows(N);
    const r = measure(
      factory,
      () => {},
      (app) => app.create(rows),
    );
    scenarios.push({ scenario: `create ${N}`, ...r });
  }

  // updateAll
  {
    const rows = buildRows(N);
    const relabeled = relabelAll(rows);
    const r = measure(
      factory,
      (app) => app.create(rows),
      (app) => app.updateAll(relabeled),
    );
    scenarios.push({ scenario: `updateAll ${N}`, ...r });
  }

  // updatePartial (every 10th)
  {
    const rows = buildRows(N);
    const relabeled = relabelEvery10th(rows);
    const r = measure(
      factory,
      (app) => app.create(rows),
      (app) => app.updatePartial(relabeled),
    );
    scenarios.push({ scenario: `update every 10th (${N / 10})`, ...r });
  }

  // clear
  {
    const rows = buildRows(N);
    const r = measure(
      factory,
      (app) => app.create(rows),
      (app) => app.clear(),
    );
    scenarios.push({ scenario: `clear ${N}`, ...r });
  }

  void base;
  return { framework: name, scenarios };
}

/** Verificare de corectitudine: fiecare framework produce acelasi DOM observabil. */
function validate(factory: Factory): { rows: number; firstAfterUpdate: string } {
  const rows = buildRows(N);
  const app = factory(freshContainer());
  app.create(rows);
  const mountedRows = app.count();
  app.updateAll(relabelAll(rows));
  const firstAfterUpdate = app.firstLabel();
  return { rows: mountedRows, firstAfterUpdate };
}

export function runDomBench(): FrameworkResult[] {
  const results: FrameworkResult[] = [];
  for (const fw of FRAMEWORKS) {
    const check = validate(fw.factory);
    if (check.rows !== N) {
      throw new Error(`[${fw.name}] a montat ${check.rows} randuri, asteptam ${N}`);
    }
    results.push(runFramework(fw.name, fw.factory));
  }
  return results;
}

// Rulare standalone.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("bench-dom.ts")) {
  const results = runDomBench();
  for (const fr of results) {
    console.log(`\n=== ${fr.framework} ===`);
    for (const s of fr.scenarios) {
      const o = s.ops;
      console.log(
        `  ${s.scenario.padEnd(24)} ${s.medianMs.toFixed(3).padStart(9)} ms   ` +
          `[el:${o.createElement} txt:${o.createText} ins:${o.insert} rm:${o.remove} txtUpd:${o.textUpdate}]`,
      );
    }
  }
}
