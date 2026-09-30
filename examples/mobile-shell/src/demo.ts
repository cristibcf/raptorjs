/**
 * Demo: a RaptorJS application launched by a mobile host.
 *
 *   node examples/mobile-shell/src/demo.ts
 *
 * Its desktop counterpart is `examples/desktop-shell/src/demo.ts`. Run one after
 * the other, you can see what stays the same (same bridge, same signals, same
 * fine-grained rendering) and what changes: navigation comes from the adapter,
 * there is suspend and resume, and windows and subprocesses do not exist at all.
 */
import { installMiniDom, resetStats, stats } from "@raptorstack/raptorjs/dom/testing";
import { render } from "@raptorstack/raptorjs/dom";
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

console.log("=== RaptorJS on a mobile host ===\n");

await session.shell.start();
session.host.lifecycle.to("ready");
session.host.lifecycle.to("foreground");
await tick();

console.log("After startup:", root.toHTML());

resetStats();

await session.shell.addNote("check the fence");
await session.shell.attachPhoto();
await session.shell.announce("note saved");
await tick();

console.log("\nAfter a note with a photo:", root.toHTML());
console.log("  secure storage :", secureStore.get("notes"));
console.log("  notifications  :", session.host.notifications.map((entry) => entry.body).join(", "));

// Navigation is not requested by the app: the adapter drives it, the app finds out.
session.host.navigate("/note/1");
await tick();
console.log("\nThe adapter navigated:", root.toHTML());

session.host.back();
await tick();
console.log("The system back:", root.toHTML());
console.log("  remaining stack:", session.host.stack.join(" -> "));

session.host.deliverDeepLink("raptor-shell://nota/1");
await tick();
console.log("\nAfter a deep link:", root.toHTML());

// The phone's own cycle: background, suspend, resume - without closing.
session.host.lifecycle.to("background");
session.host.lifecycle.to("suspended");
await tick();
console.log("\nSuspended by the system:", root.toHTML());

session.host.lifecycle.to("foreground");
await tick();
console.log("Resumed:", root.toHTML());

for (const method of ["window.open", "menu.set", "process.spawn"]) {
  try {
    await session.bridge.call(method, { command: "sh" });
    console.log(`\nUNEXPECTED: '${method}' went through`);
  } catch (error) {
    console.log(`\nExpected denial for '${method}':`, (error as { code: string }).code);
  }
}

console.log("\nUpdates:", JSON.stringify(await session.bridge.call("update.check")));

console.log("\nDOM mutations since the first note:");
console.log(`  new elements created : ${stats.createElement}   (expected: 0)`);
console.log(`  text updates         : ${stats.textUpdate}`);
console.log("\n-> Same app, different host: navigation came from the outside, not from JavaScript.");

session.close();
