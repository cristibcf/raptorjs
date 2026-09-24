/**
 * Demo: aceeasi aplicatie pe o placheta.
 *
 *   node examples/device-shell/src/demo.ts
 *
 * Placheta este simulata, dar contractul este acelasi pe care l-ar implementa
 * firmware-ul real. Se vad, in ordine: harta de hardware, o bucla cu somn intre
 * citiri, scrierile in NVS care chiar conteaza, refuzurile pe periferice
 * nedeclarate si - la final - watchdog-ul, care reseteaza o aplicatie blocata.
 */
import { createSession, simulatedBoard } from "./session.ts";

const storage = new Map<string, string>();
const board = simulatedBoard({ start: 21, step: 0.2 });
const session = createSession({ board, storage, watchdogMs: 2000 });

console.log("=== RaptorJS pe o placheta ===\n");

await session.logger.start();
const info = await session.bridge.call<Record<string, unknown>>("device.info");
console.log("Placheta:", `${String(info["chip"])} fw ${String(info["firmware"])}`);
console.log("  pornire   :", String(info["resetReason"]));
console.log("  heap liber:", String(info["freeHeap"]), "octeti");
console.log("  watchdog  :", String(info["watchdogMs"]), "ms");
console.log("  LED aprins:", board.writes.at(-1)?.value);

await session.logger.run(6, 500);
console.log("\nDupa 6 citiri cu somn intre ele:", session.logger.summary());
console.log("  valori    :", session.logger.readings().map((r) => r.value.toFixed(1)).join(", "));
console.log("  somnuri   :", board.sleeps.join("ms, ") + "ms");
const afterRun = await session.bridge.call<{ nvsWrites: number }>("device.info");
console.log("  scrieri NVS:", afterRun.nvsWrites, "din 6 citiri (flash-ul se uzeaza, deci se scrie doar la deriva reala)");

console.log("\nCe refuza host-ul:");
const refusals: Array<[string, Record<string, unknown>]> = [
  ["pin nedeclarat", { pin: 13, value: true }],
  ["pin de intrare scris ca iesire", { pin: 5, value: true }],
];
for (const [label, params] of refusals) {
  try {
    await session.bridge.call("hw.gpio.write", params);
    console.log(`  ${label}: NEASTEPTAT, a trecut`);
  } catch (error) {
    console.log(`  ${label}: ${(error as { message: string }).message}`);
  }
}
try {
  await session.bridge.call("hw.bus.transfer", { bus: "i2c0", address: 0x50, write: [], readLength: 1 });
} catch (error) {
  console.log(`  adresa nedeclarata: ${(error as { message: string }).message}`);
}
for (const method of ["window.open", "process.spawn", "cli.prompt"]) {
  console.log(`  ${method}: ${session.bridge.allows(method) ? "permisa" : "indisponibila pe embedded"}`);
}

// Watchdog-ul: singurul loc din tot contractul unde host-ul nu are incredere.
console.log("\nAplicatia se blocheaza (nu mai da semne de viata)...");
session.host.tick(1600);
console.log("  dupa 1600ms:", session.host.watchdogRemainingMs, "ms ramase");
session.host.tick(500);
console.log("  dupa inca 500ms:", session.host.watchdogRemainingMs === null ? "resetata" : "inca traieste");
console.log("  resetari:", session.host.resets.join(", "));
console.log("  lifecycle:", session.host.lifecycle.history.join(" -> "));

console.log("\n-> Acelasi contract ca pe desktop, mobil, web, server si CLI.");
console.log("   Diferenta: aici host-ul nu are incredere in aplicatie.");

session.close();
