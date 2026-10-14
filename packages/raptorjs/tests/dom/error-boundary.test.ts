/**
 * ErrorBoundary: a throw while building children or in an effect under them is
 * contained and swapped for a fallback; siblings outside the boundary stay live;
 * reset() re-mounts the children. Without a boundary the error still propagates,
 * so nothing is swallowed by default.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, type MiniElement } from "../../src/dom/testing/mini-dom.ts";
import { render, mountChild } from "../../src/dom/runtime.ts";
import { ErrorBoundary } from "../../src/dom/error.ts";
import { state } from "@raptorstack/raptorjs";

installMiniDom();
const doc = (globalThis as unknown as { document: any }).document;
const h = (tag: string): any => doc.createElement(tag);
const text = (tag: string, txt: string): any => {
  const el = h(tag);
  el.textContent = txt;
  return el;
};

test("ErrorBoundary: a throw while building children shows the fallback", () => {
  const root = h("div") as MiniElement;
  render(
    () =>
      ErrorBoundary({
        fallback: text("p", "fallback"),
        children: () => {
          const box = h("div");
          mountChild(box, () => {
            throw new Error("build fail");
          }, null);
          return box;
        },
      }),
    root,
  );
  assert.equal(root.querySelector("p")!.textContent, "fallback");
  assert.equal(root.querySelector("div"), null); // the failed children scope was discarded
});

test("ErrorBoundary: an effect that throws on update swaps to the fallback", () => {
  const root = h("div") as MiniElement;
  const n = state(0);
  render(
    () =>
      ErrorBoundary({
        fallback: (err) => text("p", `caught: ${(err as Error).message}`),
        children: () => {
          const box = h("div");
          mountChild(box, () => {
            if (n() > 0) throw new Error("render fail");
            return "ok";
          }, null);
          return box;
        },
      }),
    root,
  );

  assert.equal(root.querySelector("div")!.textContent, "ok");
  n.set(1); // the dynamic region re-runs and throws
  assert.equal(root.querySelector("p")!.textContent, "caught: render fail");
});

test("ErrorBoundary: a throw inside does not tear down siblings outside", () => {
  const root = h("div") as MiniElement;
  const n = state(0);
  render(() => {
    const app = h("div");
    app.appendChild(text("span", "safe"));
    mountChild(
      app,
      ErrorBoundary({
        fallback: text("p", "boom"),
        children: () => {
          const b = h("div");
          mountChild(b, () => {
            if (n() > 0) throw new Error("e");
            return "live";
          }, null);
          return b;
        },
      }),
      null,
    );
    return app;
  }, root);

  assert.equal(root.querySelector("span")!.textContent, "safe");
  n.set(1);
  assert.equal(root.querySelector("span")!.textContent, "safe"); // sibling still alive
  assert.equal(root.querySelector("p")!.textContent, "boom"); // boundary swapped
});

test("ErrorBoundary: reset() re-mounts the children", () => {
  const root = h("div") as MiniElement;
  const fail = state(true);
  let resetFn: (() => void) | null = null;

  render(
    () =>
      ErrorBoundary({
        fallback: (_err, reset) => {
          resetFn = reset;
          return text("p", "err");
        },
        children: () => {
          const box = h("div");
          mountChild(box, () => {
            if (fail.peek()) throw new Error("x");
            return "recovered";
          }, null);
          return box;
        },
      }),
    root,
  );

  assert.equal(root.querySelector("p")!.textContent, "err");
  fail.set(false);
  resetFn!();
  assert.equal(root.querySelector("div")!.textContent, "recovered");
});

test("without a boundary, an effect error propagates (nothing swallowed)", () => {
  const root = h("div") as MiniElement;
  const n = state(0);
  render(() => {
    const b = h("div");
    mountChild(b, () => {
      if (n() > 0) throw new Error("boom");
      return "x";
    }, null);
    return b;
  }, root);
  assert.throws(() => n.set(1), /boom/);
});
