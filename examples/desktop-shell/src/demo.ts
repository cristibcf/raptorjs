/**
 * Demo: a RaptorJS application launched by a desktop host.
 *
 *   node examples/desktop-shell/src/demo.ts
 *
 * Shows, in order: opening the window and the menu, a write to local storage,
 * a deep link coming from the system, a menu command, a capability denial and
 * a clean shutdown - with fine-grained rendering at every step.
 */
import { installMiniDom, resetStats, stats } from "raptorjs/dom/testing";
import { render } from "raptorjs/dom";
import { createSession } from "./session.ts";

const doc = installMiniDom();
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

const storage = new Map<string, string>();
const session = createSession({ capabilities: ["device.notifications"], storage });

const root = doc.createElement("div");
render(() => session.shell.view(doc as never) as never, root);

console.log("=== RaptorJS on a desktop host ===\n");

await session.shell.start();
session.host.lifecycle.to("ready");
session.host.lifecycle.to("foreground");
await tick();

console.log("After startup:", root.toHTML());
console.log("  window :", session.host.windows[0]?.title, `${session.host.windows[0]?.width}x${session.host.windows[0]?.height}`);
console.log("  menu   :", session.host.menu.map((item) => item.label).join(", "));

resetStats();

await session.shell.addNote("buy milk");
await session.shell.announce("note saved");
await tick();

console.log("\nAfter one note:", root.toHTML());
console.log("  window title  :", session.host.windows[0]?.title);
console.log("  local storage :", storage.get("notes"));
console.log("  notifications :", session.host.notifications.map((entry) => entry.body).join(", "));

session.host.deliverDeepLink("raptor-shell://nota/42");
session.host.invokeMenu("note.new");
await tick();
await tick();

console.log("\nAfter deep link and menu command:", root.toHTML());

try {
  await session.bridge.call("camera.capture");
} catch (error) {
  console.log("\nExpected denial:", (error as { code: string }).code);
}

session.host.lifecycle.to("background");
await tick();
console.log("After moving to background:", root.toHTML());

console.log("\nDOM mutations since the first note:");
console.log(`  new elements created : ${stats.createElement}   (expected: 0)`);
console.log(`  text updates         : ${stats.textUpdate}`);
console.log("\n-> The app imported nothing platform-specific: everything went through the bridge.");

session.close();
