/**
 * Teste pentru dev server-ul RaptorBundle: fallback-ul history pentru rutele SPA
 * (deep-link si refresh pe subpagini) fara sa ascunda asset-urile lipsa.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { startDevServer } from "../../src/bundle/index.ts";

/** Ridica un dev server pe un port efemer intr-un proiect minimal temporar. */
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

test("dev server: o ruta de client primeste index.html, nu 404", async () => {
  await withServer(async (base) => {
    for (const route of ["/learn", "/learn/state-and-reactivity", "/playground"]) {
      const res = await fetch(base + route, asDocument);
      assert.equal(res.status, 200, `${route} ar trebui sa serveasca aplicatia`);
      assert.match(res.headers.get("content-type") ?? "", /text\/html/);
      // A trecut prin rewriteHtml: scriptul sursa a devenit bundle-ul dev.
      assert.match(await res.text(), /__raptor_bundle\.js/);
    }
  });
});

test("dev server: un asset lipsa ramane 404, nu primeste HTML", async () => {
  await withServer(async (base) => {
    // Cerut de browser ca sub-resursa (accept */*).
    const asset = await fetch(base + "/missing.js");
    assert.equal(asset.status, 404);

    // Chiar si tastat in bara de adrese, o cale cu extensie nu e ruta de client.
    const typed = await fetch(base + "/missing.png", asDocument);
    assert.equal(typed.status, 404);
  });
});

test("dev server: asset-urile reale si radacina sunt neatinse", async () => {
  await withServer(async (base) => {
    const svg = await fetch(base + "/logo.svg");
    assert.equal(svg.status, 200);
    assert.equal(svg.headers.get("content-type"), "image/svg+xml");

    const root = await fetch(base + "/", asDocument);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /__raptor_bundle\.js/);
  });
});
