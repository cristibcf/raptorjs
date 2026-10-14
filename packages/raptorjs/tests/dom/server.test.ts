/**
 * Server renderer (SSG 3A): renderToString produces spec-correct markup - void
 * elements self-close, the imperative `style` object is flushed and merged, text
 * and attributes are escaped - while effects run (so the DOM exists to serialize)
 * and onMount does not. The headless document and server-mode flag are restored
 * afterwards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString, renderDocument } from "../../src/dom/server.ts";
import { createElement, applyProps, mountChild, onMount, isServer } from "../../src/dom/runtime.ts";
import { Show } from "../../src/dom/control.ts";
import { installMiniDom } from "../../src/dom/testing/mini-dom.ts";
import { state } from "@raptorstack/raptorjs";

installMiniDom(); // a baseline globalThis.document for renderToString to restore to

test("renderToString: nested elements and text", () => {
  const html = renderToString(() => {
    const div = createElement("div");
    applyProps(div, { class: "box", id: "x" });
    const p = createElement("p");
    mountChild(p, "hello", null);
    div.appendChild(p);
    return div;
  });
  assert.equal(html, '<div class="box" id="x"><p>hello</p></div>');
});

test("renderToString: void elements self-close", () => {
  const html = renderToString(() => {
    const wrap = createElement("div");
    const img = createElement("img");
    applyProps(img, { src: "/a.png", alt: "a" });
    wrap.appendChild(img);
    wrap.appendChild(createElement("br"));
    return wrap;
  });
  assert.equal(html, '<div><img src="/a.png" alt="a"><br></div>');
});

test("renderToString: style object is flushed and merged with the style attribute", () => {
  const html = renderToString(() => {
    const d = createElement("div");
    applyProps(d, { style: "color: red" });
    (d as any).style.fontWeight = "bold";
    return d;
  });
  assert.equal(html, '<div style="color: red; font-weight: bold"></div>');
});

test("renderToString: escapes text and attribute values", () => {
  const html = renderToString(() => {
    const d = createElement("div");
    applyProps(d, { title: 'a"b<c&d' });
    mountChild(d, "x < y & z", null);
    return d;
  });
  assert.equal(html, '<div title="a&quot;b&lt;c&amp;d">x &lt; y &amp; z</div>');
});

test("renderToString: effects run and serialize, onMount does not fire", () => {
  let mounted = false;
  const count = state(5);
  const html = renderToString(() => {
    onMount(() => {
      mounted = true;
    });
    const span = createElement("span");
    mountChild(span, () => `count: ${count()}`, null);
    return span;
  });
  assert.equal(html, "<span>count: 5</span>");
  assert.equal(mounted, false);
});

test("renderToString: serializes the comment anchors from control flow", () => {
  const html = renderToString(() => {
    const d = createElement("div");
    const yes = createElement("p");
    mountChild(yes, "yes", null);
    mountChild(d, Show({ when: () => true, children: yes }), null);
    return d;
  });
  assert.match(html, /<p>yes<\/p><!--show-->/);
});

test("renderToString: server mode is on only during render; document restored", () => {
  const before = (globalThis as unknown as { document: unknown }).document;
  assert.equal(isServer(), false);
  let during = false;
  renderToString(() => {
    during = isServer();
    return createElement("div");
  });
  assert.equal(during, true);
  assert.equal(isServer(), false);
  assert.equal((globalThis as unknown as { document: unknown }).document, before);
});

test("renderDocument: wraps body markup in a full HTML document", () => {
  const html = renderDocument({ body: "<main>hi</main>", head: "<title>T</title>", lang: "en" });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<head><title>T<\/title><\/head>/);
  assert.match(html, /<body><main>hi<\/main><\/body>/);
});
