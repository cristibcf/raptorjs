import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModule } from "@raptor/engine";
import { RaptorClient } from "@raptor/wire-client";
import {
  RaptorRuntime,
  matchRoute,
  renderComponent,
  evalExpr,
  createNodeServer,
  listen,
  closeServer,
  runRunCli,
} from "../src/index.ts";
import { parseModule } from "@raptor/compiler";

const APP = `
component App {
  const count = state(0)
  const doubled = derived(() => count * 2)
  const price = serverSignal("BTC.price", schema.money)
  <div class="app">
    <button on:click={count++}>increment</button>
    <span class="count">count = {count}</span>
    <span class="double" data-value={doubled}>doubled = {doubled}</span>
    <span class="price">price = {price}</span>
  </div>
}
`;

const flush = (): Promise<void> =>
  new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => setTimeout(r, 0)));

test("eval: evaluator SSR pentru expresii IR", () => {
  const mod = parseModule(APP, "App.raptor");
  const doubled = mod.components[0]!.deriveds.find((d) => d.name === "doubled")!;
  assert.equal(evalExpr(doubled.expr, { count: 21 }), 42);
});

test("router: potriveste segmente dinamice [id]", () => {
  const routes = [
    { path: "/", component: "Home" },
    { path: "/products/[id]", component: "Product" },
  ];
  assert.equal(matchRoute(routes, "/")!.route.component, "Home");
  const m = matchRoute(routes, "/products/42");
  assert.equal(m!.route.component, "Product");
  assert.deepEqual(m!.params, { id: "42" });
  assert.equal(matchRoute(routes, "/nope"), null);
});

test("ssr: randeaza componenta cu valorile server-signals curente", () => {
  const mod = parseModule(APP, "App.raptor");
  const ssr = renderComponent(mod.components[0]!, { serverValue: () => 61000 });
  assert.match(ssr.html, /<div class="app">/);
  assert.match(ssr.html, /count =0/);
  assert.match(ssr.html, /doubled =0/);
  assert.match(ssr.html, /price =61000/);
  // Evenimentele nu se randeaza in SSR.
  assert.doesNotMatch(ssr.html, /on:click/);
  // Resume: clientul stie ce adresa RAS sa reia.
  assert.deepEqual(ssr.resume.serverSignals, [{ name: "price", address: "BTC.price", schema: "money" }]);
});

test("runtime: server signal -> RaptorWire -> client reactiv (acelasi graf)", async () => {
  const result = buildModule(APP, "App.raptor");
  const runtime = RaptorRuntime.fromBuild(result, { initial: { "BTC.price": 60000 } });

  const client = new RaptorClient(runtime.connect());
  await client.connect();
  client.subscribe("signals");
  await flush();

  // Snapshot initial: valoarea seed-uita din runtime.
  assert.equal(client.signal("BTC.price")(), 60000);

  // Producerul server actualizeaza -> delta -> semnalul clientului reflecta.
  runtime.produce("BTC.price", 61234);
  await flush();
  assert.equal(client.signal("BTC.price")(), 61234);

  assert.equal(runtime.metrics.activeConnections, 1);
  assert.equal(runtime.metrics.opsBroadcast, 1);

  client.close();
  await flush();
  assert.equal(runtime.metrics.activeConnections, 0);
});

test("runtime: doi clienti primesc acelasi delta (broadcast)", async () => {
  const result = buildModule(APP, "App.raptor");
  const runtime = RaptorRuntime.fromBuild(result);

  const a = new RaptorClient(runtime.connect());
  const b = new RaptorClient(runtime.connect());
  await a.connect();
  await b.connect();
  a.subscribe("signals");
  b.subscribe("signals");
  await flush();

  runtime.produce("BTC.price", 999);
  await flush();
  assert.equal(a.signal("BTC.price")(), 999);
  assert.equal(b.signal("BTC.price")(), 999);
  assert.equal(runtime.metrics.activeConnections, 2);
});

test("runtime: produce pe adresa necunoscuta arunca", () => {
  const result = buildModule(APP, "App.raptor");
  const runtime = RaptorRuntime.fromBuild(result);
  assert.throws(() => runtime.produce("x.unknown", 1), /adresa necunoscuta/);
});

test("runtime: handleRequest face routing + SSR + health", () => {
  const result = buildModule(APP, "App.raptor");
  const runtime = RaptorRuntime.fromBuild(result);

  const ok = runtime.handleRequest("GET", "/");
  assert.equal(ok.status, 200);
  assert.match(ok.headers["content-type"]!, /text\/html/);
  assert.match(ok.body, /price =0/);
  assert.match(ok.body, /application\/raptor-resume/);

  assert.equal(runtime.handleRequest("GET", "/missing").status, 404);

  const health = runtime.handleRequest("GET", "/health");
  assert.equal(health.status, 200);
  assert.match(health.body, /"ok":true/);
});

test("runtime: graceful shutdown inchide conexiunile", async () => {
  const result = buildModule(APP, "App.raptor");
  const runtime = RaptorRuntime.fromBuild(result);
  const client = new RaptorClient(runtime.connect());
  await client.connect();
  assert.equal(runtime.metrics.activeConnections, 1);
  runtime.shutdown();
  assert.equal(runtime.metrics.activeConnections, 0);
  assert.ok(runtime.log.some((e) => e.type === "shutdown"));
  assert.throws(() => runtime.connect(), /oprit/);
});

test("node target: server HTTP real serveste SSR + health", async () => {
  const result = buildModule(APP, "App.raptor");
  const runtime = RaptorRuntime.fromBuild(result);
  const server = createNodeServer(runtime);
  const port = await listen(server, 0);
  try {
    const home = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /price =0/);

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    const json = (await health.json()) as { ok: boolean };
    assert.equal(json.ok, true);

    const missing = await fetch(`http://127.0.0.1:${port}/missing`);
    assert.equal(missing.status, 404);
  } finally {
    await closeServer(server);
  }
});

test("cli: raptor-run info + ssr", () => {
  const read = (): string => APP;
  const info = runRunCli(["info", "App.raptor"], read);
  assert.equal(info.code, 0);
  assert.match(info.out, /server signals: BTC\.price/);
  assert.match(info.out, /RAS addresses: BTC\.price=0x18A1/);

  const ssr = runRunCli(["ssr", "App.raptor", "/"], read);
  assert.equal(ssr.code, 0);
  assert.match(ssr.out, /<!doctype html>/);
  assert.match(ssr.out, /price =0/);

  const miss = runRunCli(["ssr", "App.raptor", "/nope"], read);
  assert.equal(miss.code, 1);
});
