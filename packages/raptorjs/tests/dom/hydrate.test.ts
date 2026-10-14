/**
 * hydrate() (SSG 3C, client-takeover): boots a client app over a prerendered
 * container by client-rendering and replacing the server markup in one swap. The
 * result is interactive; the server markup is gone; onMount runs (client boot).
 * (This runtime builds bottom-up, so hydrate does not reuse the server DOM - see
 * runtime.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom } from "../../src/dom/testing/mini-dom.ts";
import { hydrate, createElement, mountChild, onMount } from "../../src/dom/runtime.ts";
import { state } from "@raptorstack/raptorjs";

test("hydrate: replaces prerendered markup and is interactive", () => {
  installMiniDom();
  const doc = (globalThis as unknown as { document: any }).document;
  const container = doc.createElement("div");

  // Simulate prerendered server markup already in the container.
  const stale = doc.createElement("p");
  stale.textContent = "server";
  container.appendChild(stale);
  assert.equal(container.querySelector("p")!.textContent, "server");

  const n = state(0);
  const dispose = hydrate(() => {
    const btn = createElement("button");
    btn.addEventListener("click", () => n.update((v) => v + 1));
    const span = createElement("span");
    mountChild(span, () => `count: ${n()}`, null);
    btn.appendChild(span);
    return btn;
  }, container);

  // Server markup replaced by the client render.
  assert.equal(container.querySelector("p"), null);
  assert.equal(container.querySelector("span")!.textContent, "count: 0");

  // Interactive: the client bound its events.
  container.querySelector("button")!.click();
  assert.equal(container.querySelector("span")!.textContent, "count: 1");

  dispose();
  assert.equal(container.childNodes.length, 0);
});

test("hydrate: runs onMount on client boot", () => {
  installMiniDom();
  const container = (globalThis as unknown as { document: any }).document.createElement("div");
  let mounted = false;
  hydrate(() => {
    onMount(() => {
      mounted = true;
    });
    return createElement("div");
  }, container);
  assert.equal(mounted, true);
});
