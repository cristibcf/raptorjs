/**
 * Demo RaptorRun (whitepaper RaptorEngine 19). Ruleaza cu:
 *   node examples/raptorengine-app/src/run-demo.ts
 *
 * Arata bucla completa dintr-un singur graf semantic: build -> runtime server ->
 * server signal peste RaptorWire -> client reactiv, plus SSR/resume si metrici.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildModule } from "@raptor/engine";
import { RaptorRuntime, renderDocument } from "@raptor/engine/run";
import { RaptorClient } from "@raptor/wire/client";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "App.raptor"), "utf8");

const result = buildModule(source, "App.raptor");
const runtime = RaptorRuntime.fromBuild(result, { initial: { "BTC.price": 60000 } });

const flush = (): Promise<void> =>
  new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => setTimeout(r, 0)));

console.log("=== SSR /  (server-rendered din acelasi graf) ===\n");
const ssr = runtime.ssr("/");
console.log(ssr ? renderDocument(ssr, ssr.resume.component) : "(niciun route)");

console.log("\n=== Server signal -> RaptorWire -> client reactiv ===\n");
const client = new RaptorClient(runtime.connect());
await client.connect();
client.subscribe("signals");
await flush();
console.log(`client vede BTC.price = ${client.signal("BTC.price")()}  (snapshot initial)`);

for (const price of [60250, 61000, 60875]) {
  runtime.produce("BTC.price", price);
  await flush();
  console.log(`server produce ${price}  ->  client reactiv = ${client.signal("BTC.price")()}`);
}

console.log("\n=== Observability ===\n");
console.log("metrici:", runtime.metrics);
console.log("event log:", runtime.log.map((e) => `${e.type}(${e.detail})`).join(" | "));

client.close();
await flush();
runtime.shutdown();
console.log("\nshutdown: active =", runtime.metrics.activeConnections);
