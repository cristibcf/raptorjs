/**
 * Proba de fum a catalogului de componente.
 *
 * Construieste demo-ul fiecarei componente documentate pe site si verifica
 * faptic ca randeaza. Paginile de catalog sunt `.tsx`, deci nu pot fi importate
 * direct de Node: le trecem prin RaptorBundle (acelasi bundler pe care il
 * foloseste site-ul) si evaluam codul emis pe mini-dom.
 *
 * E si un test end-to-end al bundler-ului: daca tree-shaking-ul, rezolvarea de
 * subpath-uri sau transformul JSX se strica, aici se vede imediat.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bundleApp } from "@raptor/engine/bundle";
import { installMiniDom } from "raptorjs/dom/testing";
import type { SmokeReport } from "../src/catalog/smoke.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "..", "src", "catalog", "smoke.ts");

/**
 * Suprafata de browser de care au nevoie modulele site-ului la incarcare.
 * Minima intentionat: daca o componenta incepe sa ceara ceva nou, vrem sa
 * aflam din acest test, nu dintr-un raport de bug.
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
 * Ruleaza codul emis cu timere instrumentate.
 *
 * Demo-urile pot porni intervale (carusel cu autoplay) sau cronometre (toast,
 * tooltip). Daca le-am lasa in viata, `node --test` n-ar mai iesi niciodata -
 * exact capcana in care am cazut cand am scris testele pentru valul 6. Le
 * colectam si le oprim la final.
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

  // Oprirea se face DUPA ce testul a citit raportul: acesta e o promisiune,
  // iar unele demo-uri isi aseaza continutul abia dupa ce se scurg task-urile.
  return () => {
    for (const handle of handles) {
      if (handle.kind === "t") clearTimeout(handle.id);
      else clearInterval(handle.id);
    }
  };
}

test("fiecare demo din catalog randează fără să arunce", async () => {
  installMiniDom();
  const doc = (globalThis as any).document;
  const restore = installBrowserStubs();
  let stopTimers = (): void => {};

  try {
    const { code, files } = bundleApp(ENTRY);
    assert.ok(files.length > 20, "bundle-ul probei pare prea mic: " + files.length + " module");

    stopTimers = evaluateWithTimerGuard(code, doc);

    const report = (await (globalThis as any).__catalogSmoke) as SmokeReport | undefined;
    assert.ok(report, "proba nu a produs raport — bundle-ul nu s-a evaluat");

    const detail = report.failures
      .map((f) => `  ${f.group} / ${f.name}: ${f.reason}`)
      .join("\n");
    assert.equal(report.failures.length, 0, `demo-uri stricate:\n${detail}`);

    // Prag, nu număr exact: catalogul crește, iar un test care cere „fix 196"
    // ar pica la fiecare componentă nouă fără să fi găsit vreun bug.
    assert.ok(report.ok >= 150, "prea puține demo-uri rulate: " + report.ok);
  } finally {
    stopTimers();
    delete (globalThis as any).__catalogSmoke;
    restore();
  }
});

test("grupul de grafice produce SVG, nu doar text", async () => {
  installMiniDom();
  const doc = (globalThis as any).document;
  const restore = installBrowserStubs();
  let stopTimers = (): void => {};

  try {
    const { code } = bundleApp(ENTRY);
    stopTimers = evaluateWithTimerGuard(code, doc);
    const report = (await (globalThis as any).__catalogSmoke) as SmokeReport;

    const charts = Object.entries(report.svg).find(([title]) => /chart/i.test(title));
    assert.ok(charts, "niciun grup de grafice în catalog: " + Object.keys(report.svg).join(", "));
    // 15 tipuri de grafic + `Chart primitives`, care e intenționat text.
    assert.ok(charts[1] >= 12, "prea puține grafice cu SVG: " + charts[1]);
  } finally {
    stopTimers();
    delete (globalThis as any).__catalogSmoke;
    restore();
  }
});

test("bundle-ul probei trece prin tree-shaking fără să piardă module necesare", () => {
  const shaken = bundleApp(ENTRY);
  const whole = bundleApp(ENTRY, { treeshake: false });

  assert.ok(shaken.files.length <= whole.files.length, "shaking-ul nu poate adăuga module");
  // Toate modulele păstrate trebuie să existe și în build-ul complet: shaking-ul
  // doar scoate, nu inventează.
  const complete = new Set(whole.files);
  for (const file of shaken.files) {
    assert.ok(complete.has(file), "modul apărut doar cu shaking: " + file);
  }
});

/**
 * Regresie pentru runda 3 de audit (U6): unsprezece componente abonau
 * computatia care le construia, deci prima interactiune cu ele re-randa toata
 * regiunea parinte - iar regiunea reconstruita pierde focusul, scroll-ul si ce
 * era tastat intr-un input.
 *
 * Site-ul ocolea problema construind fiecare demo in `untracked(...)`. Ocolul a
 * fost scos si reparatia a intrat in biblioteca (`raptorjs/ui` -> `isolate`);
 * testul asta e ce tine reparatia pe loc.
 */
test("nicio componenta nu re-randa regiunea care o construieste", async () => {
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
    assert.ok(report, "proba nu a produs raport");
    assert.ok(report.checked > 50, `prea putine componente exercitate: ${report.checked}`);
    assert.deepEqual(
      report.leaking,
      [],
      ["componente care abonează computația apelantului:", ...report.leaking].join(" · "),
    );
  } finally {
    stopTimers();
    delete (globalThis as any).__catalogLeaks;
    restore();
  }
});
