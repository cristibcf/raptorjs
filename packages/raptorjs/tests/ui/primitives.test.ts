import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "raptorjs/dom/testing";
import { render, R, For } from "raptorjs/dom";
import { state, createRoot } from "raptorjs";
import {
  Portal,
  VisuallyHidden,
  clickOutside,
  focusTrap,
  hotkeys,
  Transition,
  mediaQuery,
  clipboard,
  draggable,
  droppable,
  dragPayload,
  sortable,
  resizable,
  virtualizer,
  intersects,
  infiniteScroll,
} from "../../src/ui/primitives/index.ts";

const doc = installMiniDom() as any;
(globalThis as any).document = doc;

function div(): MiniElement {
  return doc.createElement("div") as MiniElement;
}

/* ------------------------------------------------------------------ 181 --- */

test("Portal montează în alt nod și curăță la dispose", () => {
  const target = div();
  const root = div();

  const dispose = render(() => R.div({ class: "here" }, Portal({ mount: target, children: R.span("acolo") })), root);

  assert.equal(root.querySelector("span"), null, "conținutul NU e la locul declarării");
  assert.equal(target.querySelector("span")!.textContent, "acolo");

  dispose();
  assert.equal(target.querySelector("span"), null, "portalul s-a curățat");
  assert.equal(target.childNodes.length, 0);
});

/* ------------------------------------------------------------------ 184 --- */

test("VisuallyHidden rămâne în arbore, doar ascuns vizual", () => {
  const root = div();
  render(() => R.div(VisuallyHidden("doar pentru screen reader")), root);
  const span = root.querySelector("span")!;
  assert.equal(span.getAttribute("class"), "rui-sr-only");
  assert.equal(span.textContent, "doar pentru screen reader");
});

/* ------------------------------------------------------------------ 183 --- */

test("clickOutside se declanșează doar în afară și se dezleagă la dispose", () => {
  const page = div();
  const outside = div();
  const root = div();
  page.appendChild(root);
  page.appendChild(outside);

  let hits = 0;
  const dispose = render(() => R.div({ ref: clickOutside(() => hits++) }, R.span("inside")), root);

  root.querySelector("span")!.click();
  assert.equal(hits, 0, "click înăuntru nu declanșează");

  outside.click();
  assert.equal(hits, 1);

  dispose();
  outside.click();
  assert.equal(hits, 1, "după dispose listenerul global e scos");
});

test("clickOutside respectă `ignore` și `enabled`", () => {
  const page = div();
  const trigger = div();
  const root = div();
  page.appendChild(root);
  page.appendChild(trigger);

  let hits = 0;
  const on = state(false);
  render(
    () => R.div({ ref: clickOutside(() => hits++, { ignore: () => [trigger], enabled: () => on() }) }),
    root,
  );

  trigger.click();
  assert.equal(hits, 0, "nodul ignorat nu contează ca `afară`");

  const other = div();
  page.appendChild(other);
  other.click();
  assert.equal(hits, 0, "enabled=false blochează");

  on.set(true);
  other.click();
  assert.equal(hits, 1);
});

/* ------------------------------------------------------------------ 182 --- */

test("focusTrap ciclează Tab la capete", () => {
  const root = div();
  const focused: string[] = [];
  const mk = (name: string) => {
    const b = doc.createElement("button");
    b.setAttribute("id", name);
    b.focus = () => {
      focused.push(name);
      doc.activeElement = b;
    };
    return b;
  };

  const first = mk("first");
  const last = mk("last");
  const trap = div();
  trap.appendChild(first);
  trap.appendChild(last);
  root.appendChild(trap);

  createRoot(() => focusTrap()(trap));
  assert.deepEqual(focused, ["first"], "focus inițial pe primul focusabil");

  // Tab pe ultimul → sare la primul.
  doc.activeElement = last;
  trap.dispatch("keydown", { key: "Tab", shiftKey: false });
  assert.equal(focused[focused.length - 1], "first");

  // Shift+Tab pe primul → sare la ultimul.
  doc.activeElement = first;
  trap.dispatch("keydown", { key: "Tab", shiftKey: true });
  assert.equal(focused[focused.length - 1], "last");
});

/* ------------------------------------------------------------------ 194 --- */

