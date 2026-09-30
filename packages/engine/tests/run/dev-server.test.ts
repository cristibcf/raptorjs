import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RaptorDevServer, readFirstSseEvent } from "../../src/run/index.ts";
import type { DevUpdate } from "@raptorstack/engine";

/**
 * Wait for a condition, not a duration.
 *
 * A fixed `setTimeout` in a network test is an assumption about how loaded the
 * machine is, and the assumption breaks exactly when the suite runs in parallel
 * - that is, in CI. Here we wait until the thing being checked has actually
 * happened, with a ceiling so it doesn't hang forever if it never does.
 */
async function until(conditie: () => boolean, ceAsteptam: string, limitaMs = 4000): Promise<void> {
  const pana = Date.now() + limitaMs;
  while (!conditie()) {
    if (Date.now() > pana) throw new Error(`timeout: ${ceAsteptam}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const SRC = `
component App {
  const count = state(0)
  const doubled = derived(() => count * 2)
  <div class="app">
    <button on:click={count++}>increment</button>
    <span class="label">count: {count}</span>
    <span data-d={doubled}>{doubled}</span>
  </div>
}
`;

test("dev: applyChange - noop / patch / remount + refresh SSR", async () => {
  const server = new RaptorDevServer({ files: { "/App.raptor": SRC }, entry: "/App.raptor" });
  const events: DevUpdate[] = [];
  server.onHmr((u) => events.push(u));

  // Identical source -> no-op, no broadcast.
  assert.equal(server.applyChange("/App.raptor", SRC).kind, "noop");
  assert.equal(events.length, 0);

  // Derived edit -> patch (state-preserving).
  const patched = server.applyChange("/App.raptor", SRC.replace("count * 2", "count * 3"));
  assert.equal(patched.kind, "patch");
  assert.equal(events.length, 1);

  // Structural edit (static text) -> remount + SSR reflects the new output.
  const remount = server.applyChange("/App.raptor", SRC.replace("count:", "COUNT:"));
  assert.equal(remount.kind, "remount");
  assert.match(server.render("/")!, /COUNT:/);

  await server.close();
});

test("dev: update log in the §12 style", async () => {
  const logs: string[] = [];
  const server = new RaptorDevServer({
    files: { "/App.raptor": SRC },
    entry: "/App.raptor",
    onLog: (l) => logs.push(l),
  });
  server.applyChange("/App.raptor", SRC.replace("count * 2", "count * 3"));
  assert.ok(logs.some((l) => /RaptorDev update #\d+/.test(l)));
  await server.close();
});

test("dev: HTTP serves SSR with the injected HMR client script", async () => {
  const server = new RaptorDevServer({ files: { "/App.raptor": SRC }, entry: "/App.raptor" });
  const port = await server.listen(0);
  try {
    const home = await fetch(`http://127.0.0.1:${port}/`);
    const html = await home.text();
    assert.match(html, /id="raptor-root"/);
    assert.match(html, /\/@raptorstack\/client\.js/);

    const client = await fetch(`http://127.0.0.1:${port}/@raptorstack/client.js`);
    assert.match(await client.text(), /EventSource/);
  } finally {
    await server.close();
  }
});

test("dev: SSE sends the HMR update to connected clients", async () => {
  const server = new RaptorDevServer({ files: { "/App.raptor": SRC }, entry: "/App.raptor" });
  const port = await server.listen(0);
  try {
    const event = readFirstSseEvent(`http://127.0.0.1:${port}/@raptorstack/hmr`);
    // We wait for the CONDITION, not a timer: a `setTimeout(60)` passed on an
    // idle machine and failed on a loaded one, and a broadcast to zero clients
    // could no longer be recovered - the test then waited 4 seconds in vain.
    await until(() => server.hmrClientCount > 0, "no SSE client registered");
    server.applyChange("/App.raptor", SRC.replace("count * 2", "count * 3"));
    const u = (await event) as { kind: string };
    assert.equal(u.kind, "patch");
  } finally {
    await server.close();
  }
});

test("dev: real fs.watch triggers recompilation when the file is written", async () => {
  const dir = mkdtempSync(join(tmpdir(), "raptor-dev-"));
  const file = join(dir, "App.raptor");
  writeFileSync(file, SRC);
  const server = new RaptorDevServer({ files: { [file]: SRC }, entry: file });
  try {
    const got = new Promise<DevUpdate>((res, rej) => {
      server.onHmr(res);
      setTimeout(() => rej(new Error("timeout fs.watch")), 4000);
    });
    server.watch(dir);
    // `fs.watch` doesn't say when it's ready to watch, so we rewrite until the
    // event actually arrives. A single write after a `setTimeout(60)` gets lost
    // on a loaded machine, and then there's no one left to recover it.
    const rescrie = setInterval(() => writeFileSync(file, SRC.replace("count * 2", "count * 3")), 50);
    let u: DevUpdate;
    try {
      u = await got;
    } finally {
      clearInterval(rescrie);
    }
    assert.equal(u.kind, "patch");
  } finally {
    await server.close();
  }
});
