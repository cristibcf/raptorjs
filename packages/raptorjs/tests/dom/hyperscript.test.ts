import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "../../src/dom/testing/mini-dom.ts";
import { render } from "../../src/dom/runtime.ts";
import { For, Show } from "../../src/dom/control.ts";
import { R } from "../../src/dom/hyperscript.ts";
import { state } from "raptorjs";

installMiniDom();
const doc = (globalThis as unknown as { document: any }).document;

test("R.tag builds real elements, with and without props", () => {
  const el = R.div({ class: "box" }, R.span("hello"), " world") as MiniElement;
  assert.equal(el.tagName.toLowerCase(), "div");
  assert.equal(el.getAttribute("class"), "box");
  assert.equal(el.textContent, "hello world");

  // Without props: the first argument is already a child.
  const bare = R.p("just text") as MiniElement;
  assert.equal(bare.textContent, "just text");
  assert.equal(bare.getAttribute("class"), null);
});

test("R binds fine-grained: an accessor as child updates only the text-node", () => {
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

test("R binds reactive props and events", () => {
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

test("R(Component, props, ...children) calls the component", () => {
  function Card(props: { title: string; children?: unknown }) {
    return R.section(R.h2(props.title), props.children);
  }
  const el = R(Card, { title: "T" }, R.p("body")) as MiniElement;
  assert.equal(el.tagName.toLowerCase(), "section");
  assert.equal(el.textContent, "Tbody");
});

test("R accepts Blocks (For / Show) as children", () => {
  const root = doc.createElement("div") as MiniElement;
  const items = state([1, 2, 3]);
  const on = state(true);

  render(
    () =>
      R.div(
        R.ul(For({ each: () => items(), children: (i: number) => R.li(String(i)) })),
        Show({ when: () => on(), children: () => R.span("visible") }),
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
  assert.equal(root.querySelector("span")!.textContent, "visible");

  items.set([1, 2]);
  assert.equal(liText(), "1,2");
  on.set(false);
  assert.equal(root.querySelector("span"), null);
});

test("the same builder is reused per tag", () => {
  assert.equal(R.div, R.div);
  assert.notEqual(R.div, R.span);
});
