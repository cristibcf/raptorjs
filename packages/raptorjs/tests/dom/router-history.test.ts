/**
 * The `popstate` binding (v0.2.1).
 *
 * It was bound lazily from inside `Router`, so an application whose navigation
 * came from its own components - never mounting a `Router` - got no listener
 * at all: Back moved the address bar and left the view where it was, with
 * nothing thrown and nothing logged. "Does Back work" was therefore a function
 * of which components an app happened to use, which is not a property anyone
 * could predict from the API.
 *
 * Its own file, like router-scroll.test.ts, because the binding latches once
 * per process: the fake window has to be in place before anything reads the
 * location.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom } from "../../src/dom/testing/mini-dom.ts";
import { hash, location, navigate, pathname, searchParams } from "../../src/dom/router.ts";

installMiniDom();

const popstateListeners: ((event: unknown) => void)[] = [];
const g = globalThis as Record<string, unknown>;
let entries: { url: string; state: unknown }[] = [{ url: "/one", state: null }];
let index = 0;

g.history = {
  pushState: (st: unknown, _t: string, url: string) => {
    entries = entries.slice(0, index + 1);
    entries.push({ url, state: st });
    index = entries.length - 1;
  },
  replaceState: (st: unknown, _t: string, url: string) => {
    entries[index] = { url, state: st };
  },
};
g.window = {
  addEventListener: (type: string, fn: (event: unknown) => void) => {
    if (type === "popstate") popstateListeners.push(fn);
  },
};
g.location = { pathname: "/one", search: "", hash: "" };

/** What the browser does on Back. */
function goBack(): void {
  index--;
  const entry = entries[index]!;
  g.location = { pathname: entry.url, search: "", hash: "" };
  for (const fn of popstateListeners) fn({ state: entry.state });
}

test("history: reading the location is what binds popstate - no Router needed", () => {
  // Nothing has read the location yet, so nothing is bound.
  assert.equal(popstateListeners.length, 0);

  // The module reads the location once at import time, which here was before
  // the fake window existed (in a browser it is the real one), so start by
  // syncing - what an app's entry does implicitly.
  navigate("/one", { replace: true });

  // This is the whole application: it reads the pathname and navigates itself,
  // using neither Router nor Link.
  const seen: string[] = [];
  seen.push(pathname());
  assert.equal(popstateListeners.length, 1, "reading or navigating bound it");

  navigate("/two");
  seen.push(pathname());
  goBack();
  seen.push(pathname());

  assert.deepEqual(seen, ["/one", "/two", "/one"], "Back moved the view, not just the address bar");
});

test("history: every location accessor binds it, so none of them is the wrong door", () => {
  // The binding latches, so this asserts the call does not throw and the
  // accessors agree - the per-accessor binding is covered by the test above
  // having bound it through `pathname()` alone.
  navigate("/three?tab=b#frag");
  assert.equal(location(), "/three?tab=b#frag");
  assert.equal(pathname(), "/three");
  assert.equal(searchParams().get("tab"), "b");
  assert.equal(hash(), "#frag");
  assert.equal(popstateListeners.length, 1, "bound once, not once per read");
});
