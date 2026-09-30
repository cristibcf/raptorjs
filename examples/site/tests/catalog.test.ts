/**
 * The component catalog smoke test.
 *
 * It builds the demo of every component documented on the site and verifies
 * for real that it renders. The catalog pages are `.tsx`, so they cannot be
 * imported directly by Node: we run them through RaptorBundle (the same bundler
 * the site uses) and evaluate the emitted code against the mini-dom.
 *
 * It is also an end-to-end test of the bundler: if tree-shaking, subpath
 * resolution or the JSX transform breaks, it shows up here immediately.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bundleApp } from "@raptorstack/engine/bundle";
import { installMiniDom } from "@raptorstack/raptorjs/dom/testing";
import type { SmokeReport } from "../src/catalog/smoke.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "..", "src", "catalog", "smoke.ts");

/**
 * The browser surface the site modules need at load time.
 * Deliberately minimal: if a component starts to require something new, we want
 * to find out from this test, not from a bug report.
 */
function installBrowserStubs(): () => void {
  const g = globalThis as any;
  const saved = new Map<string, PropertyDescriptor | undefined>();

  const set = (key: string, value: unknown): void => {
    saved.set(key, Object.getOwnPropertyDescriptor(g, key));
    Object.defineProperty(g, key, { value, configurable: true, writable: true });
  };

  set("location", { hash: "#/components", href: "http://localhost/", pathname: "/" });
  set("history", { pushState() {}, replaceState() {} });
  set("addEventListener", () => {});
  set("removeEventListener", () => {});
  set("scrollTo", () => {});
  set("innerWidth", 1280);
  set("innerHeight", 900);
  set("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  set("navigator", { clipboard: { writeText: async () => {} } });
  set("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  set("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

  return () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(g, key, descriptor);
      else delete g[key];
    }
  };
}

/**
 * Runs the emitted code with instrumented timers.
 *
 * Demos can start intervals (an autoplay carousel) or timers (toast,
 * tooltip). If we left them alive, `node --test` would never exit -
 * exactly the trap we fell into when writing the tests for wave 6. We
 * collect them and stop them at the end.
 */
function evaluateWithTimerGuard(code: string, doc: unknown): () => void {
  const handles: Array<{ kind: "t" | "i"; id: any }> = [];
  const wrapped = {
    setTimeout: (fn: any, ms?: number, ...rest: unknown[]) => {
      const id = setTimeout(fn, ms, ...rest);
      handles.push({ kind: "t", id });
      return id;
    },
    setInterval: (fn: any, ms?: number, ...rest: unknown[]) => {
      const id = setInterval(fn, ms, ...rest);
      handles.push({ kind: "i", id });
      return id;
    },
  };

  new Function(
    "document",
    "window",
    "location",
    "history",
    "setTimeout",
    "setInterval",
    code,
  )(doc, globalThis, (globalThis as any).location, (globalThis as any).history, wrapped.setTimeout, wrapped.setInterval);

  // Stopping happens AFTER the test has read the report: it is a promise,
  // and some demos only place their content once the tasks have drained.
  return () => {
    for (const handle of handles) {
      if (handle.kind === "t") clearTimeout(handle.id);
      else clearInterval(handle.id);
    }
  };
}

test("every catalog demo renders without throwing", async () => {
  installMiniDom();
  const doc = (globalThis as any).document;
  const restore = installBrowserStubs();
  let stopTimers = (): void => {};

  try {
    const { code, files } = bundleApp(ENTRY);
    assert.ok(files.length > 20, "the smoke bundle looks too small: " + files.length + " modules");

    stopTimers = evaluateWithTimerGuard(code, doc);

    const report = (await (globalThis as any).__catalogSmoke) as SmokeReport | undefined;
    assert.ok(report, "the smoke test produced no report — the bundle did not evaluate");

    const detail = report.failures
      .map((f) => `  ${f.group} / ${f.name}: ${f.reason}`)
      .join("\n");
    assert.equal(report.failures.length, 0, `broken demos:\n${detail}`);

    // A threshold, not an exact count: the catalog grows, and a test that demanded
    // "exactly 196" would fail on every new component without finding any bug.
    assert.ok(report.ok >= 150, "too few demos ran: " + report.ok);
  } finally {
    stopTimers();
    delete (globalThis as any).__catalogSmoke;
    restore();
  }
});

test("the charts group produces SVG, not just text", async () => {
  installMiniDom();
  const doc = (globalThis as any).document;
  const restore = installBrowserStubs();
  let stopTimers = (): void => {};

  try {
    const { code } = bundleApp(ENTRY);
    stopTimers = evaluateWithTimerGuard(code, doc);
    const report = (await (globalThis as any).__catalogSmoke) as SmokeReport;

    const charts = Object.entries(report.svg).find(([title]) => /chart/i.test(title));
    assert.ok(charts, "no charts group in the catalog: " + Object.keys(report.svg).join(", "));
    // 15 chart types + `Chart primitives`, which is intentionally text.
    assert.ok(charts[1] >= 12, "too few charts with SVG: " + charts[1]);
  } finally {
    stopTimers();
    delete (globalThis as any).__catalogSmoke;
    restore();
  }
});

test("the smoke bundle passes tree-shaking without losing needed modules", () => {
  const shaken = bundleApp(ENTRY);
  const whole = bundleApp(ENTRY, { treeshake: false });

  assert.ok(shaken.files.length <= whole.files.length, "shaking cannot add modules");
  // Every kept module must also exist in the full build: shaking
  // only removes, it does not invent.
  const complete = new Set(whole.files);
  for (const file of shaken.files) {
    assert.ok(complete.has(file), "module that appeared only with shaking: " + file);
  }
});

/**
 * Regression for audit round 3 (U6): eleven components subscribed the
 * computation that built them, so the first interaction with them re-rendered the
 * whole parent region - and the rebuilt region loses focus, scroll position and
 * whatever was typed into an input.
 *
 * The site worked around it by building each demo in `untracked(...)`. That
 * workaround was removed and the fix moved into the library (`@raptorstack/raptorjs/ui` -> `isolate`);
 * this test is what keeps the fix in place.
 */
test("no component re-renders the region that builds it", async () => {
  installMiniDom();
  const doc = (globalThis as any).document;
  const restore = installBrowserStubs();
  let stopTimers = (): void => {};

  try {
    const { code } = bundleApp(join(HERE, "..", "src", "catalog", "leaks.ts"));
    stopTimers = evaluateWithTimerGuard(code, doc);

    const report = (globalThis as any).__catalogLeaks as {
      leaking: string[];
      checked: number;
      skipped: number;
    };
    assert.ok(report, "the smoke test produced no report");
    assert.ok(report.checked > 50, `too few components exercised: ${report.checked}`);
    assert.deepEqual(
      report.leaking,
      [],
      ["components that subscribe the caller's computation:", ...report.leaking].join(" · "),
    );
  } finally {
    stopTimers();
    delete (globalThis as any).__catalogLeaks;
    restore();
  }
});
