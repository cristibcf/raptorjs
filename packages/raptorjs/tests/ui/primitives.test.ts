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

test("Portal mounts into another node and cleans up on dispose", () => {
  const target = div();
  const root = div();

  const dispose = render(() => R.div({ class: "here" }, Portal({ mount: target, children: R.span("over there") })), root);

  assert.equal(root.querySelector("span"), null, "the content is NOT at the declaration site");
  assert.equal(target.querySelector("span")!.textContent, "over there");

  dispose();
  assert.equal(target.querySelector("span"), null, "the portal cleaned up");
  assert.equal(target.childNodes.length, 0);
});

/* ------------------------------------------------------------------ 184 --- */

test("VisuallyHidden stays in the tree, just hidden visually", () => {
  const root = div();
  render(() => R.div(VisuallyHidden("for screen readers only")), root);
  const span = root.querySelector("span")!;
  assert.equal(span.getAttribute("class"), "rui-sr-only");
  assert.equal(span.textContent, "for screen readers only");
});

/* ------------------------------------------------------------------ 183 --- */

test("clickOutside fires only outside and unbinds on dispose", () => {
  const page = div();
  const outside = div();
  const root = div();
  page.appendChild(root);
  page.appendChild(outside);

  let hits = 0;
  const dispose = render(() => R.div({ ref: clickOutside(() => hits++) }, R.span("inside")), root);

  root.querySelector("span")!.click();
  assert.equal(hits, 0, "click inside doesn't fire");

  outside.click();
  assert.equal(hits, 1);

  dispose();
  outside.click();
  assert.equal(hits, 1, "after dispose the global listener is removed");
});

test("clickOutside respects `ignore` and `enabled`", () => {
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
  assert.equal(hits, 0, "the ignored node doesn't count as `outside`");

  const other = div();
  page.appendChild(other);
  other.click();
  assert.equal(hits, 0, "enabled=false blocks");

  on.set(true);
  other.click();
  assert.equal(hits, 1);
});

/* ------------------------------------------------------------------ 182 --- */

test("focusTrap cycles Tab at the ends", () => {
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
  assert.deepEqual(focused, ["first"], "initial focus on the first focusable");

  // Tab on the last → jumps to the first.
  doc.activeElement = last;
  trap.dispatch("keydown", { key: "Tab", shiftKey: false });
  assert.equal(focused[focused.length - 1], "first");

  // Shift+Tab on the first → jumps to the last.
  doc.activeElement = first;
  trap.dispatch("keydown", { key: "Tab", shiftKey: true });
  assert.equal(focused[focused.length - 1], "last");
});

/* ------------------------------------------------------------------ 194 --- */

test("hotkeys matches combinations and ignores typing in an input", () => {
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
  assert.equal(hits.length, 2, "without a modifier it doesn't match");

  const input = doc.createElement("input");
  input.dispatch("keydown", { key: "k", ctrlKey: true });
  assert.equal(hits.length, 2, "by default it doesn't fire in an input");

  dispose();
  target.dispatch("keydown", { key: "Escape" });
  assert.equal(hits.length, 2, "dispose removes the listener");
});

/* ------------------------------------------------------------------ 185 --- */

test("Transition without a duration behaves like Show", () => {
  const root = div();
  const on = state(true);
  render(() => R.div(Transition({ when: () => on(), children: R.span("x") })), root);

  assert.ok(root.querySelector("span"));
  on.set(false);
  assert.equal(root.querySelector("span"), null);
});

test("Transition with a duration keeps the node mounted during the exit", async () => {
  const root = div();
  const on = state(true);
  render(() => R.div(Transition({ when: () => on(), children: R.span("x"), duration: 20 })), root);

  assert.ok(root.querySelector("span"));
  on.set(false);
  assert.ok(root.querySelector("span"), "still mounted immediately after close");

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(root.querySelector("span"), null, "removed after the duration");
});

/* ------------------------------------------------------------------ 195 --- */

test("mediaQuery falls back without matchMedia", () => {
  const isWide = mediaQuery("(min-width: 768px)", true);
  assert.equal(isWide(), true);
});

