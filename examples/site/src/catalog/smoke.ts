/**
 * Proba de fum a catalogului: construieste demo-ul FIECAREI componente
 * documentate si raporteaza ce crapa.
 *
 * Nu e cod de aplicatie — nimic nu-l importa, deci nu ajunge in bundle-ul
 * site-ului. E punctul de intrare pe care `tests/catalog.test.ts` il da
 * bundler-ului, fiindca paginile de catalog sunt `.tsx` si au nevoie de
 * transformul JSX ca sa poata fi rulate in Node.
 *
 * Rostul: cele ~200 de demo-uri sunt singurul loc in care componentele sunt
 * chemate cu props realiste. Un test care le construieste pe toate prinde
 * instant orice regresie — o componenta care arunca, un grafic care produce
 * `NaN`, un obiect ajuns stringificat in text.
 */
import { mountChild } from "@raptor/dom";
import { CATALOG } from "./index.ts";

export interface DemoFailure {
  group: string;
  name: string;
  reason: string;
}

export interface SmokeReport {
  ok: number;
  failures: DemoFailure[];
  /** Cate demo-uri au produs SVG, pe grup (pentru grafice). */
  svg: Record<string, number>;
}

/**
 * Sabloane care inseamna sigur o randare gresita.
 *
 * Lista e scurta INTENTIONAT. Am incercat intai sa semnalez si `null` sau
 * `undefined` randate ca text si am primit patru fals pozitive: demo-urile de
 * `Select`, `Combobox`, `TreeSelect` si `Cascader` afiseaza dinadins
 * `value = null` ca sa arate starea initiala. Un test care tipa la continut
 * corect e mai rau decat unul care tace la o problema rara.
 */
const SUSPECT = [
  { pattern: "NaN", reason: "output cu NaN (aritmetica pe valori lipsa)" },
  { pattern: "[object Object]", reason: "obiect stringificat in text" },
];

interface Mounted {
  group: string;
  name: string;
  host: { toHTML(): string };
}

export async function runCatalogSmoke(): Promise<SmokeReport> {
  const doc = (globalThis as { document?: any }).document;
  const failures: DemoFailure[] = [];
  const mounted: Mounted[] = [];

  // Pasul 1: construim tot. Montam in containere reale in loc sa cerem
  // `toHTML` pe valoarea intoarsa: un demo poate intoarce un `Block`
  // (ErrorBoundary, Portal), un array sau un accesor — toate sunt `Child`
  // valizi, dar niciunul nu e element.
  for (const group of CATALOG) {
    for (const item of group.items) {
      try {
        const host = doc.createElement("div");
        mountChild(host, item.demo(), null);
        mounted.push({ group: group.title, name: item.name, host });
      } catch (error) {
        failures.push({
          group: group.title,
          name: item.name,
          reason: (error as Error)?.message ?? String(error),
        });
      }
    }
  }

  // Pasul 2: lasam microtask-urile sa se scurga. `ErrorBoundary` isi publica
  // fallback-ul intr-un `queueMicrotask`, deci la prima randare sincrona e gol
  // pe bune — nu e un bug, e felul in care prinde eroarea fara sa invalideze
  // regiunea in timpul evaluarii ei.
  await Promise.resolve();
  await Promise.resolve();

  // Pasul 3: inspectam.
  const svg: Record<string, number> = {};
  let ok = 0;

  for (const entry of mounted) {
    const html = entry.host.toHTML();
    if (html.length < 12) {
      failures.push({ group: entry.group, name: entry.name, reason: "output gol" });
      continue;
    }
    const suspect = SUSPECT.find((s) => html.includes(s.pattern));
    if (suspect) {
      failures.push({ group: entry.group, name: entry.name, reason: suspect.reason });
      continue;
    }
    if (html.includes("<svg")) svg[entry.group] = (svg[entry.group] ?? 0) + 1;
    ok++;
  }

  return { ok, failures, svg };
}

// Rulat ca punct de intrare al bundle-ului: lasam promisiunea unde o poate
// astepta testul, dupa ce evalueaza codul emis.
(globalThis as Record<string, unknown>).__catalogSmoke = runCatalogSmoke();
