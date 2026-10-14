/**
 * Prerender driver (SSG 3D): enumerates routes, renders each to a full HTML
 * document with its per-route head, an `#app` container holding the markup, a
 * stylesheet link and the client bundle script. getStaticPaths expands dynamic
 * routes; default is the fully-static routes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom } from "../../src/dom/testing/mini-dom.ts";
import { createElement, mountChild } from "../../src/dom/runtime.ts";
import { Title } from "../../src/dom/head.ts";
import { prerender, prerenderToArray } from "../../src/dom/prerender.ts";
import type { RouteDef } from "../../src/dom/router.ts";

installMiniDom();

const el = (tag: string, text: string): any => {
  const node = createElement(tag);
  mountChild(node, text, null);
  return node;
};

test("prerender: one document per static route, with bundle + css + container", () => {
  const routes: RouteDef[] = [
    { path: "/", component: () => el("h1", "Home") },
    {
      path: "/about",
      component: () => {
        const d = createElement("div");
        mountChild(d, Title("About Us"), null);
        mountChild(d, "About page", null);
        return d;
      },
    },
  ];

  const pages = prerenderToArray({ routes, bundleSrc: "/bundle.js", cssHref: "/bundle.css", lang: "en" });
  assert.deepEqual(pages.map((p) => p.file).sort(), ["about/index.html", "index.html"]);

  const home = pages.find((p) => p.path === "/")!.html;
  assert.match(home, /^<!doctype html>/);
  assert.match(home, /<html lang="en">/);
  assert.match(home, /<link rel="stylesheet" href="\/bundle\.css">/);
  assert.match(home, /<div id="app"><h1>Home<\/h1>/); // Router leaves a dynamic-region anchor comment
  assert.match(home, /<script type="module" src="\/bundle\.js"><\/script>/);

  const about = pages.find((p) => p.path === "/about")!.html;
  assert.match(about, /<title>About Us<\/title>/); // per-route head in <head>
  assert.match(about, /<div id="app"><div>About page<\/div>/);
});

test("prerender: getStaticPaths expands a dynamic route", () => {
  const routes: RouteDef[] = [
    { path: "/posts/:slug", component: (p) => el("article", `post ${p.slug}`) },
  ];

  const pages = prerenderToArray({
    routes,
    getStaticPaths: () => ["/posts/a", "/posts/b"],
    bundleSrc: "/b.js",
  });

  assert.deepEqual(pages.map((p) => p.file), ["posts/a/index.html", "posts/b/index.html"]);
  assert.match(pages[0]!.html, /<article>post a<\/article>/);
  assert.match(pages[1]!.html, /<article>post b<\/article>/);
});

test("prerender: default path set is the fully-static routes only", () => {
  const routes: RouteDef[] = [
    { path: "/", component: () => el("h1", "H") },
    { path: "/contact", component: () => el("h1", "C") },
    { path: "/users/:id", component: () => el("h1", "U") }, // dynamic: skipped by default
  ];
  const pages = prerenderToArray({ routes, bundleSrc: "/b.js" });
  assert.deepEqual(pages.map((p) => p.path).sort(), ["/", "/contact"]);
});

test("prerender: streaming emit writes one page at a time", () => {
  const routes: RouteDef[] = [
    { path: "/", component: () => el("h1", "H") },
    { path: "/x", component: () => el("h1", "X") },
  ];
  const seen: string[] = [];
  const count = prerender({ routes, bundleSrc: "/b.js" }, (page) => seen.push(page.path));
  assert.equal(count, 2);
  assert.deepEqual(seen.sort(), ["/", "/x"]);
});
