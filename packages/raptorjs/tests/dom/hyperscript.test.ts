import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "../../src/dom/testing/mini-dom.ts";
import { render } from "../../src/dom/runtime.ts";
import { For, Show } from "../../src/dom/control.ts";
import { R } from "../../src/dom/hyperscript.ts";
import { state } from "raptorjs";

installMiniDom();
const doc = (globalThis as unknown as { document: any }).document;

test("R.tag construieste elemente reale, cu si fara props", () => {
  const el = R.div({ class: "box" }, R.span("hello"), " world") as MiniElement;
  assert.equal(el.tagName.toLowerCase(), "div");
  assert.equal(el.getAttribute("class"), "box");
  assert.equal(el.textContent, "hello world");

  // Fara props: primul argument e deja copil.
  const bare = R.p("doar text") as MiniElement;
  assert.equal(bare.textContent, "doar text");
  assert.equal(bare.getAttribute("class"), null);
});

test("R leaga fine-grained: accessor-ul ca child actualizeaza doar text-node-ul", () => {
  resetStats();
  const root = doc.createElement("div") as MiniElement;
  const count = state(0);

  render(() => R.div(R.span(() => `Clicks: ${count()}`)), root);
  assert.equal(root.querySelector("span")!.textContent, "Clicks: 0");

  const createdAtStart = stats.createElement;
  const textUpdatesAtStart = stats.textUpdate;

  count.update((n) => n + 1);
  assert.equal(root.querySelector("span")!.textContent, "Clicks: 1");
  assert.equal(stats.createElement, createdAtStart);
  assert.equal(stats.textUpdate, textUpdatesAtStart + 1);
});

test("R leaga props reactive si evenimente", () => {
  const root = doc.createElement("div") as MiniElement;
  const n = state(0);

  render(
    () =>
      R.button(
        { class: () => `sbtn c${n()}`, "on:click": () => n.update((v) => v + 1) },
        "+1",
      ),
    root,
  );

  const btn = root.querySelector("button")!;
  assert.equal(btn.getAttribute("class"), "sbtn c0");
  btn.click();
  assert.equal(btn.getAttribute("class"), "sbtn c1");
});

test("R(Component, props, ...children) apeleaza componenta", () => {
  function Card(props: { title: string; children?: unknown }) {
    return R.section(R.h2(props.title), props.children);
  }
  const el = R(Card, { title: "T" }, R.p("body")) as MiniElement;
  assert.equal(el.tagName.toLowerCase(), "section");
  assert.equal(el.textContent, "Tbody");
});

test("R accepta Block-uri (For / Show) ca si copii", () => {
  const root = doc.createElement("div") as MiniElement;
  const items = state([1, 2, 3]);
  const on = state(true);

  render(
    () =>
      R.div(
        R.ul(For({ each: () => items(), children: (i: number) => R.li(String(i)) })),
        Show({ when: () => on(), children: () => R.span("vizibil") }),
      ),
    root,
  );

  const liText = () =>
    root
      .querySelector("ul")!
      .childNodes.filter((n: any) => n.tagName === "li")
      .map((n: any) => n.textContent)
      .join(",");

  assert.equal(liText(), "1,2,3");
  assert.equal(root.querySelector("span")!.textContent, "vizibil");

  items.set([1, 2]);
  assert.equal(liText(), "1,2");
  on.set(false);
  assert.equal(root.querySelector("span"), null);
});

test("acelasi builder e reutilizat per tag", () => {
  assert.equal(R.div, R.div);
  assert.notEqual(R.div, R.span);
});
