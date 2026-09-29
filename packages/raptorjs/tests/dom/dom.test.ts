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

test("binding text fine-grained: click actualizeaza DOAR text-node-ul", () => {
  resetStats();
  const root = h("div") as MiniElement;
  const count = state(0);

  render(() => {
    const button = h("button");
    button.addEventListener("click", () => count.update((n) => n + 1));
    // continut dinamic -> text node legat de semnal
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

  // Nu s-au creat elemente noi; s-a facut exact o actualizare de text.
  assert.equal(stats.createElement, createdAtStart);
  assert.equal(stats.textUpdate, textUpdatesAtStart + 1);

  root.querySelector("button")!.click();
  root.querySelector("button")!.click();
  assert.equal(root.querySelector("span")!.textContent, "Clicks: 3");
  assert.equal(stats.createElement, createdAtStart); // inca zero elemente noi
});

test("binding atribut fine-grained", () => {
  const root = h("div") as MiniElement;
  const active = state(true);
  render(() => {
    const el = h("div");
    // atribut reactiv
    bindAttr(el, "class", () => (active() ? "on" : "off"));
    return el;
  }, root);
  assert.equal(root.querySelector("div")!.getAttribute("class"), "on");
  active.set(false);
  assert.equal(root.querySelector("div")!.getAttribute("class"), "off");
});

test("For keyed: reutilizeaza nodurile, nu recreeaza la reordonare", () => {
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

  // Reordoneaza -> aceleasi obiecte item -> zero elemente noi.
  const arr = items.peek();
  items.set([arr[2]!, arr[0]!, arr[1]!]);
  const lis = ul.childNodes.filter((n: any) => n.nodeType === 1);
  assert.deepEqual(lis.map((l: any) => l.textContent), ["c", "a", "b"]);
  assert.equal(stats.createElement, createdAfterMount); // nimic recreat

  // Adauga un item -> exact un element nou.
  items.update((a) => [...a, { id: 4, name: "d" }]);
  assert.equal(stats.createElement, createdAfterMount + 1);
});

test("For keyed: elimina itemii disparuti", () => {
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

test("Show: comuta intre ramuri", () => {
  const root = h("div") as MiniElement;
  const visible = state(true);
  render(() => {
    const box = h("div");
    Show({
      when: visible,
      children: (() => {
        const y = h("p");
        y.textContent = "DA";
        return y;
      })(),
      fallback: (() => {
        const n = h("p");
        n.textContent = "NU";
        return n;
      })(),
    }).mount(box, null);
    return box;
  }, root);
  assert.equal(root.querySelector("p")!.textContent, "DA");
  visible.set(false);
  assert.equal(root.querySelector("p")!.textContent, "NU");
  visible.set(true);
  assert.equal(root.querySelector("p")!.textContent, "DA");
});

test("text dinamic pur: fara comment-anchor, reuseste text-node-ul", () => {
  resetStats();
  const root = h("div") as MiniElement;
  const s = state("a");
  render(() => {
    const span = h("span");
    mount(span, () => s());
    return span;
  }, root);

  const span = root.querySelector("span")!;
  // #2: regiune pur-text => DOAR un text-node, niciun comment-anchor.
  assert.equal(span.childNodes.length, 1);
  assert.equal(span.textContent, "a");

  const createTextAfter = stats.createText;
  const insertAfter = stats.insert;
  s.set("b");
  // Fast-path: acelasi text-node, doar `.data` se schimba.
  assert.equal(span.textContent, "b");
  assert.equal(stats.createText, createTextAfter);
  assert.equal(stats.insert, insertAfter);
});

test("For clear: O(randuri) removeChild, nu O(noduri)", () => {
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
  // #1: 3 randuri => exact 3 removeChild (nodul <li>), fara stergeri interne redundante.
  assert.equal(stats.remove - removesBefore, 3);
});

test("template: cloneNode reuseste scheletul, createElement o singura data", () => {
  resetStats();
  const rowTpl = template(() => {
    const tr = h("tr");
    tr.appendChild(h("td"));
    tr.appendChild(h("td"));
    return tr;
  });

  const a = rowTpl(); // construieste prototipul (3 createElement) + clona
  const afterProto = stats.createElement;
  assert.equal(afterProto, 3);

  const b = rowTpl();
  const c = rowTpl();
  // #3: clonele NU mai apeleaza createElement.
  assert.equal(stats.createElement, afterProto);
  // Structura clonata e corecta si independenta.
  assert.equal(a.childNodes.length, 2);
  assert.equal((b as MiniElement).tagName, "tr");
  assert.notEqual(a, b);
  assert.notEqual(b, c);
});

// Helpers locale peste runtime (pentru claritatea testelor).
import { mountChild, applyProps, template } from "../../src/dom/runtime.ts";
function mount(parent: any, child: any): void {
  mountChild(parent, child, null);
}
function bindAttr(el: any, name: string, accessor: () => unknown): void {
  applyProps(el, { [name]: accessor });
}

test("value si checked se scriu ca proprietate, nu ca atribut", () => {
  // Un input in care s-a tastat e "dirty": setAttribute("value") nu mai schimba
  // ce se vede, deci un binding reactiv ar muri exact dupa prima interactiune.
  const input = h("input");
  const draft = state("start");
  render(() => {
    applyProps(input, { value: draft });
    return input;
  }, h("div"));

  assert.equal(input.value, "start", "valoarea initiala ajunge pe proprietate");
  assert.equal(input.getAttribute("value"), "start", "si pe atribut, pentru SSR / form.reset()");

  draft.set("dupa");
  assert.equal(input.value, "dupa", "bindingul continua sa functioneze");

  const box = h("input");
  const done = state(false);
  render(() => {
    applyProps(box, { type: "checkbox", checked: done });
    return box;
  }, h("div"));

  assert.equal(box.checked, false);
  done.set(true);
  assert.equal(box.checked, true, "checked urmareste semnalul dupa prima bifa");
});
