import test from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, newStats, resetStats, stats } from "@raptorstack/raptorjs/dom/testing";
import { render } from "@raptorstack/raptorjs/dom";
import { createSession } from "../src/session.ts";
import type { Session } from "../src/session.ts";

const doc = installMiniDom();
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

async function started(options: Parameters<typeof createSession>[0] = {}): Promise<Session> {
  const session = createSession(options);
  await session.shell.start();
  session.host.lifecycle.to("ready");
  session.host.lifecycle.to("foreground");
  await tick();
  return session;
}

test("at startup the app finds out which screen the adapter opened it on", async () => {
  const session = await started({ initialRoute: "/note/7" });
  try {
    assert.equal(session.shell.route(), "/note/7", "the initial route is not assumed, it is requested");
    assert.equal(session.shell.lifecycle(), "foreground");
  } finally {
    session.close();
  }
});

test("navigation comes from the adapter, including the system back", async () => {
  const session = await started({ initialRoute: "/note" });
  try {
    session.host.navigate("/note/1");
    await tick();
    assert.equal(session.shell.route(), "/note/1");

    session.host.navigate("/note/1/poza");
    await tick();
    assert.equal(session.shell.route(), "/note/1/poza");

    assert.equal(session.host.back(), true);
    await tick();
    assert.equal(session.shell.route(), "/note/1", "the back gesture moved the screen, without going through JS");

    assert.equal(session.host.back(), true);
    await tick();
    assert.equal(session.host.back(), false, "you cannot leave the root screen anymore");
    assert.deepEqual(session.host.stack, ["/note"]);
  } finally {
    session.close();
  }
});

test("the app is not allowed to drive navigation itself", async () => {
  const session = await started();
  try {
    // Section 6: windows and menus do not exist on mobile, and the route belongs
    // to the adapter. Reading the route is allowed; changing it has no method at all.
    assert.equal(session.bridge.allows("window.open"), false);
    assert.equal(session.bridge.allows("window.navigate"), false);
    assert.equal(session.bridge.allows("menu.set"), false);
    assert.equal(session.bridge.allows("navigation.current"), true);

    await assert.rejects(
      session.bridge.call("window.navigate", { id: "w1", url: "/altundeva" }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-unavailable",
    );
    await assert.rejects(
      session.bridge.call("navigation.push", { route: "/altundeva" }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/method-unknown",
    );
  } finally {
    session.close();
  }
});

test("notes live in the platform's secure store and survive a restart", async () => {
  const secureStore = new Map<string, string>();
  const first = await started({ secureStore });
  try {
    await first.shell.addNote("first");
    assert.equal(secureStore.get("notes"), '[{"text":"first","photo":null}]');
  } finally {
    first.close();
  }

  const second = await started({ secureStore });
  try {
    assert.deepEqual(second.shell.notes(), [{ text: "first", photo: null }]);
  } finally {
    second.close();
  }
});

test("the camera is an optional module: without it the app works, just without photos", async () => {
  const fara = await started({ capabilities: ["device.notifications"] });
  try {
    await fara.shell.addNote("no photo");
    assert.equal(await fara.shell.attachPhoto(), false, "the app learns it cannot, without crashing");
    assert.equal(fara.shell.notes()[0]?.photo, null);
  } finally {
    fara.close();
  }

  const cu = await started({ capabilities: ["device.notifications", "device.camera"] });
  try {
    await cu.shell.addNote("with photo");
    assert.equal(await cu.shell.attachPhoto(), true);
    assert.match(String(cu.shell.notes()[0]?.photo), /^photo-\d+$/);
  } finally {
    cu.close();
  }
});

test("the phone lifecycle: background, suspend and resume, without stopping", async () => {
  const session = await started();
  try {
    const stari: string[] = [];
    session.bridge.on("lifecycle.changed", (payload) => stari.push(String(payload["state"])));

    session.host.lifecycle.to("background");
    session.host.lifecycle.to("suspended");
    await tick();
    assert.equal(session.shell.lifecycle(), "suspended");

    session.host.lifecycle.to("foreground");
    await tick();
    assert.deepEqual(stari, ["background", "suspended", "foreground"]);
    assert.notEqual(session.host.lifecycle.state, "stopped", "suspending does not close the app");
  } finally {
    session.close();
  }
});

test("a stop request sends the app to the background, it does not close it", async () => {
  const session = await started();
  try {
    const raspuns = (await session.bridge.call("lifecycle.requestStop")) as { state: string };
    assert.equal(raspuns.state, "background", "the system decides to suspend, not the app");
  } finally {
    session.close();
  }
});

test("declared deep links reach the app, the rest do not", async () => {
  const session = await started();
  try {
    session.host.deliverDeepLink("raptor-shell://nota/3");
    await tick();
    assert.equal(session.shell.lastLink(), "raptor-shell://nota/3");
    assert.throws(() => session.host.deliverDeepLink("altceva://nota/3"), /is not declared/);
  } finally {
    session.close();
  }
});

test("updates belong to the store, not to the app", async () => {
  const session = await started();
  try {
    assert.deepEqual(await session.bridge.call("update.check"), {
      available: false,
      version: "0.1.0",
      managedBy: "store",
    });
  } finally {
    session.close();
  }
});

test("rendering stays fine-grained when the adapter changes the screen and the state", async () => {
  const session = await started({ initialRoute: "/note" });
  try {
    const root = doc.createElement("div");
    render(() => session.shell.view(doc as never) as never, root);
    assert.ok(stats.createElement > 0, "the first render really does build something");

    resetStats();
    await session.shell.addNote("one");
    session.host.navigate("/note/1");
    session.host.lifecycle.to("background");
    session.host.deliverDeepLink("raptor-shell://nota/1");
    await tick();

    assert.equal(stats.createElement, 0, "no new elements after four changes");
    assert.ok(stats.textUpdate > 0);
    assert.match(root.toHTML(), /screen: \/note\/1/);
    assert.match(root.toHTML(), /status: background - 1 notes/);
  } finally {
    resetStats();
    Object.assign(stats, newStats());
    session.close();
  }
});
