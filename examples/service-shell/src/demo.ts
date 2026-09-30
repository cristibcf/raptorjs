/**
 * Demo: the same application as an HTTP service, on a service host.
 *
 *   node examples/service-shell/src/demo.ts
 *
 * The server is real (`node:http`), and the requests below are real `fetch`es.
 * Run after `demo:desktop`, `demo:mobile` and `demo:web-host`, it shows the
 * fourth column: no windows, no user, but with sockets, configuration, a health
 * signal and draining on shutdown.
 */
import { createSession } from "./session.ts";

const session = createSession({
  ports: { public: 0 },
  config: { GREETING: "Hello from the supervisor" },
});

console.log("=== RaptorJS as a service, on a service host ===\n");

await session.service.start();
const base = session.service.url()!;

console.log("After startup:", session.service.summary());
console.log("  listener :", base, "(the host chose the port, not the app)");
console.log("  health   :", session.host.health);

const health = await (await fetch(`${base}/health`)).json();
console.log("\nGET /health ->", JSON.stringify(health));

const created = await fetch(`${base}/note`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ text: "write the report" }),
});
console.log(`POST /note -> ${created.status}`, JSON.stringify(await created.json()));

const listed = await (await fetch(`${base}/note`)).json();
console.log("GET /note   ->", JSON.stringify(listed));

const rejected = await fetch(`${base}/note`, { method: "POST", body: JSON.stringify({}) });
console.log(`POST /note (no text) -> ${rejected.status}`, JSON.stringify(await rejected.json()));

const missing = await fetch(`${base}/inexistent`);
console.log(`GET /inexistent -> ${missing.status}`);

console.log("\nWhat a service canNOT do:");
for (const method of ["window.open", "notify.show", "camera.capture"]) {
  console.log(`  ${method}: ${session.bridge.allows(method) ? "allowed" : "unavailable"}`);
}

// The supervisor's signal: we do not kill the process, we drain it.
console.log("\nSIGTERM from the supervisor...");
const drained = session.host.requestDrain("SIGTERM");
await drained;

console.log("  health   :", session.host.health);
console.log("  lifecycle:", session.host.lifecycle.history.join(" -> "));

try {
  await fetch(`${base}/health`);
  console.log("  UNEXPECTED: the port still responds");
} catch {
  console.log("  the port is closed: new requests no longer come in");
}

console.log("\nUpdates:", JSON.stringify(await session.bridge.call("update.check")));
console.log("\n-> The same contract as on desktop, mobile and web. The host gives something else:");
console.log("   sockets and configuration instead of windows, draining instead of suspending.");

await session.close();
