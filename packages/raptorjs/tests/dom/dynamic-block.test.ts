/**
 * A Block (For/Show/Portal) returned from a dynamic region (`() => ...`) used to
 * throw ("a Block cannot be returned from a dynamic region"). The natural JSX
 * pattern `{cond ? <Show/> : null}` lands exactly there, so the region now mounts
 * the Block in a managed wrapper and tears it down when the region re-runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, type MiniElement } from "../../src/dom/testing/mini-dom.ts";
import { render, mountChild } from "../../src/dom/runtime.ts";
import { For, Show } from "../../src/dom/control.ts";
import { state } from "@raptorstack/raptorjs";

installMiniDom();
const doc = (globalThis as unknown as { document: any }).document;
const h = (tag: string): any => doc.createElement(tag);
const p = (txt: string): any => {
  const el = h("p");
  el.textContent = txt;
  return el;
};

test("dynamic region: a Show returned from `() => ...` mounts and toggles", () => {
  const root = h("div") as MiniElement;
  const on = state(true);
  const branch = state(true);

  render(() => {
    const box = h("div");
    // The pattern that used to throw: a Block produced inside a `() => ...` region.
    mountChild(
      box,
      () => (on() ? Show({ when: branch, children: p("YES"), fallback: p("NO") }) : null),
      null,
    );
    return box;
  }, root);

  // The Show mounted through the dynamic region.
  assert.equal(root.querySelector("p")!.textContent, "YES");

  // The Show's own reactivity still works inside the wrapper.
  branch.set(false);
  assert.equal(root.querySelector("p")!.textContent, "NO");

  // Toggle the whole region off: the Show subtree is removed...
  on.set(false);
  assert.equal(root.querySelector("p"), null);

  // ...and a fresh one mounts when it comes back (branch is still false).
  on.set(true);
  assert.equal(root.querySelector("p")!.textContent, "NO");
});

test("dynamic region: a For returned from `() => ...` renders and updates", () => {
  const root = h("div") as MiniElement;
  const show = state(true);
  const items = state<string[]>(["a", "b"]);

  render(() => {
    const ul = h("ul");
    mountChild(
      ul,
      () =>
        show()
          ? For({
              each: items,
              children: (name: string) => {
                const li = h("li");
                li.textContent = name;
                return li;
              },
            })
          : null,
      null,
    );
    return ul;
  }, root);

  const names = () => root.querySelectorAll("li").map((n: any) => n.textContent);
  assert.deepEqual(names(), ["a", "b"]);

  // The For reacts to its own source while nested in the dynamic region.
  items.set(["a", "b", "c"]);
  assert.deepEqual(names(), ["a", "b", "c"]);

  // Hiding the region removes the whole list.
  show.set(false);
  assert.deepEqual(names(), []);
});