test("hotkeys potrivește combinații și ignoră tastarea în input", () => {
  const hits: string[] = [];
  const dispose = createRoot((d) => {
    hotkeys({ "mod+k": () => hits.push("palette"), Escape: () => hits.push("esc") });
    return d;
  });

  const target = div();
  target.dispatch("keydown", { key: "k", ctrlKey: true });
  assert.deepEqual(hits, ["palette"]);

  target.dispatch("keydown", { key: "Escape" });
  assert.deepEqual(hits, ["palette", "esc"]);

  target.dispatch("keydown", { key: "k" });
  assert.equal(hits.length, 2, "fără modificator nu se potrivește");

  const input = doc.createElement("input");
  input.dispatch("keydown", { key: "k", ctrlKey: true });
  assert.equal(hits.length, 2, "implicit nu se declanșează în input");

  dispose();
  target.dispatch("keydown", { key: "Escape" });
  assert.equal(hits.length, 2, "dispose scoate listenerul");
});

/* ------------------------------------------------------------------ 185 --- */

test("Transition fără durată se comportă ca Show", () => {
  const root = div();
  const on = state(true);
  render(() => R.div(Transition({ when: () => on(), children: R.span("x") })), root);

  assert.ok(root.querySelector("span"));
  on.set(false);
  assert.equal(root.querySelector("span"), null);
});

test("Transition cu durată ține nodul montat pe durata ieșirii", async () => {
  const root = div();
  const on = state(true);
  render(() => R.div(Transition({ when: () => on(), children: R.span("x"), duration: 20 })), root);

  assert.ok(root.querySelector("span"));
  on.set(false);
  assert.ok(root.querySelector("span"), "încă montat imediat după închidere");

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(root.querySelector("span"), null, "scos după durată");
});

/* ------------------------------------------------------------------ 195 --- */

test("mediaQuery cade pe fallback fără matchMedia", () => {
  const isWide = mediaQuery("(min-width: 768px)", true);
  assert.equal(isWide(), true);
});

test("mediaQuery urmărește schimbările când matchMedia există", () => {
  let listener: ((e: any) => void) | null = null;
  (globalThis as any).matchMedia = (_q: string) => ({
    matches: false,
    addEventListener: (_t: string, l: (e: any) => void) => {
      listener = l;
    },
    removeEventListener: () => {
      listener = null;
    },
  });

  try {
    const wide = createRoot(() => mediaQuery("(min-width: 768px)"));
    assert.equal(wide(), false);
    listener!({ matches: true });
    assert.equal(wide(), true);
  } finally {
    delete (globalThis as any).matchMedia;
  }
});

/* ------------------------------------------------------------------ 193 --- */

test("clipboard setează `copied` și raportează eșecul", async () => {
  const written: string[] = [];
  const setNav = (value: unknown): void => {
    Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
  };
  const originalNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  setNav({ clipboard: { writeText: async (t: string) => void written.push(t) } });

  try {
    const cb = createRoot(() => clipboard(0));
    assert.equal(await cb.copy("salut"), true);
    assert.deepEqual(written, ["salut"]);
    assert.equal(cb.copied(), true);

    cb.reset();
    assert.equal(cb.copied(), false);

    setNav({});
    assert.equal(await cb.copy("x"), false);
    assert.equal(cb.copied(), false);
    assert.ok(cb.error());
  } finally {
    if (originalNav) Object.defineProperty(globalThis, "navigator", originalNav);
    else delete (globalThis as any).navigator;
  }
});

/* ------------------------------------------------------------------ 186 --- */

function drag(el: MiniElement, from: [number, number], moves: Array<[number, number]>): void {
  el.dispatch("pointerdown", { clientX: from[0], clientY: from[1], button: 0 });
  for (const [x, y] of moves) el.dispatch("pointermove", { clientX: x, clientY: y });
  const last = moves[moves.length - 1] ?? from;
  el.dispatch("pointerup", { clientX: last[0], clientY: last[1] });
}

test("draggable raportează delta și respectă axa", () => {
  const el = div();
  const seen: Array<{ dx: number; dy: number }> = [];
  const d = createRoot(() => {
    const dr = draggable({ axis: "x", onMove: (e) => seen.push({ dx: e.dx, dy: e.dy }) });
    dr.ref(el);
    return dr;
  });

  drag(el, [100, 100], [[130, 180]]);
  assert.deepEqual(seen, [{ dx: 30, dy: 0 }], "axa y e proiectată la 0");
  assert.equal(d.dragging(), false, "s-a terminat");
});

