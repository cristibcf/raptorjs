/**
 * Demo: the same application on a board.
 *
 *   node examples/device-shell/src/demo.ts
 *
 * The board is simulated, but the contract is the same one the real firmware
 * would implement. You can see, in order: the hardware map, a loop with sleep
 * between readings, the NVS writes that actually matter, the denials on
 * undeclared peripherals and - at the end - the watchdog, which resets a hung app.
 */
import { createSession, simulatedBoard } from "./session.ts";

const storage = new Map<string, string>();
const board = simulatedBoard({ start: 21, step: 0.2 });
const session = createSession({ board, storage, watchdogMs: 2000 });

console.log("=== RaptorJS on a board ===\n");

await session.logger.start();
const info = await session.bridge.call<Record<string, unknown>>("device.info");
console.log("Board:", `${String(info["chip"])} fw ${String(info["firmware"])}`);
console.log("  boot      :", String(info["resetReason"]));
console.log("  free heap :", String(info["freeHeap"]), "bytes");
console.log("  watchdog  :", String(info["watchdogMs"]), "ms");
console.log("  LED on    :", board.writes.at(-1)?.value);

await session.logger.run(6, 500);
console.log("\nAfter 6 readings with sleep between them:", session.logger.summary());
console.log("  values    :", session.logger.readings().map((r) => r.value.toFixed(1)).join(", "));
console.log("  sleeps    :", board.sleeps.join("ms, ") + "ms");
const afterRun = await session.bridge.call<{ nvsWrites: number }>("device.info");
console.log("  NVS writes:", afterRun.nvsWrites, "out of 6 readings (the flash wears out, so it writes only on real drift)");

console.log("\nWhat the host denies:");
const refusals: Array<[string, Record<string, unknown>]> = [
  ["undeclared pin", { pin: 13, value: true }],
  ["input pin written as output", { pin: 5, value: true }],
];
for (const [label, params] of refusals) {
  try {
    await session.bridge.call("hw.gpio.write", params);
    console.log(`  ${label}: UNEXPECTED, it went through`);
  } catch (error) {
    console.log(`  ${label}: ${(error as { message: string }).message}`);
  }
}
try {
  await session.bridge.call("hw.bus.transfer", { bus: "i2c0", address: 0x50, write: [], readLength: 1 });
} catch (error) {
  console.log(`  undeclared address: ${(error as { message: string }).message}`);
}
for (const method of ["window.open", "process.spawn", "cli.prompt"]) {
  console.log(`  ${method}: ${session.bridge.allows(method) ? "allowed" : "unavailable on embedded"}`);
}

// The watchdog: the only place in the whole contract where the host does not trust.
console.log("\nThe app hangs (no more signs of life)...");
session.host.tick(1600);
console.log("  after 1600ms:", session.host.watchdogRemainingMs, "ms remaining");
session.host.tick(500);
console.log("  after another 500ms:", session.host.watchdogRemainingMs === null ? "reset" : "still alive");
console.log("  resets:", session.host.resets.join(", "));
console.log("  lifecycle:", session.host.lifecycle.history.join(" -> "));

console.log("\n-> The same contract as on desktop, mobile, web, server and CLI.");
console.log("   The difference: here the host does not trust the app.");

session.close();
