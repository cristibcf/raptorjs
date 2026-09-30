/**
 * RaptorRun demo (whitepaper RaptorEngine 19). Run with:
 *   node examples/raptorengine-app/src/run-demo.ts
 *
 * Shows the full loop from a single semantic graph: build -> server runtime ->
 * server signal over RaptorWire -> reactive client, plus SSR/resume and metrics.
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

console.log("=== SSR /  (server-rendered from the same graph) ===\n");
const ssr = runtime.ssr("/");
console.log(ssr ? renderDocument(ssr, ssr.resume.component) : "(no route)");

console.log("\n=== Server signal -> RaptorWire -> reactive client ===\n");
const client = new RaptorClient(runtime.connect());
await client.connect();
client.subscribe("signals");
await flush();
console.log(`client sees BTC.price = ${client.signal("BTC.price")()}  (initial snapshot)`);

for (const price of [60250, 61000, 60875]) {
  runtime.produce("BTC.price", price);
  await flush();
  console.log(`server produces ${price}  ->  reactive client = ${client.signal("BTC.price")()}`);
}

console.log("\n=== Observability ===\n");
console.log("metrics:", runtime.metrics);
console.log("event log:", runtime.log.map((e) => `${e.type}(${e.detail})`).join(" | "));

client.close();
await flush();
runtime.shutdown();
console.log("\nshutdown: active =", runtime.metrics.activeConnections);