test("draggable respectă pragul", () => {
  const el = div();
  let starts = 0;
  createRoot(() => draggable({ threshold: 10, onStart: () => starts++ }).ref(el));

  el.dispatch("pointerdown", { clientX: 0, clientY: 0, button: 0 });
  el.dispatch("pointermove", { clientX: 4, clientY: 0 });
  assert.equal(starts, 0, "sub prag nu pornește");
  el.dispatch("pointermove", { clientX: 20, clientY: 0 });
  assert.equal(starts, 1);
  el.dispatch("pointerup", { clientX: 20, clientY: 0 });
});

/* ------------------------------------------------------------------ 187 --- */

test("droppable primește payload-ul și filtrează prin `accepts`", () => {
  const zone = div();
  const dropped: string[] = [];
  const payload = dragPayload<string>();

  const d = createRoot(() => {
    const dz = droppable(payload, {
      accepts: (p) => p.startsWith("ok"),
      onDrop: (p) => dropped.push(p),
    });
    dz.ref(zone);
    return dz;
  });

  payload.set("nope");
  zone.dispatch("pointerenter");
  assert.equal(d.over(), false, "payload respins nu activează zona");
  zone.dispatch("pointerup");
  assert.deepEqual(dropped, []);

  payload.set("ok-1");
  zone.dispatch("pointerenter");
  assert.equal(d.over(), true);
  zone.dispatch("pointerup");
  assert.deepEqual(dropped, ["ok-1"]);
});

/* ------------------------------------------------------------------ 188 --- */

test("sortable reordonează mutând nodurile, nu recreându-le", () => {
  interface Item { id: number; name: string }
  const items = state<readonly Item[]>([
    { id: 1, name: "a" },
    { id: 2, name: "b" },
    { id: 3, name: "c" },
  ]);
  const root = div();

  const s = createRoot(() => sortable({ items }));
  render(
    () =>
      R.ul(
        For({
          each: () => items(),
          children: (it: Item, i: number) => R.li({ ref: s.item(i) }, it.name),
        }),
      ),
    root,
  );

  const names = () => root.querySelectorAll("li").map((li) => li.textContent);
  const ids = () => root.querySelectorAll("li").map((li) => li.id);
  assert.deepEqual(names(), ["a", "b", "c"]);
  const before = [...ids()].sort();

  resetStats();
  s.move(0, 2);

  assert.deepEqual(names(), ["b", "c", "a"]);
  assert.equal(stats.createElement, 0, "zero elemente noi");
  assert.equal(stats.createText, 0, "zero text-noduri noi");
  assert.deepEqual([...ids()].sort(), before, "exact aceleași noduri, reordonate");
});

test("sortable prin drag: pointerdown pe sursă, pointerup pe țintă", () => {
  const items = state<readonly string[]>(["a", "b", "c"]);
  const rows = [div(), div(), div()];
  const s = createRoot(() => {
    const sv = sortable({ items });
    rows.forEach((el, i) => sv.item(i)(el));
    return sv;
  });

  rows[0]!.dispatch("pointerdown");
  assert.equal(s.dragging(), 0);
  rows[2]!.dispatch("pointerenter");
  assert.equal(s.over(), 2);
  rows[2]!.dispatch("pointerup");

  assert.deepEqual(items(), ["b", "c", "a"]);
  assert.equal(s.dragging(), -1);
});

/* ------------------------------------------------------------------ 189 --- */

test("resizable: drag-ul mută mărimea și respectă min/max/step", () => {
  const handle = div();
  const r = createRoot(() => {
    const rz = resizable({ axis: "x", initial: 200, min: 100, max: 300 });
    rz.handle(handle);
    return rz;
  });

  assert.equal(r.size(), 200);
  assert.equal(handle.getAttribute("role"), "separator");
  assert.equal(handle.getAttribute("aria-orientation"), "vertical");

  drag(handle, [0, 0], [[50, 0]]);
  assert.equal(r.size(), 250);

  drag(handle, [0, 0], [[999, 0]]);
  assert.equal(r.size(), 300, "plafonat la max");

  drag(handle, [0, 0], [[-999, 0]]);
  assert.equal(r.size(), 100, "plafonat la min");
});

