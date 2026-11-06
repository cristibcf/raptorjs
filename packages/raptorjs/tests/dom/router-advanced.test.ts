/**
 * Router: guards, lazy components, nested routes, query parameters and scroll
 * restoration (v0.2.1).
 *
 * The flat, synchronous route table of 0.2.0 is covered by router.test.ts and
 * must keep passing untouched; this file is only the additions. The one worth
 * reading is the nested case: moving between two screens under a shell must
 * leave the shell's own region alone, because a shell that rebuilds itself on
 * every navigation is the thing nesting is supposed to fix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "../../src/dom/testing/mini-dom.ts";
import { render } from "../../src/dom/runtime.ts";
import { R } from "../../src/dom/hyperscript.ts";
import {
  Outlet,
  Router,
  hash,
  lazy,
  matchRoutes,
  navigate,
  pathname,
  resolveRoute,
  routePatterns,
  searchParams,
  type RouteDef,
} from "../../src/dom/router.ts";

installMiniDom();
const doc = (globalThis as unknown as { document: { createElement(tag: string): MiniElement } }).document;
const text = (tag: string, txt: string): MiniElement => {
  const el = doc.createElement(tag);
  el.textContent = txt;
  return el;
};
/** Lets a lazy component's promise settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/* ------------------------------------------------------------------ guards - */

test("guards: a string redirects, false denies, true lets it through", () => {
  let session: string | null = null;
  const routes: RouteDef[] = [
    { path: "/login", component: () => text("p", "login") },
    { path: "/admin", beforeEnter: () => false, component: () => text("p", "admin") },
    { path: "/app", beforeEnter: () => (session ? true : "/login"), component: () => text("p", "app") },
  ];

  // No session: the guard names where to go instead.
  let resolved = resolveRoute(routes, "/app");
  assert.equal(resolved.path, "/login");
  assert.equal(resolved.redirected, true);
  assert.equal(resolved.match!.route.path, "/login");

  // With a session, the same route resolves to itself and is not a redirect.
  session = "ana";
  resolved = resolveRoute(routes, "/app");
  assert.equal(resolved.path, "/app");
  assert.equal(resolved.redirected, false);
  assert.equal(resolved.match!.route.path, "/app");

  // `false` is not a redirect: the match is dropped so the fallback renders.
  resolved = resolveRoute(routes, "/admin");
  assert.equal(resolved.match, null);
  assert.equal(resolved.redirected, false);
  assert.equal(resolved.path, "/admin", "the URL is not rewritten by a denial");
});

test("guards: matchRoutes stays pure, so a prerender is never redirected", () => {
  const routes: RouteDef[] = [
    { path: "/login", component: () => null },
    { path: "/app", beforeEnter: () => "/login", component: () => null },
  ];
  // The same table, through the two entry points.
  assert.equal(matchRoutes(routes, "/app")!.route.path, "/app", "the matcher reports what matched");
  assert.equal(resolveRoute(routes, "/app").path, "/login", "the resolver reports where to go");
});

test("guards: a guard that redirects to a guard that redirects back warns instead of hanging", () => {
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
  try {
    const routes: RouteDef[] = [
      { path: "/a", beforeEnter: () => "/b", component: () => null },
      { path: "/b", beforeEnter: () => "/a", component: () => null },
    ];
    const resolved = resolveRoute(routes, "/a");
    assert.equal(resolved.match, null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /redirects/);
  } finally {
    console.warn = realWarn;
  }
});

test("guards: a redirect reaches the URL, so Back does not return to a path never rendered", () => {
  navigate("/");
  const root = doc.createElement("div");
  let session: string | null = null;
  const routes: RouteDef[] = [
    { path: "/", component: () => text("p", "home") },
    { path: "/login", component: () => text("p", "login") },
    { path: "/app", beforeEnter: () => (session ? true : "/login"), component: () => text("p", "app") },
  ];
  render(() => Router({ routes, fallback: text("p", "missing") }), root as never);

  navigate("/app");
  assert.equal(root.querySelector("p")!.textContent, "login", "rendered the redirect target, no flash");
  assert.equal(pathname(), "/login", "and the location followed");

  session = "ana";
  navigate("/app");
  assert.equal(root.querySelector("p")!.textContent, "app");
  assert.equal(pathname(), "/app");
});

