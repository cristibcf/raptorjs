/**
 * Regression for audit round 3 (U7): an `href` coming from data reached the DOM
 * untouched, so `javascript:...` was a link that executed code.
 *
 * This matters here more than in an ordinary framework: the RaptorWire thesis is
 * that state comes off the wire and is applied locally, so a navigation element
 * sent by the server is exactly the expected case, not an exotic one. Found via
 * `@raptor/ui` (`Link`, `Breadcrumbs`, `SidebarNav` take `href` from props), but
 * fixed in the DOM runtime: an application that writes JSX directly has the same
 * hole too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom } from "../../src/dom/testing/mini-dom.ts";
import { applyProps } from "../../src/dom/runtime.ts";
import { state } from "raptorjs";

installMiniDom();
const doc = (globalThis as unknown as { document: any }).document;

/** The same forms the browser also accepts when it resolves an address. */
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

test("an executable scheme never reaches an address attribute", () => {
  const realWarn = console.warn;
  const avertismente: string[] = [];
  console.warn = (...args: unknown[]) => void avertismente.push(args.map(String).join(" "));

  try {
    for (const href of PERICULOASE) {
      const a = doc.createElement("a");
      applyProps(a, { href });
      assert.equal(a.getAttribute("href"), null, `got through: ${JSON.stringify(href)}`);
    }
    assert.equal(avertismente.length, PERICULOASE.length, "every rejection is also reported, not just done");
  } finally {
    console.warn = realWarn;
  }
});

test("the filter covers all attributes that load an address", () => {
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

test("ordinary addresses are left untouched", () => {
  for (const href of CURATE) {
    const a = doc.createElement("a");
    applyProps(a, { href });
    assert.equal(a.getAttribute("href"), href, href);
  }
});

test("the filter applies on a binding update too, not just at mount", () => {
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    const adresa = state("https://exemplu.ro/ok");
    const a = doc.createElement("a");
    applyProps(a, { href: () => adresa() });
    assert.equal(a.getAttribute("href"), "https://exemplu.ro/ok");

    // The real case: the address changes because an operation arrived off the wire.
    adresa.set("javascript:alert(1)");
    assert.equal(a.getAttribute("href"), null, "a dangerous value arriving later is just as dangerous");

    adresa.set("/inapoi-la-normal");
    assert.equal(a.getAttribute("href"), "/inapoi-la-normal", "and it can revert");
  } finally {
    console.warn = realWarn;
  }
});
