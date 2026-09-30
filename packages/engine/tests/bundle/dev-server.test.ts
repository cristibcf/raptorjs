/**
 * Tests for the RaptorBundle dev server: the history fallback for SPA routes
 * (deep-link and refresh on subpages) without hiding missing assets.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { startDevServer } from "../../src/bundle/index.ts";

/** Spins up a dev server on an ephemeral port in a minimal temporary project. */
function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "raptor-dev-"));
  writeFileSync(join(dir, "index.html"), `<!doctype html><div id="app"></div><script type="module" src="/src/main.tsx"></script>`);
  writeFileSync(join(dir, "main.tsx"), `export {};`);
  writeFileSync(join(dir, "logo.svg"), `<svg xmlns="http://www.w3.org/2000/svg"/>`);

  const server = startDevServer({ entry: join(dir, "main.tsx"), root: dir, port: 0 });
  return new Promise<void>((resolve, reject) => {
    server.on("listening", () => {
      const { port } = server.address() as AddressInfo;
      run(`http://127.0.0.1:${port}`)
        .then(resolve, reject)
        .finally(() => {
          server.close();
          rmSync(dir, { recursive: true, force: true });
        });
    });
  });
}

const asDocument = { headers: { accept: "text/html,application/xhtml+xml" } };

test("dev server: a client route gets index.html, not 404", async () => {
  await withServer(async (base) => {
    for (const route of ["/learn", "/learn/state-and-reactivity", "/playground"]) {
      const res = await fetch(base + route, asDocument);
      assert.equal(res.status, 200, `${route} should serve the app`);
      assert.match(res.headers.get("content-type") ?? "", /text\/html/);
      // It went through rewriteHtml: the source script became the dev bundle.
      assert.match(await res.text(), /__raptor_bundle\.js/);
    }
  });
});

test("dev server: a missing asset stays 404, does not get HTML", async () => {
  await withServer(async (base) => {
    // Requested by the browser as a sub-resource (accept */*).
    const asset = await fetch(base + "/missing.js");
    assert.equal(asset.status, 404);

    // Even when typed in the address bar, a path with an extension is not a client route.
    const typed = await fetch(base + "/missing.png", asDocument);
    assert.equal(typed.status, 404);
  });
});

test("dev server: real assets and the root are untouched", async () => {
  await withServer(async (base) => {
    const svg = await fetch(base + "/logo.svg");
    assert.equal(svg.status, 200);
    assert.equal(svg.headers.get("content-type"), "image/svg+xml");

    const root = await fetch(base + "/", asDocument);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /__raptor_bundle\.js/);
  });
});
