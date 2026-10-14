/**
 * `raptor-bundle --prerender` orchestration (SSG 3D CLI glue). The prerender
 * engine itself is tested in @raptorstack/raptorjs; here we cover the engine-side
 * wiring: writing one file per emitted page, passing options through, and the
 * error paths (bad/missing routes module).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  writePrerendered,
  prerenderFromModule,
  runPrerenderBuild,
  type PrerenderFn,
} from "../../src/bundle/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");

function inDir(run: (dir: string) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "raptor-pre-"));
  return Promise.resolve(run(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("writePrerendered: writes one file per emitted page at its path", async () => {
  await inDir((dir) => {
    const fake: PrerenderFn = (_opts, emit) => {
      emit({ path: "/", file: "index.html", html: "<!doctype html><p>home</p>" });
      emit({ path: "/about", file: "about/index.html", html: "<!doctype html><p>about</p>" });
      return 2;
    };
    const n = writePrerendered(fake, { routes: [], outDir: dir, bundleSrc: "/b.js" });
    assert.equal(n, 2);
    assert.match(readFileSync(join(dir, "index.html"), "utf8"), /home/);
    assert.match(readFileSync(join(dir, "about", "index.html"), "utf8"), /about/);
  });
});

test("writePrerendered: passes options through to the prerender engine", async () => {
  await inDir((dir) => {
    let received: any = null;
    const fake: PrerenderFn = (opts) => {
      received = opts;
      return 0;
    };
    writePrerendered(fake, {
      routes: [1, 2],
      outDir: dir,
      bundleSrc: "/x.js",
      cssHref: "/x.css",
      lang: "en",
      getStaticPaths: () => ["/a"],
    });
    assert.deepEqual(received.routes, [1, 2]);
    assert.equal(received.bundleSrc, "/x.js");
    assert.equal(received.cssHref, "/x.css");
    assert.equal(received.lang, "en");
    assert.deepEqual(received.getStaticPaths(), ["/a"]);
  });
});

test("prerenderFromModule: errors when the module has no routes export", async () => {
  await inDir(async (dir) => {
    const mod = join(dir, "routes.mjs");
    writeFileSync(mod, "export const notRoutes = 1;\n");
    const res = await prerenderFromModule({ routesModule: mod, outDir: dir, bundleSrc: "/b.js" });
    assert.equal(res.ok, false);
    assert.match(res.message, /must export `routes`/);
  });
});

test("prerenderFromModule: errors when the module cannot be loaded", async () => {
  const res = await prerenderFromModule({ routesModule: "/no/such/routes.mjs", outDir: ".", bundleSrc: "/b.js" });
  assert.equal(res.ok, false);
  assert.match(res.message, /cannot load routes module/);
});

test("runPrerenderBuild: builds then errors without --routes", async () => {
  await inDir(async (dir) => {
    const entry = join(repoRoot, "examples", "counter", "src", "main.tsx");
    const res = await runPrerenderBuild(["build", entry, "--out", join(dir, "bundle.js"), "--prerender"]);
    assert.equal(res.ok, false);
    assert.match(res.message, /--prerender requires --routes/);
  });
});
