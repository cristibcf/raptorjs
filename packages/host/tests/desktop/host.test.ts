import test from "node:test";
import assert from "node:assert/strict";
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createDesktopHost } from "../../src/desktop/index.ts";
import type { DesktopHost, DesktopHostOptions } from "../../src/desktop/index.ts";

const BASE = {
  target: "desktop",
  bundleId: "com.example.desktop",
  displayName: "Example Desktop",
  version: "1.0.0",
  entry: "./index.html",
  capabilities: [] as string[],
  allowedOrigins: ["https://api.example.com"],
  deepLinkSchemes: ["example"],
  window: { title: "Example", width: 1200, height: 800, resizable: true },
  update: { feed: "https://updates.example.com/stable.json", channel: "stable" },
};

function manifestWith(patch: Record<string, unknown> = {}): HostManifest {
  return requireHostManifest(JSON.stringify({ ...BASE, ...patch }));
}

interface Link {
  readonly app: HostBridge;
  readonly host: DesktopHost;
  dispose(): void;
}

function connect(manifest: HostManifest, options: Partial<DesktopHostOptions> = {}): Link {
  const channel = createMemoryChannel();
  const host = createDesktopHost({ ...options, manifest, transport: channel.host });
  const app = createBridge({
    target: "desktop",
    capabilities: manifest.capabilities,
    transport: channel.app,
    timeoutMs: 2000,
  });
  return {
    app,
    host,
    dispose: () => {
      app.dispose("test");
      host.close();
    },
  };
}

