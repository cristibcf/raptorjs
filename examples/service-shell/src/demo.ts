/**
 * Demo: aceeasi aplicatie ca serviciu HTTP, pe un host de serviciu.
 *
 *   node examples/service-shell/src/demo.ts
 *
 * Serverul este real (`node:http`), iar cererile de mai jos sunt `fetch`-uri
 * adevarate. Rulat dupa `demo:desktop`, `demo:mobile` si `demo:web-host`, arata
 * a patra coloana: fara ferestre, fara utilizator, dar cu socketi, configuratie,
 * semnal de sanatate si drenare la oprire.
 */
import { createSession } from "./session.ts";

const session = createSession({
  ports: { public: 0 },
  config: { GREETING: "Salut de la supervizor" },
});

console.log("=== RaptorJS ca serviciu, pe un host de serviciu ===\n");

await session.service.start();
const base = session.service.url()!;

console.log("Dupa pornire:", session.service.summary());
console.log("  listener :", base, "(portul l-a ales host-ul, nu aplicatia)");
console.log("  sanatate :", session.host.health);

const health = await (await fetch(`${base}/health`)).json();
console.log("\nGET /health ->", JSON.stringify(health));

const created = await fetch(`${base}/note`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ text: "de scris raportul" }),
});
console.log(`POST /note -> ${created.status}`, JSON.stringify(await created.json()));

const listed = await (await fetch(`${base}/note`)).json();
console.log("GET /note   ->", JSON.stringify(listed));

const rejected = await fetch(`${base}/note`, { method: "POST", body: JSON.stringify({}) });
console.log(`POST /note (fara text) -> ${rejected.status}`, JSON.stringify(await rejected.json()));

const missing = await fetch(`${base}/inexistent`);
console.log(`GET /inexistent -> ${missing.status}`);

console.log("\nCe NU poate un serviciu:");
for (const method of ["window.open", "notify.show", "camera.capture"]) {
  console.log(`  ${method}: ${session.bridge.allows(method) ? "permisa" : "indisponibila"}`);
}

// Semnalul supervizorului: nu taiem procesul, il drenam.
console.log("\nSIGTERM de la supervizor...");
const drained = session.host.requestDrain("SIGTERM");
await drained;

console.log("  sanatate :", session.host.health);
console.log("  lifecycle:", session.host.lifecycle.history.join(" -> "));

try {
  await fetch(`${base}/health`);
  console.log("  NEASTEPTAT: portul inca raspunde");
} catch {
  console.log("  portul este inchis: cererile noi nu mai intra");
}

console.log("\nActualizari:", JSON.stringify(await session.bridge.call("update.check")));
console.log("\n-> Acelasi contract ca pe desktop, mobil si web. Host-ul da altceva:");
console.log("   socketi si configuratie in loc de ferestre, drenare in loc de suspendare.");

await session.close();
