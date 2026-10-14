/**
 * The dev server collects `import "./x.css"` the same way the build does: it
 * serves the combined stylesheet at /__raptor_bundle.css and injects a `<link>`
 * into index.html, so dev matches a production build instead of silently dropping
 * styles.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { startDevServer } from "../../src/bundle/index.ts";

function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "raptor-dev-css-"));
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><head></head><body><div id="app"></div><script type="module" src="/main.ts"></script></body>`,
  );
  writeFileSync(join(dir, "main.ts"), `import "./style.css";\nexport {};`);
  writeFileSync(join(dir, "style.css"), `.app { color: rebeccapurple; }`);

  const server = startDevServer({ entry: join(dir, "main.ts"), root: dir, port: 0 });
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

test("dev server: serves collected CSS and links it from index.html", async () => {
  await withServer(async (base) => {
    const html = await (await fetch(base + "/", asDocument)).text();
    assert.match(html, /<link rel="stylesheet" href="\/__raptor_bundle\.css/);

    const cssRes = await fetch(base + "/__raptor_bundle.css");
    assert.equal(cssRes.status, 200);
    assert.match(cssRes.headers.get("content-type") ?? "", /text\/css/);
    assert.match(await cssRes.text(), /rebeccapurple/);
  });
});
