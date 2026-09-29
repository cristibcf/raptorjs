/**
 * Regresie pentru runda 3 de audit (U7): un `href` venit din date ajungea
 * neatins in DOM, deci `javascript:...` era un link care executa cod.
 *
 * Conteaza aici mai mult decat intr-un framework obisnuit: teza RaptorWire e ca
 * starea vine de pe fir si se aplica local, deci un element de navigatie trimis
 * de server este exact cazul asteptat, nu unul exotic. Gasit prin `@raptor/ui`
 * (`Link`, `Breadcrumbs`, `SidebarNav` iau `href` din props), dar reparat in
 * runtime-ul DOM: si o aplicatie care scrie JSX direct are aceeasi gaura.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom } from "../../src/dom/testing/mini-dom.ts";
import { applyProps } from "../../src/dom/runtime.ts";
import { state } from "raptorjs";

installMiniDom();
const doc = (globalThis as unknown as { document: any }).document;

/** Aceleasi forme pe care le accepta si browserul cand rezolva o adresa. */
const PERICULOASE = [
  "javascript:alert(1)",
  " javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "javascript:alert(1)",
  "java\nscript:alert(1)",
  "vbscript:msgbox(1)",
  "data:text/html,payload",
];

const CURATE = ["https://exemplu.ro/x", "/relativ", "#ancora", "mailto:a@b.ro", "data:image/png;base64,AA"];

test("o schema executabila nu ajunge intr-un atribut de adresa", () => {
  const realWarn = console.warn;
  const avertismente: string[] = [];
  console.warn = (...args: unknown[]) => void avertismente.push(args.map(String).join(" "));

  try {
    for (const href of PERICULOASE) {
      const a = doc.createElement("a");
      applyProps(a, { href });
      assert.equal(a.getAttribute("href"), null, `a trecut: ${JSON.stringify(href)}`);
    }
    assert.equal(avertismente.length, PERICULOASE.length, "fiecare refuz e si spus, nu doar facut");
  } finally {
    console.warn = realWarn;
  }
});

test("filtrul acopera toate atributele care incarca o adresa", () => {
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    for (const name of ["src", "action", "formaction", "poster", "srcdoc", "data"]) {
      const el = doc.createElement("div");
      applyProps(el, { [name]: "javascript:alert(1)" });
      assert.equal(el.getAttribute(name), null, name);
    }
  } finally {
    console.warn = realWarn;
  }
});

test("adresele obisnuite raman neatinse", () => {
  for (const href of CURATE) {
    const a = doc.createElement("a");
    applyProps(a, { href });
    assert.equal(a.getAttribute("href"), href, href);
  }
});

test("filtrul se aplica si la actualizarea unui binding, nu doar la montare", () => {
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    const adresa = state("https://exemplu.ro/ok");
    const a = doc.createElement("a");
    applyProps(a, { href: () => adresa() });
    assert.equal(a.getAttribute("href"), "https://exemplu.ro/ok");

    // Cazul real: adresa se schimba pentru ca a venit o operatie de pe fir.
    adresa.set("javascript:alert(1)");
    assert.equal(a.getAttribute("href"), null, "o valoare periculoasa sosita mai tarziu e la fel de periculoasa");

    adresa.set("/inapoi-la-normal");
    assert.equal(a.getAttribute("href"), "/inapoi-la-normal", "si se poate reveni");
  } finally {
    console.warn = realWarn;
  }
});
