/**
 * Demo: o aplicatie RaptorJS pornita de un host mobil.
 *
 *   node examples/mobile-shell/src/demo.ts
 *
 * Perechea lui de desktop este `examples/desktop-shell/src/demo.ts`. Rulate unul
 * dupa altul, se vede ce ramane la fel (aceeasi punte, aceleasi semnale, aceeasi
 * randare fine-grained) si ce se schimba: navigarea vine de la adaptor, exista
 * suspendare si reluare, iar ferestrele si subprocesele nu exista deloc.
 */
import { installMiniDom, resetStats, stats } from "@raptor/dom/testing";
import { render } from "@raptor/dom";
import { createSession } from "./session.ts";

const doc = installMiniDom();
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

const secureStore = new Map<string, string>();
const session = createSession({
  capabilities: ["device.notifications", "device.camera"],
  secureStore,
  initialRoute: "/note",
});

const root = doc.createElement("div");
render(() => session.shell.view(doc as never) as never, root);

console.log("=== RaptorJS pe un host mobil ===\n");

await session.shell.start();
session.host.lifecycle.to("ready");
session.host.lifecycle.to("foreground");
await tick();

console.log("Dupa pornire:", root.toHTML());

resetStats();

await session.shell.addNote("de verificat gardul");
await session.shell.attachPhoto();
await session.shell.announce("nota salvata");
await tick();

console.log("\nDupa o nota cu poza:", root.toHTML());
console.log("  stocare securizata :", secureStore.get("notes"));
console.log("  notificari         :", session.host.notifications.map((entry) => entry.body).join(", "));

// Navigarea nu este ceruta de aplicatie: adaptorul o conduce, aplicatia afla.
session.host.navigate("/note/1");
await tick();
console.log("\nAdaptorul a navigat:", root.toHTML());

session.host.back();
await tick();
console.log("Back-ul sistemului:", root.toHTML());
console.log("  stiva ramasa:", session.host.stack.join(" -> "));

session.host.deliverDeepLink("raptor-shell://nota/1");
await tick();
console.log("\nDupa un deep link:", root.toHTML());

// Ciclul propriu telefonului: fundal, suspendare, reluare - fara sa se inchida.
session.host.lifecycle.to("background");
session.host.lifecycle.to("suspended");
await tick();
console.log("\nSuspendata de sistem:", root.toHTML());

session.host.lifecycle.to("foreground");
await tick();
console.log("Reluata:", root.toHTML());

for (const method of ["window.open", "menu.set", "process.spawn"]) {
  try {
    await session.bridge.call(method, { command: "sh" });
    console.log(`\nNEASTEPTAT: '${method}' a trecut`);
  } catch (error) {
    console.log(`\nRefuz asteptat pentru '${method}':`, (error as { code: string }).code);
  }
}

console.log("\nActualizari:", JSON.stringify(await session.bridge.call("update.check")));

console.log("\nMutatii DOM de la prima nota incoace:");
console.log(`  elemente noi create : ${stats.createElement}   (asteptat: 0)`);
console.log(`  actualizari de text : ${stats.textUpdate}`);
console.log("\n-> Aceeasi aplicatie, alt host: navigarea a venit din afara, nu din JavaScript.");

session.close();
