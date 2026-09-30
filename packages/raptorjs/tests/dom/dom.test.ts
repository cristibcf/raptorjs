import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "../../src/dom/testing/mini-dom.ts";
import { render } from "../../src/dom/runtime.ts";
import { For, Show } from "../../src/dom/control.ts";
import { state } from "raptorjs";

installMiniDom();
const doc = (globalThis as unknown as { document: any }).document;

function h(tag: string): any {
  return doc.createElement(tag);
}

test("fine-grained text binding: a click updates ONLY the text-node", () => {
  resetStats();
  const root = h("div") as MiniElement;
  const count = state(0);

  render(() => {
    const button = h("button");
    button.addEventListener("click", () => count.update((n) => n + 1));
    // dynamic content -> text node bound to the signal
    const span = h("span");
    mount(span, () => `Clicks: ${count()}`);
    button.appendChild(span);
    return button;
  }, root);

  assert.equal(root.querySelector("span")!.textContent, "Clicks: 0");
  const createdAtStart = stats.createElement;
  const textUpdatesAtStart = stats.textUpdate;

  root.querySelector("button")!.click();
  assert.equal(root.querySelector("span")!.textContent, "Clicks: 1");

  // No new elements were created; exactly one text update happened.
  assert.equal(stats.createElement, createdAtStart);
  assert.equal(stats.textUpdate, textUpdatesAtStart + 1);

  root.querySelector("button")!.click();
  root.querySelector("button")!.click();
  assert.equal(root.querySelector("span")!.textContent, "Clicks: 3");
  assert.equal(stats.createElement, createdAtStart); // still zero new elements
});

test("fine-grained attribute binding", () => {
  const root = h("div") as MiniElement;
  const active = state(true);
  render(() => {
    const el = h("div");
    // reactive attribute
    bindAttr(el, "class", () => (active() ? "on" : "off"));
    return el;
  }, root);
  assert.equal(root.querySelector("div")!.getAttribute("class"), "on");
  active.set(false);
  assert.equal(root.querySelector("div")!.getAttribute("class"), "off");
});

test("keyed For: reuses nodes, does not recreate on reorder", () => {
  resetStats();
  const root = h("div") as MiniElement;
  const items = state<Array<{ id: number; name: string }>>([
    { id: 1, name: "a" },
    { id: 2, name: "b" },
    { id: 3, name: "c" },
  ]);

  render(() => {
    const ul = h("ul");
    For({
      each: items,
      children: (item: { id: number; name: string }) => {
        const li = h("li");
        li.textContent = item.name;
        return li;
      },
    }).mount(ul, null);
    return ul;
  }, root);

  const ul = root.querySelector("ul")!;
  assert.equal(ul.querySelector("li")!.textContent, "a");
  const createdAfterMount = stats.createElement;

  // Reorder -> same item objects -> zero new elements.
  const arr = items.peek();
  items.set([arr[2]!, arr[0]!, arr[1]!]);
  const lis = ul.childNodes.filter((n: any) => n.nodeType === 1);
  assert.deepEqual(lis.map((l: any) => l.textContent), ["c", "a", "b"]);
  assert.equal(stats.createElement, createdAfterMount); // nothing recreated

  // Add an item -> exactly one new element.
  items.update((a) => [...a, { id: 4, name: "d" }]);
  assert.equal(stats.createElement, createdAfterMount + 1);
});

test("keyed For: removes items that disappeared", () => {
  const root = h("div") as MiniElement;
  const items = state([1, 2, 3]);
  render(() => {
    const ul = h("ul");
    For({
      each: items,
      children: (n: number) => {
        const li = h("li");
        li.textContent = String(n);
        return li;
      },
    }).mount(ul, null);
    return ul;
  }, root);
  const ul = root.querySelector("ul")!;
  assert.equal(ul.childNodes.filter((n: any) => n.nodeType === 1).length, 3);
  items.set([2]);
  assert.equal(ul.childNodes.filter((n: any) => n.nodeType === 1).length, 1);
  assert.equal(ul.querySelector("li")!.textContent, "2");
});

