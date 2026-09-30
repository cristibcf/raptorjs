import test from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, newStats, resetStats, stats } from "raptorjs/dom/testing";
import { render } from "raptorjs/dom";
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

test("startup asks the host for a window and a menu, from the same RaptorJS app", async () => {
  const session = await started();
  try {
    assert.equal(session.host.windows.length, 1);
    assert.equal(session.host.windows[0]?.title, "Raptor Desktop Shell");
    assert.equal(session.host.windows[0]?.width, 1024, "the dimensions come from raptor.host.json");
    assert.deepEqual(session.host.menu.map((item) => item.id), ["note.new", "app.quit"]);
    assert.equal(session.shell.lifecycle(), "foreground", "the host state reached the signal");
  } finally {
    session.close();
  }
});

test("a note goes through the host's storage before it becomes app state", async () => {
  const storage = new Map<string, string>();
  const session = await started({ storage });
  try {
    await session.shell.addNote("first");
    assert.deepEqual(session.shell.notes(), ["first"]);
    assert.equal(storage.get("notes"), '["first"]');
    assert.equal(session.host.windows[0]?.title, "Raptor Desktop Shell (1)");
  } finally {
    session.close();
  }
});

test("written notes survive a restart, because they live at the host", async () => {
  const storage = new Map<string, string>();
  const first = await started({ storage });
  try {
    await first.shell.addNote("persistent");
  } finally {
    first.close();
  }

  const second = await started({ storage });
  try {
    assert.deepEqual(second.shell.notes(), ["persistent"], "the second startup reads what the first wrote");
  } finally {
    second.close();
  }
});

test("a missing optional module lets the app work, just without that feature", async () => {
  const fara = await started({ capabilities: [] });
  try {
    assert.equal(await fara.shell.announce("hello"), false, "the app learns it cannot, without crashing");
    assert.deepEqual(fara.host.notifications, []);
    await fara.shell.addNote("works anyway");
    assert.deepEqual(fara.shell.notes(), ["works anyway"]);
  } finally {
    fara.close();
  }

  const cu = await started({ capabilities: ["device.notifications"] });
  try {
    assert.equal(await cu.shell.announce("hello"), true);
    assert.equal(cu.host.notifications[0]?.body, "hello");
  } finally {
    cu.close();
  }
});

test("deep links and menu commands reach the app as events", async () => {
  const session = await started();
  try {
    session.host.deliverDeepLink("raptor-shell://nota/7");
    await tick();
    assert.equal(session.shell.lastLink(), "raptor-shell://nota/7");

    session.host.invokeMenu("note.new");
    await tick();
    await tick();
    assert.deepEqual(session.shell.notes(), ["note 1"], "the menu command wrote through the bridge");
  } finally {
    session.close();
  }
});

test("rendering stays fine-grained: host events move text, they do not recreate nodes", async () => {
  const session = await started();
  try {
    const root = doc.createElement("div");
    render(() => session.shell.view(doc as never) as never, root);
    const before = { ...stats };
    assert.ok(before.createElement > 0, "the first render really does build something");

    resetStats();
    await session.shell.addNote("one");
    session.host.deliverDeepLink("raptor-shell://nota/1");
    session.host.lifecycle.to("background");
    await tick();

    assert.equal(stats.createElement, 0, "no new elements after three state changes");
    assert.ok(stats.textUpdate > 0, "but the bound text did update");
    assert.match(root.toHTML(), /status: background - 1 notes/);
    assert.match(root.toHTML(), /raptor-shell:\/\/nota\/1/);
  } finally {
    resetStats();
    Object.assign(stats, newStats());
    session.close();
  }
});

test("the app cannot touch what it was not granted", async () => {
  const session = await started({ capabilities: ["device.notifications"] });
  try {
    await assert.rejects(
      session.bridge.call("camera.capture"),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-undeclared",
    );
    await assert.rejects(
      session.bridge.call("window.navigate", { id: "w1", url: "https://atacator.example" }),
      /navigation denied/,
    );
  } finally {
    session.close();
  }
});