/* ------------------------------------------------------------------- lazy -- */

test("lazy: the fallback shows, then the real screen, and the module loads once", async () => {
  navigate("/");
  const root = doc.createElement("div");
  let loads = 0;
  const Settings = lazy(
    async () => {
      loads++;
      await Promise.resolve();
      return { default: () => text("p", "settings") };
    },
    { pending: text("p", "loading") },
  );
  const routes: RouteDef[] = [
    { path: "/", component: () => text("p", "home") },
    { path: "/settings", component: Settings },
  ];
  render(() => Router({ routes }), root as never);

  navigate("/settings");
  assert.equal(root.querySelector("p")!.textContent, "loading", "the fallback, while the module is in flight");
  await settle();
  assert.equal(root.querySelector("p")!.textContent, "settings");

  // Second visit: the module is cached, so the screen is there synchronously -
  // which is what SSR and a prerender need, having no frame to wait in.
  navigate("/");
  navigate("/settings");
  assert.equal(root.querySelector("p")!.textContent, "settings", "no second loading frame");
  assert.equal(loads, 1);
});

test("lazy: a component returning a promise directly uses the Router's pending child", async () => {
  navigate("/");
  const root = doc.createElement("div");
  const routes: RouteDef[] = [
    { path: "/", component: () => text("p", "home") },
    { path: "/slow", component: async () => text("p", "slow") },
  ];
  render(() => Router({ routes, pending: text("p", "wait") }), root as never);

  navigate("/slow");
  assert.equal(root.querySelector("p")!.textContent, "wait");
  await settle();
  assert.equal(root.querySelector("p")!.textContent, "slow");
});

test("lazy: a module that fails to load reports it and leaves the fallback up", async () => {
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
  try {
    navigate("/");
    const root = doc.createElement("div");
    const routes: RouteDef[] = [
      { path: "/", component: () => text("p", "home") },
      { path: "/broken", component: lazy(() => Promise.reject(new Error("offline")), { pending: text("p", "loading") }) },
    ];
    render(() => Router({ routes }), root as never);

    navigate("/broken");
    await settle();
    assert.equal(root.querySelector("p")!.textContent, "loading", "not a blank screen");
    assert.ok(
      warnings.some((w) => w.includes("[raptor]") && w.includes("offline")),
      warnings.join(" | "),
    );
  } finally {
    console.warn = realWarn;
  }
});

/* ----------------------------------------------------------------- nested -- */

/** `/app` shell with two children and an index. */
function nestedRoutes(onShell: () => void): RouteDef[] {
  return [
    {
      path: "/app",
      component: () => {
        onShell();
        // `Outlet()` returns a Child, so it goes where any child goes.
        return R.div({}, text("header", "shell"), Outlet()) as MiniElement;
      },
      children: [
        { path: "", component: () => text("p", "index") },
        { path: "inbox", component: () => text("p", "inbox") },
        { path: "users/:id", component: (params) => text("p", `user ${params.id}`) },
      ],
    },
    { path: "/", component: () => text("p", "home") },
  ];
}

test("nested: the full pattern is what matches, and the chain is reported", () => {
  const routes = nestedRoutes(() => {});
  assert.deepEqual(routePatterns(routes), ["/app", "/app/inbox", "/app/users/:id", "/app", "/"]);

  const inbox = matchRoutes(routes, "/app/inbox")!;
  assert.equal(inbox.pattern, "/app/inbox");
  assert.equal(inbox.route.path, "inbox", "the leaf route");
  assert.deepEqual(
    inbox.chain.map((r) => r.path),
    ["/app", "inbox"],
  );

  // The index child wins over the parent rendering alone on the same path.
  assert.equal(matchRoutes(routes, "/app")!.route.path, "");
  assert.equal(matchRoutes(routes, "/app/users/42")!.params.id, "42");
});

