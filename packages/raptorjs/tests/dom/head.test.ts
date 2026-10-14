/**
 * Head management (SSG 3B): the same Title/Meta/Link calls record into the server
 * head snapshot (serialized into the page `<head>` so crawlers see them) and
 * reconcile `document.head` reactively on the client. Dedup is last-writer-wins;
 * title/meta/attribute values are escaped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom } from "../../src/dom/testing/mini-dom.ts";
import { render, createElement, mountChild } from "../../src/dom/runtime.ts";
import { renderToStringWithHead } from "../../src/dom/server.ts";
import { Title, Meta, resetHead } from "../../src/dom/head.ts";
import { state } from "@raptorstack/raptorjs";

installMiniDom();

test("renderToStringWithHead: collects Title + Meta into the head markup", () => {
  const { html, head } = renderToStringWithHead(() => {
    const app = createElement("main");
    mountChild(app, Title("My Page"), null);
    mountChild(app, Meta({ name: "description", content: "desc" }), null);
    mountChild(app, "body text", null);
    return app;
  });
  // Head components emit no visible body DOM.
  assert.equal(html, "<main>body text</main>");
  assert.match(head, /<title>My Page<\/title>/);
  assert.match(head, /<meta name="description" content="desc">/);
});

test("renderToStringWithHead: last Title wins (deduped by key)", () => {
  const { head } = renderToStringWithHead(() => {
    const app = createElement("main");
    mountChild(app, Title("First"), null);
    mountChild(app, Title("Second"), null);
    return app;
  });
  assert.match(head, /<title>Second<\/title>/);
  assert.doesNotMatch(head, /First/);
});

test("renderHeadEntries: escapes title text and attribute values", () => {
  const { head } = renderToStringWithHead(() => {
    const app = createElement("main");
    mountChild(app, Title("A & B < C"), null);
    mountChild(app, Meta({ name: "x", content: 'q"<&' }), null);
    return app;
  });
  assert.match(head, /<title>A &amp; B &lt; C<\/title>/);
  assert.match(head, /content="q&quot;&lt;&amp;"/);
});

test("Meta: maps httpEquiv to the http-equiv attribute", () => {
  const { head } = renderToStringWithHead(() => {
    const app = createElement("main");
    mountChild(app, Meta({ httpEquiv: "refresh", content: "30" }), null);
    return app;
  });
  assert.match(head, /<meta http-equiv="refresh" content="30">/);
});

test("client: Title/Meta reconcile document.head, react to changes, clean up", () => {
  installMiniDom();
  resetHead();
  const doc = (globalThis as unknown as { document: any }).document;
  const root = doc.createElement("div");
  const title = state("Home");

  const dispose = render(() => {
    const app = createElement("main");
    mountChild(app, Title(() => title()), null);
    mountChild(app, Meta({ name: "description", content: "hi" }), null);
    mountChild(app, "x", null);
    return app;
  }, root);

  assert.equal(doc.head.querySelector("title")!.textContent, "Home");
  assert.equal(doc.head.querySelector("meta")!.getAttribute("content"), "hi");
  assert.equal(root.querySelector("main")!.textContent, "x"); // head tags not in body

  title.set("About"); // reactive
  assert.equal(doc.head.querySelector("title")!.textContent, "About");

  dispose();
  assert.equal(doc.head.querySelector("meta"), null); // meta removed on unmount
  assert.ok(doc.head.querySelector("title")); // title persists across navigations
});
