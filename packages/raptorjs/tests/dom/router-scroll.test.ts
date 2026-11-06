/**
 * Router: opt-in scroll restoration.
 *
 * Its own file because the router binds `popstate` once, lazily, the first time
 * a `Router` mounts - so the fake window has to be in place before any other
 * test in the process has mounted one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, type MiniElement } from "../../src/dom/testing/mini-dom.ts";
import { render } from "../../src/dom/runtime.ts";
import { Router, navigate, type RouteDef } from "../../src/dom/router.ts";

installMiniDom();
const doc = (globalThis as unknown as { document: { createElement(tag: string): MiniElement } }).document;
const text = (tag: string, txt: string): MiniElement => {
  const el = doc.createElement(tag);
  el.textContent = txt;
  return el;
};

/**
 * A history and a window just real enough for the restoration path to run:
 * entries carry the state the router puts in them, and `scrollTo` is recorded.
 */
const scrollCalls: [number, number][] = [];
let entries: { url: string; state: unknown }[] = [{ url: "/one", state: null }];
let index = 0;
const popstateListeners: ((event: unknown) => void)[] = [];
const g = globalThis as Record<string, unknown>;

g.scrollX = 0;
g.scrollY = 0;
g.scrollTo = (x: number, y: number) => {
  scrollCalls.push([x, y]);
  g.scrollX = x;
  g.scrollY = y;
};
g.history = {
  scrollRestoration: "auto",
  pushState: (st: unknown, _title: string, url: string) => {
    entries = entries.slice(0, index + 1);
    entries.push({ url, state: st });
    index = entries.length - 1;
  },
  replaceState: (st: unknown, _title: string, url: string) => {
    entries[index] = { url, state: st };
  },
};
g.window = {
  addEventListener: (type: string, fn: (event: unknown) => void) => {
    if (type === "popstate") popstateListeners.push(fn);
  },
};
g.location = { pathname: "/one", search: "", hash: "" };

/** What the browser does on Back: move the entry, fire popstate with its state. */
function goBack(): void {
  index--;
  const entry = entries[index]!;
  g.location = { pathname: entry.url, search: "", hash: "" };
  for (const fn of popstateListeners) fn({ state: entry.state });
}

const routes: RouteDef[] = [
  { path: "/one", component: () => text("p", "one") },
  { path: "/two", component: () => text("p", "two") },
];

// One mounted Router for the whole file: these tests follow one history.
const root = doc.createElement("div");
navigate("/one", { replace: true });
render(() => Router({ routes, scrollRestoration: true }), root as never);

const screen = (): string => root.querySelector("p")!.textContent;

test("scroll: opting in takes over the browser's own restoration", () => {
  assert.equal(
    (g.history as { scrollRestoration: string }).scrollRestoration,
    "manual",
    "otherwise the browser restores its own offset on top of ours",
  );
  assert.equal(screen(), "one");
});

test("scroll: a new navigation starts at the top, Back returns to where you were", () => {
  // Scrolled a long way down /one, then navigated.
  g.scrollY = 420;
  navigate("/two");
  assert.equal(screen(), "two");
  assert.deepEqual(scrollCalls.at(-1), [0, 0], "a new entry starts at the top");

  goBack();
  assert.equal(screen(), "one");
  assert.deepEqual(scrollCalls.at(-1), [0, 420], "restored, not reset");
});

test("scroll: a replace keeps the offset, because it is the same entry", () => {
  g.scrollY = 120;
  const before = scrollCalls.length;
  navigate("/two", { replace: true });
  assert.equal(scrollCalls.length, before, "no scroll call at all");
  assert.equal(g.scrollY, 120);
  assert.equal(screen(), "two");
});