test("Show: switches between branches", () => {
  const root = h("div") as MiniElement;
  const visible = state(true);
  render(() => {
    const box = h("div");
    Show({
      when: visible,
      children: (() => {
        const y = h("p");
        y.textContent = "YES";
        return y;
      })(),
      fallback: (() => {
        const n = h("p");
        n.textContent = "NO";
        return n;
      })(),
    }).mount(box, null);
    return box;
  }, root);
  assert.equal(root.querySelector("p")!.textContent, "YES");
  visible.set(false);
  assert.equal(root.querySelector("p")!.textContent, "NO");
  visible.set(true);
  assert.equal(root.querySelector("p")!.textContent, "YES");
});

test("pure dynamic text: no comment-anchor, reuses the text-node", () => {
  resetStats();
  const root = h("div") as MiniElement;
  const s = state("a");
  render(() => {
    const span = h("span");
    mount(span, () => s());
    return span;
  }, root);

  const span = root.querySelector("span")!;
  // #2: pure-text region => ONLY a text-node, no comment-anchor.
  assert.equal(span.childNodes.length, 1);
  assert.equal(span.textContent, "a");

  const createTextAfter = stats.createText;
  const insertAfter = stats.insert;
  s.set("b");
  // Fast-path: the same text-node, only `.data` changes.
  assert.equal(span.textContent, "b");
  assert.equal(stats.createText, createTextAfter);
  assert.equal(stats.insert, insertAfter);
});

test("For clear: O(rows) removeChild, not O(nodes)", () => {
  resetStats();
  const root = h("div") as MiniElement;
  const items = state<number[]>([1, 2, 3]);
  render(() => {
    const ul = h("ul");
    mount(
      ul,
      For({
        each: () => items(),
        children: (n) => {
          const li = h("li");
          mount(li, () => `item ${n}`);
          return li;
        },
      }),
    );
    return ul;
  }, root);

  const removesBefore = stats.remove;
  items.set([]);
  // #1: 3 rows => exactly 3 removeChild (the <li> node), no redundant internal removals.
  assert.equal(stats.remove - removesBefore, 3);
});

test("template: cloneNode reuses the skeleton, createElement only once", () => {
  resetStats();
  const rowTpl = template(() => {
    const tr = h("tr");
    tr.appendChild(h("td"));
    tr.appendChild(h("td"));
    return tr;
  });

  const a = rowTpl(); // builds the prototype (3 createElement) + clone
  const afterProto = stats.createElement;
  assert.equal(afterProto, 3);

  const b = rowTpl();
  const c = rowTpl();
  // #3: the clones no longer call createElement.
  assert.equal(stats.createElement, afterProto);
  // The cloned structure is correct and independent.
  assert.equal(a.childNodes.length, 2);
  assert.equal((b as MiniElement).tagName, "tr");
  assert.notEqual(a, b);
  assert.notEqual(b, c);
});

// Local helpers over the runtime (for clarity of the tests).
import { mountChild, applyProps, template } from "../../src/dom/runtime.ts";
function mount(parent: any, child: any): void {
  mountChild(parent, child, null);
}
function bindAttr(el: any, name: string, accessor: () => unknown): void {
  applyProps(el, { [name]: accessor });
}

test("value and checked are written as a property, not as an attribute", () => {
  // An input that was typed into is "dirty": setAttribute("value") no longer
  // changes what is shown, so a reactive binding would die right after the first
  // interaction.
  const input = h("input");
  const draft = state("start");
  render(() => {
    applyProps(input, { value: draft });
    return input;
  }, h("div"));

  assert.equal(input.value, "start", "the initial value lands on the property");
  assert.equal(input.getAttribute("value"), "start", "and on the attribute, for SSR / form.reset()");

  draft.set("after");
  assert.equal(input.value, "after", "the binding keeps working");

  const box = h("input");
  const done = state(false);
  render(() => {
    applyProps(box, { type: "checkbox", checked: done });
    return box;
  }, h("div"));

  assert.equal(box.checked, false);
  done.set(true);
  assert.equal(box.checked, true, "checked follows the signal after the first tick");
});