test("the adapter rejects a manifest that is not for desktop", () => {
  const mobile = requireHostManifest(
    JSON.stringify({ ...BASE, target: "mobile", window: undefined, deepLinkSchemes: ["example"] }),
  );
  assert.throws(
    () => createDesktopHost({ manifest: mobile, transport: createMemoryChannel().host }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
});

test("windows open with the dimensions from the manifest and close", async () => {
  const link = connect(manifestWith());
  try {
    const opened = (await link.app.call("window.open", { title: "Main" })) as { id: string };
    assert.equal(link.host.windows.length, 1);
    assert.equal(link.host.windows[0]?.width, 1200);
    assert.equal(link.host.windows[0]?.url, "./index.html", "without an explicit url the app entry is loaded");

    await link.app.call("window.setTitle", { id: opened.id, title: "Renamed" });
    assert.equal(link.host.windows[0]?.title, "Renamed");

    await link.app.call("window.close", { id: opened.id });
    assert.equal(link.host.windows.length, 0);
  } finally {
    link.dispose();
  }
});

test("navigation outside the declared origins is denied", async () => {
  const link = connect(manifestWith());
  try {
    const opened = (await link.app.call("window.open", {})) as { id: string };
    await link.app.call("window.navigate", { id: opened.id, url: "https://api.example.com/panel" });
    assert.equal(link.host.windows[0]?.url, "https://api.example.com/panel");

    await assert.rejects(
      link.app.call("window.navigate", { id: opened.id, url: "https://attacker.example/page" }),
      /navigation denied/,
    );
    assert.equal(link.host.windows[0]?.url, "https://api.example.com/panel", "the state does not change on a denial");

    // Relative paths stay allowed: they are inside the app's packaged unit.
    await link.app.call("window.navigate", { id: opened.id, url: "/settings" });
    assert.equal(link.host.windows[0]?.url, "/settings");
  } finally {
    link.dispose();
  }
});

test("a nonexistent window cannot be manipulated", async () => {
  const link = connect(manifestWith());
  try {
    await assert.rejects(link.app.call("window.setTitle", { id: "w99", title: "x" }), /does not exist/);
    await assert.rejects(link.app.call("window.close", { id: "w99" }), /does not exist/);
  } finally {
    link.dispose();
  }
});

test("local storage is a flat space, tied to the app", async () => {
  const magazin = new Map<string, string>();
  const link = connect(manifestWith(), { storage: magazin });
  try {
    await link.app.call("storage.set", { key: "session", value: "abc" });
    assert.equal(await link.app.call("storage.get", { key: "session" }), "abc");
    assert.equal(await link.app.call("storage.get", { key: "missing" }), null);
    assert.deepEqual(await link.app.call("storage.keys"), ["session"]);
    assert.equal(magazin.get("session"), "abc", "the injected store is the one written to");

    for (const key of ["../escape", "sub/path", ".hidden", "a\\b"]) {
      await assert.rejects(link.app.call("storage.get", { key }), /invalid storage key/);
    }

    assert.deepEqual(await link.app.call("storage.delete", { key: "session" }), { deleted: true });
    assert.deepEqual(await link.app.call("storage.delete", { key: "session" }), { deleted: false });
  } finally {
    link.dispose();
  }
});

test("notifications require their own capability", async () => {
  const fara = connect(manifestWith());
  try {
    await assert.rejects(
      fara.app.call("notify.show", { title: "Hello" }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-undeclared",
    );
  } finally {
    fara.dispose();
  }

  const cu = connect(manifestWith({ capabilities: ["device.notifications"] }), { now: () => 1000 });
  try {
    await cu.app.call("notify.show", { title: "Hello", body: "done" });
    assert.deepEqual(cu.host.notifications, [{ title: "Hello", body: "done", atMs: 1000 }]);
  } finally {
    cu.dispose();
  }
});

test("subprocesses require both the capability and a command from the explicit list", async () => {
  const manifest = manifestWith({ capabilities: ["process.spawn"] });
  const link = connect(manifest, {
    allowedCommands: ["git"],
    runCommand: async (command, args) => ({ code: 0, stdout: `${command} ${args.join(" ")}`, stderr: "" }),
  });
  try {
    assert.deepEqual(await link.app.call("process.spawn", { command: "git", args: ["status"] }), {
      code: 0,
      stdout: "git status",
      stderr: "",
    });

    await assert.rejects(link.app.call("process.spawn", { command: "curl" }), (error: unknown) => {
      const hostError = error as { detail: Record<string, unknown> };
      assert.deepEqual(hostError.detail["allowed"], ["git"]);
      return true;
    });
  } finally {
    link.dispose();
  }

  const fara = connect(manifestWith(), { allowedCommands: ["git"] });
  try {
    await assert.rejects(
      fara.app.call("process.spawn", { command: "git" }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-undeclared",
      "the explicit list does not replace the capability",
    );
  } finally {
    fara.dispose();
  }
});

test("deep links with an undeclared scheme do not reach the app", async () => {
  const link = connect(manifestWith());
  try {
    const primite: string[] = [];
    link.app.on("deeplink.received", (payload) => primite.push(String(payload["url"])));

    link.host.deliverDeepLink("example://command/42");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(primite, ["example://command/42"]);
    assert.deepEqual(await link.app.call("deeplink.pending"), ["example://command/42"]);
    assert.deepEqual(await link.app.call("deeplink.pending"), [], "the list is consumed only once");

    assert.throws(() => link.host.deliverDeepLink("other://command"), /is not declared/);
    assert.throws(() => link.host.deliverDeepLink("not-a-url"), /invalid deep link/);
  } finally {
    link.dispose();
  }
});

test("the menu is defined by the app and commands come back as events", async () => {
  const link = connect(manifestWith());
  try {
    await link.app.call("menu.set", {
      items: [
        { id: "file.new", label: "New file", accelerator: "Ctrl+N" },
        { id: "file.quit", label: "Quit" },
      ],
    });
    assert.deepEqual(link.host.menu.map((item) => item.id), ["file.new", "file.quit"]);

    const comenzi: string[] = [];
    link.app.on("menu.command", (payload) => comenzi.push(String(payload["id"])));
    link.host.invokeMenu("file.new");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(comenzi, ["file.new"]);

    assert.throws(() => link.host.invokeMenu("file.nonexistent"), /does not exist/);
    await assert.rejects(link.app.call("menu.set", { items: [{ label: "no id" }] }), /id, label/);
  } finally {
    link.dispose();
  }
});

test("the host's lifecycle reaches the app as events", async () => {
  const link = connect(manifestWith());
  try {
    const stari: string[] = [];
    link.app.on("lifecycle.changed", (payload) => stari.push(String(payload["state"])));

    link.host.lifecycle.to("ready");
    link.host.lifecycle.to("foreground");
    link.host.lifecycle.to("background");
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.deepEqual(stari, ["ready", "foreground", "background"]);
    assert.equal(await link.app.call("lifecycle.state"), "background");
  } finally {
    link.dispose();
  }
});

test("updates report the channel state and deny what they cannot do", async () => {
  const fara = connect(manifestWith());
  try {
    assert.deepEqual(await fara.app.call("update.check"), { available: false, version: "1.0.0", url: null });
    await assert.rejects(fara.app.call("update.apply"), /no update/);
  } finally {
    fara.dispose();
  }

  const cu = connect(manifestWith(), {
    availableUpdate: { version: "1.1.0", url: "https://updates.example.com/1.1.0" },
  });
  try {
    assert.equal((await cu.app.call<{ version: string }>("update.check")).version, "1.1.0");
    assert.deepEqual(await cu.app.call("update.apply"), { applied: true, version: "1.1.0" });
    assert.equal(cu.host.lifecycle.state, "stopped", "applying stops the app for a restart");
  } finally {
    cu.dispose();
  }

  const magazin = connect(manifestWith({ update: { feed: null, channel: "stable" } }), {
    availableUpdate: { version: "1.1.0", url: "https://x" },
  });
  try {
    await assert.rejects(magazin.app.call("update.apply"), /store/);
  } finally {
    magazin.dispose();
  }
});

test("the host's audit log retains every call, allowed or denied", async () => {
  const channel = createMemoryChannel();
  const audit: Array<{ method: string; granted: boolean }> = [];
  const host = createDesktopHost({
    manifest: manifestWith(),
    transport: channel.host,
    onAudit: (entry) => audit.push({ method: entry.method, granted: entry.granted }),
  });
  // A bridge that claims capabilities the manifest does not grant: the host decides.
  const app = createBridge({
    target: "desktop",
    capabilities: ["device.notifications"],
    transport: channel.app,
    timeoutMs: 2000,
  });
  try {
    await app.call("window.open", {});
    await assert.rejects(app.call("notify.show", { title: "x" }));
    assert.deepEqual(audit, [
      { method: "window.open", granted: true },
      { method: "notify.show", granted: false },
    ]);
  } finally {
    app.dispose("test");
    host.close();
  }
});

test("on desktop there is no navigation stack: the app drives the windows", async () => {
  const link = connect(manifestWith());
  try {
    // The method is allowed by the protocol on any target, but the desktop
    // adapter has nothing to answer: there navigation is done per window, via
    // window.navigate.
    await assert.rejects(
      link.app.call("navigation.current"),
      (error: unknown) => (error as { code: string }).code === "raptor:host/unimplemented",
    );
  } finally {
    link.dispose();
  }
});