test("resizable: un drag întreg NU creează niciun nod (teza fine-grained)", () => {
  const root = div();
  const handle = div();
  const r = createRoot(() => {
    const rz = resizable({ axis: "x", initial: 200, min: 50, max: 600 });
    rz.handle(handle);
    return rz;
  });

  // Panoul e legat fine-grained de mărime: un singur atribut de stil.
  render(() => R.div({ style: () => r.style() }, R.span("panou")), root);
  const pane = root.querySelector("div")!;
  assert.equal(pane.getAttribute("style"), "width:200px");

  resetStats();
  // 60 de evenimente pointermove, ca un drag real de o secundă.
  handle.dispatch("pointerdown", { clientX: 0, clientY: 0, button: 0 });
  for (let i = 1; i <= 60; i++) handle.dispatch("pointermove", { clientX: i * 2, clientY: 0 });
  handle.dispatch("pointerup", { clientX: 120, clientY: 0 });

  assert.equal(r.size(), 320);
  assert.equal(pane.getAttribute("style"), "width:320px");
  assert.equal(stats.createElement, 0, "zero elemente create în 60 de frame-uri");
  assert.equal(stats.createText, 0, "zero text-noduri");
  assert.equal(stats.setAttribute, 60, "exact o scriere de atribut per frame");
});

test("resizable: tastatura mișcă mânerul", () => {
  const handle = div();
  const r = createRoot(() => {
    const rz = resizable({ axis: "x", initial: 100, min: 0, max: 500, step: 10 });
    rz.handle(handle);
    return rz;
  });

  handle.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(r.size(), 110);
  handle.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(r.size(), 100);
  handle.dispatch("keydown", { key: "End" });
  assert.equal(r.size(), 500);
  handle.dispatch("keydown", { key: "Home" });
  assert.equal(r.size(), 0);
});

/* ------------------------------------------------------------------ 190 --- */

test("virtualizer randează o fereastră, nu toată lista", () => {
  const count = state(50000);
  const v = createRoot(() => virtualizer({ count: () => count(), itemSize: 20, overscan: 2, viewportSize: 200 }));

  // 200px / 20px = 10 vizibile + 2*2 overscan.
  assert.equal(v.indices().length, 14);
  assert.equal(v.indices()[0], 0);
  assert.equal(v.totalSize(), 1000000);

  v.setScroll(10000);
  assert.equal(v.indices()[0], 10000 / 20 - 2);
  assert.equal(v.indices().length, 14, "fereastra rămâne constantă");
});

test("virtualizer: un scroll de un rând creează cel mult un rând nou", () => {
  const root = div();
  const count = state(10000);
  const v = createRoot(() => virtualizer({ count: () => count(), itemSize: 20, overscan: 1, viewportSize: 100 }));

  render(
    () =>
      R.div(
        For({
          each: () => v.indices(),
          children: (i: number) => R.div({ style: v.itemStyle(i) }, "rând " + i),
        }),
      ),
    root,
  );

  const rendered = () => root.querySelectorAll("div").filter((d) => d.getAttribute("style") != null);
  assert.equal(rendered().length, 7, "7 randate din 10.000");

  resetStats();
  v.setScroll(20); // exact un rând

  assert.equal(rendered().length, 7);
  assert.ok(stats.createElement <= 1, "cel mult un element nou, nu 7: " + stats.createElement);
});

test("virtualizer: scrollTo și setViewport", () => {
  const v = createRoot(() => virtualizer({ count: () => 1000, itemSize: 50 }));
  v.setViewport(500);
  assert.equal(v.indices().length, 10 + 3 * 2);
  v.scrollTo(100);
  assert.equal(v.range().start, 100 - 3);
});

/* ------------------------------------------------------------- 191 + 192 --- */

test("intersects expune vizibilitatea ca semnal, cu `once`", () => {
  const i = createRoot(() => intersects({ once: true }));
  assert.equal(i.visible(), false);
  i.trigger(true);
  assert.equal(i.visible(), true);
  i.trigger(false);
  assert.equal(i.visible(), true, "`once` îngheață după prima intrare");
});

test("infiniteScroll nu suprapune încărcările și respectă hasMore", async () => {
  let calls = 0;
  let release: (() => void) | null = null;
  const more = state(true);

  const inf = createRoot(() =>
    infiniteScroll({
      hasMore: () => more(),
      onLoad: () => {
        calls++;
        return new Promise<void>((r) => {
          release = r;
        });
      },
    }),
  );

  inf.load();
  assert.equal(calls, 1);
  assert.equal(inf.loading(), true);

  inf.load();
  assert.equal(calls, 1, "a doua cerere e ignorată cât timp încarcă");

  release!();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(inf.loading(), false);

  more.set(false);
  inf.load();
  assert.equal(calls, 1, "hasMore=false oprește încărcarea");
});