test("nested: moving between two children does not rebuild the shell", () => {
  navigate("/app");
  let shellRuns = 0;
  const root = doc.createElement("div");
  render(() => Router({ routes: nestedRoutes(() => shellRuns++), fallback: text("p", "missing") }), root as never);

  assert.equal(root.querySelector("header")!.textContent, "shell");
  assert.equal(root.querySelector("p")!.textContent, "index");
  assert.equal(shellRuns, 1);

  resetStats();
  navigate("/app/inbox");
  assert.equal(root.querySelector("p")!.textContent, "inbox");
  assert.equal(shellRuns, 1, "the shell component did not re-run");
  assert.equal(stats.createElement, 1, "one element: the new screen, not the shell");

  navigate("/app/users/7");
  assert.equal(root.querySelector("p")!.textContent, "user 7");
  assert.equal(shellRuns, 1, "a param belonging to the child does not touch the shell");

  navigate("/app/users/8");
  assert.equal(root.querySelector("p")!.textContent, "user 8");
  assert.equal(shellRuns, 1);

  // Leaving the shell entirely does rebuild it on the way back.
  navigate("/");
  assert.equal(root.querySelector("header"), null, "the shell is gone");
  assert.equal(root.querySelector("p")!.textContent, "home");
  navigate("/app/inbox");
  assert.equal(shellRuns, 2);
});

test("nested: a guard on the shell protects every screen under it", () => {
  let session: string | null = null;
  const routes: RouteDef[] = [
    { path: "/login", component: () => text("p", "login") },
    {
      path: "/app",
      beforeEnter: () => (session ? true : "/login"),
      component: () => R.div({}, Outlet()) as MiniElement,
      children: [{ path: "inbox", component: () => text("p", "inbox") }],
    },
  ];
  assert.equal(resolveRoute(routes, "/app/inbox").path, "/login");
  session = "ana";
  assert.equal(resolveRoute(routes, "/app/inbox").match!.route.path, "inbox");
});

/* ------------------------------------------------------------------ query -- */

test("query: searchParams and hash are reactive reads, parsed for you", () => {
  navigate("/search?q=raptor&page=2#results");
  const params = searchParams();
  assert.equal(params.get("q"), "raptor");
  assert.equal(params.get("page"), "2");
  assert.equal(hash(), "#results");
  assert.equal(pathname(), "/search", "the pathname is still just the path");

  navigate("/search?q=wire");
  assert.equal(searchParams().get("q"), "wire");
  assert.equal(searchParams().get("page"), null);
  assert.equal(hash(), "");

  // A fresh instance per read: mutating it cannot corrupt another reader.
  const mine = searchParams();
  mine.set("q", "mutated");
  assert.equal(searchParams().get("q"), "wire");
});

test("query: a query-only change does not remount the route", () => {
  navigate("/list?page=1");
  let runs = 0;
  const root = doc.createElement("div");
  const routes: RouteDef[] = [
    {
      path: "/list",
      component: () => {
        runs++;
        return R.p({}, () => `page ${searchParams().get("page") ?? "1"}`) as MiniElement;
      },
    },
  ];
  render(() => Router({ routes }), root as never);
  assert.equal(root.querySelector("p")!.textContent, "page 1");
  assert.equal(runs, 1);

  resetStats();
  navigate("/list?page=2");
  assert.equal(root.querySelector("p")!.textContent, "page 2", "the binding followed the query");
  assert.equal(runs, 1, "the component did not re-run: the path did not change");
  assert.equal(stats.createElement, 0);
  assert.equal(stats.textUpdate, 1);
});