test("mediaQuery tracks changes when matchMedia exists", () => {
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

test("clipboard sets `copied` and reports failure", async () => {
  const written: string[] = [];
  const setNav = (value: unknown): void => {
    Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
  };
  const originalNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  setNav({ clipboard: { writeText: async (t: string) => void written.push(t) } });

  try {
    const cb = createRoot(() => clipboard(0));
    assert.equal(await cb.copy("hello"), true);
    assert.deepEqual(written, ["hello"]);
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

test("draggable reports the delta and respects the axis", () => {
  const el = div();
  const seen: Array<{ dx: number; dy: number }> = [];
  const d = createRoot(() => {
    const dr = draggable({ axis: "x", onMove: (e) => seen.push({ dx: e.dx, dy: e.dy }) });
    dr.ref(el);
    return dr;
  });

  drag(el, [100, 100], [[130, 180]]);
  assert.deepEqual(seen, [{ dx: 30, dy: 0 }], "the y axis is projected to 0");
  assert.equal(d.dragging(), false, "it finished");
});

test("draggable respects the threshold", () => {
  const el = div();
  let starts = 0;
  createRoot(() => draggable({ threshold: 10, onStart: () => starts++ }).ref(el));

  el.dispatch("pointerdown", { clientX: 0, clientY: 0, button: 0 });
  el.dispatch("pointermove", { clientX: 4, clientY: 0 });
  assert.equal(starts, 0, "below the threshold it doesn't start");
  el.dispatch("pointermove", { clientX: 20, clientY: 0 });
  assert.equal(starts, 1);
  el.dispatch("pointerup", { clientX: 20, clientY: 0 });
});

/* ------------------------------------------------------------------ 187 --- */

test("droppable receives the payload and filters via `accepts`", () => {
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
  assert.equal(d.over(), false, "a rejected payload doesn't activate the zone");
  zone.dispatch("pointerup");
  assert.deepEqual(dropped, []);

  payload.set("ok-1");
  zone.dispatch("pointerenter");
  assert.equal(d.over(), true);
  zone.dispatch("pointerup");
  assert.deepEqual(dropped, ["ok-1"]);
});

/* ------------------------------------------------------------------ 188 --- */

test("sortable reorders by moving the nodes, not recreating them", () => {
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
  assert.equal(stats.createElement, 0, "zero new elements");
  assert.equal(stats.createText, 0, "zero new text-nodes");
  assert.deepEqual([...ids()].sort(), before, "exactly the same nodes, reordered");
});

test("sortable by drag: pointerdown on the source, pointerup on the target", () => {
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

test("resizable: the drag moves the size and respects min/max/step", () => {
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
  assert.equal(r.size(), 300, "capped at max");

  drag(handle, [0, 0], [[-999, 0]]);
  assert.equal(r.size(), 100, "capped at min");
});

test("resizable: a whole drag creates NO node (fine-grained thesis)", () => {
  const root = div();
  const handle = div();
  const r = createRoot(() => {
    const rz = resizable({ axis: "x", initial: 200, min: 50, max: 600 });
    rz.handle(handle);
    return rz;
  });

  // The pane is bound fine-grained to the size: a single style attribute.
  render(() => R.div({ style: () => r.style() }, R.span("pane")), root);
  const pane = root.querySelector("div")!;
  assert.equal(pane.getAttribute("style"), "width:200px");

  resetStats();
  // 60 pointermove events, like a real one-second drag.
  handle.dispatch("pointerdown", { clientX: 0, clientY: 0, button: 0 });
  for (let i = 1; i <= 60; i++) handle.dispatch("pointermove", { clientX: i * 2, clientY: 0 });
  handle.dispatch("pointerup", { clientX: 120, clientY: 0 });

  assert.equal(r.size(), 320);
  assert.equal(pane.getAttribute("style"), "width:320px");
  assert.equal(stats.createElement, 0, "zero elements created in 60 frames");
  assert.equal(stats.createText, 0, "zero text-nodes");
  assert.equal(stats.setAttribute, 60, "exactly one attribute write per frame");
});

test("resizable: the keyboard moves the handle", () => {
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

test("virtualizer renders a window, not the whole list", () => {
  const count = state(50000);
  const v = createRoot(() => virtualizer({ count: () => count(), itemSize: 20, overscan: 2, viewportSize: 200 }));

  // 200px / 20px = 10 visible + 2*2 overscan.
  assert.equal(v.indices().length, 14);
  assert.equal(v.indices()[0], 0);
  assert.equal(v.totalSize(), 1000000);

  v.setScroll(10000);
  assert.equal(v.indices()[0], 10000 / 20 - 2);
  assert.equal(v.indices().length, 14, "the window stays constant");
});

test("virtualizer: a one-row scroll creates at most one new row", () => {
  const root = div();
  const count = state(10000);
  const v = createRoot(() => virtualizer({ count: () => count(), itemSize: 20, overscan: 1, viewportSize: 100 }));

  render(
    () =>
      R.div(
        For({
          each: () => v.indices(),
          children: (i: number) => R.div({ style: v.itemStyle(i) }, "row " + i),
        }),
      ),
    root,
  );

  const rendered = () => root.querySelectorAll("div").filter((d) => d.getAttribute("style") != null);
  assert.equal(rendered().length, 7, "7 rendered out of 10,000");

  resetStats();
  v.setScroll(20); // exactly one row

  assert.equal(rendered().length, 7);
  assert.ok(stats.createElement <= 1, "at most one new element, not 7: " + stats.createElement);
});

test("virtualizer: scrollTo and setViewport", () => {
  const v = createRoot(() => virtualizer({ count: () => 1000, itemSize: 50 }));
  v.setViewport(500);
  assert.equal(v.indices().length, 10 + 3 * 2);
  v.scrollTo(100);
  assert.equal(v.range().start, 100 - 3);
});

/* ------------------------------------------------------------- 191 + 192 --- */

test("intersects exposes visibility as a signal, with `once`", () => {
  const i = createRoot(() => intersects({ once: true }));
  assert.equal(i.visible(), false);
  i.trigger(true);
  assert.equal(i.visible(), true);
  i.trigger(false);
  assert.equal(i.visible(), true, "`once` freezes after the first entry");
});

test("infiniteScroll doesn't overlap loads and respects hasMore", async () => {
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
  assert.equal(calls, 1, "the second request is ignored while loading");

  release!();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(inf.loading(), false);

  more.set(false);
  inf.load();
  assert.equal(calls, 1, "hasMore=false stops loading");
});
