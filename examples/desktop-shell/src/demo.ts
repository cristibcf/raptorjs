/**
 * Demo: o aplicatie RaptorJS pornita de un host desktop.
 *
 *   node examples/desktop-shell/src/demo.ts
 *
 * Arata, in ordine: pornirea ferestrei si a meniului, o scriere in stocarea
 * locala, un deep link venit din sistem, o comanda de meniu, un refuz de
 * capabilitate si oprirea curata - cu randarea fine-grained la fiecare pas.
 */
import { installMiniDom, resetStats, stats } from "@raptor/dom/testing";
import { render } from "@raptor/dom";
import { createSession } from "./session.ts";

const doc = installMiniDom();
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

const storage = new Map<string, string>();
const session = createSession({ capabilities: ["device.notifications"], storage });

const root = doc.createElement("div");
render(() => session.shell.view(doc as never) as never, root);

console.log("=== RaptorJS pe un host desktop ===\n");

await session.shell.start();
session.host.lifecycle.to("ready");
session.host.lifecycle.to("foreground");
await tick();

console.log("Dupa pornire:", root.toHTML());
console.log("  fereastra :", session.host.windows[0]?.title, `${session.host.windows[0]?.width}x${session.host.windows[0]?.height}`);
console.log("  meniu     :", session.host.menu.map((item) => item.label).join(", "));

resetStats();

await session.shell.addNote("cumpara lapte");
await session.shell.announce("nota salvata");
await tick();

console.log("\nDupa o nota:", root.toHTML());
console.log("  titlul ferestrei :", session.host.windows[0]?.title);
console.log("  stocare locala   :", storage.get("notes"));
console.log("  notificari       :", session.host.notifications.map((entry) => entry.body).join(", "));

session.host.deliverDeepLink("raptor-shell://nota/42");
session.host.invokeMenu("note.new");
await tick();
await tick();

console.log("\nDupa deep link si comanda de meniu:", root.toHTML());

try {
  await session.bridge.call("camera.capture");
} catch (error) {
  console.log("\nRefuz asteptat:", (error as { code: string }).code);
}

session.host.lifecycle.to("background");
await tick();
console.log("Dupa trecerea in fundal:", root.toHTML());

console.log("\nMutatii DOM de la prima nota incoace:");
console.log(`  elemente noi create : ${stats.createElement}   (asteptat: 0)`);
console.log(`  actualizari de text : ${stats.textUpdate}`);
console.log("\n-> Aplicatia nu a importat nimic de platforma: totul a trecut prin punte.");

session.close();
