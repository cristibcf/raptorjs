import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RaptorDevServer, readFirstSseEvent } from "../../src/run/index.ts";
import type { DevUpdate } from "@raptor/engine";

/**
 * Asteapta o conditie, nu o durata.
 *
 * Un `setTimeout` fix intr-un test de retea e o presupunere despre cat de
 * incarcata e masina, si presupunerea cade exact cand suita ruleaza in
 * paralel - adica in CI. Aici asteptam pana cand lucrul verificat chiar s-a
 * intamplat, cu un plafon care sa nu atarne la infinit daca nu se intampla.
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

  // Sursa identica -> no-op, fara broadcast.
  assert.equal(server.applyChange("/App.raptor", SRC).kind, "noop");
  assert.equal(events.length, 0);

  // Edit de derived -> patch (state-preserving).
  const patched = server.applyChange("/App.raptor", SRC.replace("count * 2", "count * 3"));
  assert.equal(patched.kind, "patch");
  assert.equal(events.length, 1);

  // Edit structural (text static) -> remount + SSR reflecta noul output.
  const remount = server.applyChange("/App.raptor", SRC.replace("count:", "COUNT:"));
  assert.equal(remount.kind, "remount");
  assert.match(server.render("/")!, /COUNT:/);

  await server.close();
});

test("dev: log-ul de update in stilul §12", async () => {
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

test("dev: HTTP serveste SSR cu scriptul client HMR injectat", async () => {
  const server = new RaptorDevServer({ files: { "/App.raptor": SRC }, entry: "/App.raptor" });
  const port = await server.listen(0);
  try {
    const home = await fetch(`http://127.0.0.1:${port}/`);
    const html = await home.text();
    assert.match(html, /id="raptor-root"/);
    assert.match(html, /\/@raptor\/client\.js/);

    const client = await fetch(`http://127.0.0.1:${port}/@raptor/client.js`);
    assert.match(await client.text(), /EventSource/);
  } finally {
    await server.close();
  }
});

test("dev: SSE trimite update-ul HMR clientilor conectati", async () => {
  const server = new RaptorDevServer({ files: { "/App.raptor": SRC }, entry: "/App.raptor" });
  const port = await server.listen(0);
  try {
    const event = readFirstSseEvent(`http://127.0.0.1:${port}/@raptor/hmr`);
    // Asteptam CONDITIA, nu un cronometru: un `setTimeout(60)` trecea pe o
    // masina libera si pica pe una incarcata, iar difuzarea catre zero clienti
    // nu se mai putea recupera - testul astepta apoi 4 secunde degeaba.
    await until(() => server.hmrClientCount > 0, "niciun client SSE inregistrat");
    server.applyChange("/App.raptor", SRC.replace("count * 2", "count * 3"));
    const u = (await event) as { kind: string };
    assert.equal(u.kind, "patch");
  } finally {
    await server.close();
  }
});

test("dev: fs.watch real declanseaza recompilarea la scrierea fisierului", async () => {
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
    // `fs.watch` nu spune cand e gata de urmarit, deci rescriem pana cand
    // evenimentul chiar ajunge. O singura scriere dupa un `setTimeout(60)` se
    // pierde pe o masina incarcata, si atunci nu mai are cine sa o recupereze.
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
