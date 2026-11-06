/**
 * `onMount` for a subtree that is attached AFTER the initial render (v0.2.1).
 *
 * The queue was drained exactly once, inside `render()`, straight after the
 * first `mountChild`. So work scheduled by a branch that `Show` revealed later
 * never ran - and did not merely get skipped: it stayed in the module-level
 * queue, accumulating for the life of the page, and fired on the next
 * `render()` under a different root.
 *
 * The symptom that found it was a command palette that opened and then ignored
 * every keystroke, because focus was never moved into it - the kind of bug that
 * reads as an application mistake for a long time before anyone suspects the
 * framework.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, type MiniElement } from "../../src/dom/testing/mini-dom.ts";
import { render, onMount, setServerMode } from "../../src/dom/runtime.ts";
import { For, Show } from "../../src/dom/control.ts";
import { R } from "../../src/dom/hyperscript.ts";
import { state } from "../../src/core/index.ts";

installMiniDom();
const doc = (globalThis as unknown as { document: { createElement(tag: string): MiniElement } }).document;
const div = (): MiniElement => doc.createElement("div");

/** A panel that reports whether it was attached when its onMount ran. */
function panel(log: string[]): MiniElement {
  const el = doc.createElement("section");
  el.textContent = "panel";
  onMount(() => log.push(el.parentNode ? "mounted:attached" : "mounted:detached"));
  return el;
}

/* ------------------------------------------------------- the initial render */

test("onMount: still runs once, after the tree is in the container", () => {
  const log: string[] = [];
  const root = div();
  render(() => panel(log), root as never);
  assert.deepEqual(log, ["mounted:attached"]);
});

test("onMount: a nested dynamic region does not fire early during the initial render", () => {
  // The region attaches into a parent that `render` has not put in the
  // container yet, so firing there would hand the callback a detached node.
  const log: string[] = [];
  const root = div();
  render(() => R.div({}, () => panel(log)) as MiniElement, root as never);
  assert.deepEqual(log, ["mounted:attached"], "deferred to the single drain at the end");
});

/* ------------------------------------------------------ revealed later: Show */

test("onMount: fires for a branch Show reveals after the initial render", () => {
  const log: string[] = [];
  const open = state(false);
  const root = div();

  render(
    () =>
      Show({
        when: () => open(),
        // An accessor, so the branch is built when it is revealed rather than
        // at the enclosing render.
        children: () => panel(log),
      }),
    root as never,
  );
  assert.deepEqual(log, [], "nothing revealed yet, so nothing scheduled");

  open.set(true);
  assert.deepEqual(log, ["mounted:attached"], "it ran, and the node was in the document");
  assert.equal(root.querySelector("section")!.textContent, "panel");

  // Closing and reopening mounts a fresh branch, so it runs again.
  open.set(false);
  open.set(true);
  assert.deepEqual(log, ["mounted:attached", "mounted:attached"]);
});

test("onMount: a Show branch given as a VALUE is built at the enclosing render", () => {
  // Documented limitation rather than a bug the framework can fix: `children`
  // is a `Child`, so `children: panel(log)` has already been evaluated by the
  // time `Show` sees it. The callback it scheduled belongs to the enclosing
  // render, and that is when it runs - against a node that is not revealed.
  // Pass an accessor (the test above) when the work must happen on reveal.
  const log: string[] = [];
  const open = state(false);
  const root = div();
  render(() => Show({ when: () => open(), children: panel(log) }), root as never);

  assert.deepEqual(log, ["mounted:detached"], "built eagerly: this is why an accessor is the right shape");
  open.set(true);
  assert.deepEqual(log, ["mounted:detached"], "and it is not re-run on reveal");
});

/* ------------------------------------------------------- revealed later: For */

test("onMount: fires for rows For adds after the initial render", () => {
  const log: string[] = [];
  const items = state<number[]>([1]);
  const root = div();

  render(
    () =>
      For({
        each: () => items(),
        children: (n: number) => {
          const row = doc.createElement("p");
          row.textContent = String(n);
          onMount(() => log.push(`row ${n}:${row.parentNode ? "attached" : "detached"}`));
          return row as never;
        },
      }),
    root as never,
  );
  assert.deepEqual(log, ["row 1:attached"]);

  items.set([1, 2, 3]);
  assert.deepEqual(log, ["row 1:attached", "row 2:attached", "row 3:attached"]);
});

/* ------------------------------------------------------------- no leaking -- */

test("onMount: a callback from one render never fires inside the next one", () => {
  // The old failure mode: a callback that was never drained sat in the queue
  // and ran during an unrelated later render.
  const first: string[] = [];
  const second: string[] = [];
  const open = state(false);

  const rootA = div();
  render(() => Show({ when: () => open(), children: () => panel(first) }), rootA as never);
  assert.deepEqual(first, []);

  const rootB = div();
  render(() => panel(second), rootB as never);
  assert.deepEqual(second, ["mounted:attached"]);
  assert.deepEqual(first, [], "the unrevealed branch scheduled nothing, and nothing leaked into B");

  open.set(true);
  assert.deepEqual(first, ["mounted:attached"], "and it still runs when it is actually revealed");
});

test("onMount: server mode drains without running, for a late branch too", () => {
  const log: string[] = [];
  const open = state(false);
  const root = div();
  const previous = setServerMode(true);
  try {
    render(() => Show({ when: () => open(), children: () => panel(log) }), root as never);
    open.set(true);
    assert.deepEqual(log, [], "post-mount browser work has no place in a string render");
  } finally {
    setServerMode(previous);
  }
  // And the queue is empty afterwards, so the next client render is clean.
  const after: string[] = [];
  render(() => panel(after), div() as never);
  assert.deepEqual(after, ["mounted:attached"]);
});

test("onMount: a callback that mounts something drains that too", () => {
  const log: string[] = [];
  const root = div();
  render(() => {
    const host = doc.createElement("div");
    onMount(() => {
      log.push("outer");
      // Mounting from inside a mount callback: its own onMount must not be
      // left in the queue for a later render to pick up.
      render(() => panel(log), host as never);
    });
    return host as never;
  }, root as never);
  assert.deepEqual(log, ["outer", "mounted:attached"]);
});
