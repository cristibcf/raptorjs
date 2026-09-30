/**
 * The catalog smoke test: it builds the demo of EVERY documented component
 * and reports what breaks.
 *
 * It is not application code — nothing imports it, so it never reaches the
 * site's bundle. It is the entry point that `tests/catalog.test.ts` hands to
 * the bundler, because the catalog pages are `.tsx` and need the JSX transform
 * to be runnable in Node.
 *
 * The point: the ~200 demos are the only place where the components are called
 * with realistic props. A test that builds them all instantly catches any
 * regression — a component that throws, a chart that produces `NaN`, an object
 * that ends up stringified in the text.
 */
import { mountChild } from "raptorjs/dom";
import { CATALOG } from "./index.ts";

export interface DemoFailure {
  group: string;
  name: string;
  reason: string;
}

export interface SmokeReport {
  ok: number;
  failures: DemoFailure[];
  /** How many demos produced SVG, per group (for charts). */
  svg: Record<string, number>;
}

/**
 * Patterns that definitely mean a broken render.
 *
 * The list is short ON PURPOSE. I first tried to also flag `null` or
 * `undefined` rendered as text and got four false positives: the `Select`,
 * `Combobox`, `TreeSelect` and `Cascader` demos deliberately show
 * `value = null` to illustrate the initial state. A test that screams at
 * correct content is worse than one that stays quiet about a rare problem.
 */
const SUSPECT = [
  { pattern: "NaN", reason: "output with NaN (arithmetic on missing values)" },
  { pattern: "[object Object]", reason: "object stringified in text" },
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

  // Step 1: build everything. We mount into real containers instead of calling
  // `toHTML` on the returned value: a demo can return a `Block`
  // (ErrorBoundary, Portal), an array or an accessor — all valid `Child`s,
  // but none of them an element.
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

  // Step 2: let the microtasks drain. `ErrorBoundary` publishes its
  // fallback in a `queueMicrotask`, so on the first synchronous render it is
  // genuinely empty — that is not a bug, it is how it catches the error without
  // invalidating the region while it is being evaluated.
  await Promise.resolve();
  await Promise.resolve();

  // Step 3: inspect.
  const svg: Record<string, number> = {};
  let ok = 0;

  for (const entry of mounted) {
    const html = entry.host.toHTML();
    if (html.length < 12) {
      failures.push({ group: entry.group, name: entry.name, reason: "empty output" });
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

// Run as the bundle's entry point: we leave the promise where the test can
// await it, after it evaluates the emitted code.
(globalThis as Record<string, unknown>).__catalogSmoke = runCatalogSmoke();
