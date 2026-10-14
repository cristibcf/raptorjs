/**
 * VirtualFor: renders only the rows inside the viewport (plus overscan), keeps
 * the DOM node count constant on a huge list, shifts the window on scroll, and
 * reuses nodes for unchanged items while rebuilding a slot whose item changed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, type MiniElement } from "../../src/dom/testing/mini-dom.ts";
import { render } from "../../src/dom/runtime.ts";
import { VirtualFor } from "../../src/dom/virtual.ts";
import { state } from "@raptorstack/raptorjs";

installMiniDom();
const doc = (globalThis as unknown as { document: any }).document;
const h = (tag: string): any => doc.createElement(tag);

const rendered = (root: MiniElement): string[] =>
  root.querySelectorAll("p").map((n: any) => n.textContent);

test("VirtualFor: renders only the window, not the whole list", () => {
  const root = h("div") as MiniElement;
  const items = state(Array.from({ length: 1000 }, (_, i) => `row-${i}`));

  render(
    () =>
      VirtualFor({
        each: items,
        rowHeight: 20,
        height: 100,
        children: (item: string) => {
          const p = h("p");
          p.textContent = item;
          return p;
        },
      }),
    root,
  );

  // Window at top: ceil(100/20)=5 visible + 4 overscan = 9 rows, not 1000.
  const texts = rendered(root);
  assert.equal(texts.length, 9);
  assert.ok(texts.includes("row-0"));
  assert.ok(texts.includes("row-8"));
  assert.ok(!texts.includes("row-9"));

  // The sizer reserves the full scroll height.
  const viewport = root.querySelector("div")!;
  const sizer = viewport.querySelector("div")!;
  assert.equal(sizer.style.height, "20000px");
});

test("VirtualFor: scrolling shifts the window", () => {
  const root = h("div") as MiniElement;
  const items = state(Array.from({ length: 1000 }, (_, i) => `row-${i}`));

  render(
    () =>
      VirtualFor({
        each: items,
        rowHeight: 20,
        height: 100,
        children: (item: string) => {
          const p = h("p");
          p.textContent = item;
          return p;
        },
      }),
    root,
  );

  const viewport = root.querySelector("div")! as any;
  viewport.scrollTop = 400; // 20 rows down
  viewport.dispatch("scroll");

  const texts = rendered(root);
  // first = floor(400/20)-4 = 16 ; last = ceil(500/20)+4 = 29  -> 13 rows
  assert.equal(texts.length, 13);
  assert.ok(texts.includes("row-16"));
  assert.ok(texts.includes("row-28"));
  assert.ok(!texts.includes("row-0"));
  assert.ok(!texts.includes("row-29"));
});

test("VirtualFor: a changed item rebuilds only its slot", () => {
  const root = h("div") as MiniElement;
  const a = { label: "a" };
  const b = { label: "b" };
  const items = state<{ label: string }[]>([a, b]);

  let builds = 0;
  render(
    () =>
      VirtualFor({
        each: items,
        rowHeight: 20,
        height: 100,
        children: (item: { label: string }) => {
          builds++;
          const p = h("p");
          p.textContent = item.label;
          return p;
        },
      }),
    root,
  );

  assert.deepEqual(rendered(root), ["a", "b"]);
  const buildsAfterInitial = builds;

  // Replace only index 1 with a new object; index 0 keeps its identity.
  const c = { label: "c" };
  items.set([a, c]);

  assert.deepEqual(rendered(root), ["a", "c"]);
  // Exactly one new build (the changed slot), the unchanged row was reused.
  assert.equal(builds, buildsAfterInitial + 1);
});
