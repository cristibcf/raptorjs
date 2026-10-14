/**
 * Client router: pattern matching (static, params, wildcard), reactive route
 * rendering on navigate(), and Link intercepting internal clicks while leaving
 * external links to the browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, type MiniElement } from "../../src/dom/testing/mini-dom.ts";
import { render } from "../../src/dom/runtime.ts";
import { Router, Link, navigate, pathname, matchRoutes, type RouteDef } from "../../src/dom/router.ts";

installMiniDom();
const doc = (globalThis as unknown as { document: any }).document;
const h = (tag: string): any => doc.createElement(tag);
const text = (tag: string, txt: string): any => {
  const el = h(tag);
  el.textContent = txt;
  return el;
};

test("matchRoutes: static, params, wildcard and no-match", () => {
  const routes: RouteDef[] = [
    { path: "/", component: () => null },
    { path: "/users/:id", component: () => null },
    { path: "/files/*", component: () => null },
  ];
  assert.equal(matchRoutes(routes, "/")!.route.path, "/");
  const user = matchRoutes(routes, "/users/42");
  assert.equal(user!.route.path, "/users/:id");
  assert.deepEqual(user!.params, { id: "42" });
  assert.equal(matchRoutes(routes, "/files/a/b.txt")!.params.wild, "a/b.txt");
  assert.equal(matchRoutes(routes, "/users/42?tab=1")!.params.id, "42"); // query ignored
  assert.equal(matchRoutes(routes, "/nope"), null);
});

test("Router: renders the matched route and reacts to navigate()", () => {
  navigate("/");
  const root = h("div") as MiniElement;
  const routes: RouteDef[] = [
    { path: "/", component: () => text("p", "home") },
    { path: "/about", component: () => text("p", "about") },
    { path: "/users/:id", component: (p) => text("p", `user ${p.id}`) },
  ];

  render(() => Router({ routes, fallback: text("p", "missing") }), root);
  assert.equal(root.querySelector("p")!.textContent, "home");

  navigate("/about");
  assert.equal(root.querySelector("p")!.textContent, "about");

  navigate("/users/7");
  assert.equal(root.querySelector("p")!.textContent, "user 7");

  navigate("/zzz");
  assert.equal(root.querySelector("p")!.textContent, "missing");
});

test("Link: a plain left click navigates internally", () => {
  navigate("/");
  const root = h("div") as MiniElement;
  render(() => Link({ href: "/about", children: "About" }), root);

  const a = root.querySelector("a")!;
  const event = (a as any).dispatch("click", { button: 0 });
  assert.equal(pathname(), "/about");
  assert.equal(event.defaultPrevented, true);
});

test("Link: modified clicks and external links fall through", () => {
  navigate("/start");
  const root = h("div") as MiniElement;
  render(() => {
    const box = h("div");
    box.appendChild(Link({ href: "/internal", children: "x" }));
    box.appendChild(Link({ href: "https://example.com", children: "y" }));
    return box;
  }, root);

  const [internal, external] = root.querySelectorAll("a");

  // Cmd/Ctrl-click opens a new tab: not intercepted.
  const metaClick = (internal as any).dispatch("click", { button: 0, metaKey: true });
  assert.equal(metaClick.defaultPrevented, false);
  assert.equal(pathname(), "/start");

  // External URL: left to the browser.
  const extClick = (external as any).dispatch("click", { button: 0 });
  assert.equal(extClick.defaultPrevented, false);
  assert.equal(pathname(), "/start");
});
