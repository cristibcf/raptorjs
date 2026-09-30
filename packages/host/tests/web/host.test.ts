import test from "node:test";
import assert from "node:assert/strict";
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptorstack/host";
import type { HostBridge, HostManifest } from "@raptorstack/host";
import { createWebHost } from "../../src/web/index.ts";
import type { WebHost, WebHostOptions, WebPlatform, WebStorageLike } from "../../src/web/index.ts";

const BASE = {
  target: "web",
  bundleId: "com.example.page",
  displayName: "Example Web",
  version: "1.0.0",
  entry: "./index.html",
  capabilities: [] as string[],
  allowedOrigins: ["https://api.example.com"],
  deepLinkSchemes: [] as string[],
  update: { feed: null, channel: "stable" },
};

function manifestWith(patch: Record<string, unknown> = {}): HostManifest {
  return requireHostManifest(JSON.stringify({ ...BASE, ...patch }));
}

/** A test `localStorage`: the same semantics, including `key(index)`. */
function fakeStorage(seed: Record<string, string> = {}): WebStorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    get length(): number {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
  };
}

interface Link {
  readonly app: HostBridge;
  readonly host: WebHost;
  dispose(): void;
}

function connect(manifest: HostManifest, platform: WebPlatform, options: Partial<WebHostOptions> = {}): Link {
  const channel = createMemoryChannel();
  const host = createWebHost({ ...options, manifest, platform, transport: channel.host });
  const app = createBridge({
    target: "web",
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

test("the adapter rejects a manifest that is not for web", () => {
  const desktop = requireHostManifest(JSON.stringify({ ...BASE, target: "desktop", window: { title: "x" } }));
  assert.throws(
    () => createWebHost({ manifest: desktop, platform: {}, transport: createMemoryChannel().host }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
});

test("subprocesses do not exist in the browser, in any form", async () => {
  const link = connect(manifestWith({ capabilities: [] }), {});
  try {
    assert.equal(link.app.allows("process.spawn"), false);
    await assert.rejects(
      link.app.call("process.spawn", { command: "sh" }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-unavailable",
    );
  } finally {
    link.dispose();
  }
});

test("navigation and popups require the window capability, which on web is optional", async () => {
  const fara = connect(manifestWith(), {});
  try {
    assert.equal(fara.app.allows("window.navigate"), false, "on web, window.manage is not implicit");
  } finally {
    fara.dispose();
  }

  const pushed: string[] = [];
  const link = connect(manifestWith({ capabilities: ["window.manage"] }), {
    history: {
      pushState: (_data, _unused, url) => {
        pushed.push(url);
      },
      back: () => undefined,
      length: 1,
    },
    location: { pathname: "/", search: "", hash: "", origin: "https://example.com" },
  });
  try {
    await link.app.call("window.navigate", { url: "/note/1" });
    assert.deepEqual(pushed, ["/note/1"]);
    assert.equal(link.host.route, "/note/1");
    assert.deepEqual(await link.app.call("navigation.current"), { route: "/note/1", depth: 1 });
  } finally {
    link.dispose();
  }
});

test("navigation to a foreign origin is denied, as on desktop", async () => {
  const link = connect(manifestWith({ capabilities: ["window.manage"] }), {
    history: { pushState: () => undefined, back: () => undefined, length: 1 },
    location: { pathname: "/", search: "", hash: "", origin: "https://example.com" },
  });
  try {
    await link.app.call("window.navigate", { url: "https://api.example.com/panel" });
    await link.app.call("window.navigate", { url: "https://example.com/home" });
    await assert.rejects(
      link.app.call("window.navigate", { url: "https://attacker.example/x" }),
      /navigation denied/,
    );
  } finally {
    link.dispose();
  }
});

test("a popup blocked by the browser is reported as a denial, not a success", async () => {
  const link = connect(manifestWith({ capabilities: ["window.manage"] }), {
    opener: { open: () => null },
    location: { pathname: "/", search: "", hash: "", origin: "https://example.com" },
  });
  try {
    await assert.rejects(link.app.call("window.open", { url: "/report" }), /popup blocked/);
  } finally {
    link.dispose();
  }
});

test("the browser's back button notifies the app, exactly as on mobile", async () => {
  const popstate: { fire: ((path: string) => void) | null } = { fire: null };
  const link = connect(manifestWith(), {
    location: { pathname: "/note", search: "", hash: "", origin: "https://example.com" },
    onPopState: (listener) => {
      popstate.fire = listener;
    },
  });
  try {
    const rute: string[] = [];
    link.app.on("navigation.changed", (payload) => rute.push(String(payload["route"])));
    assert.ok(popstate.fire, "the adapter subscribes to popstate");

    popstate.fire("/note/1");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(rute, ["/note/1"]);
    assert.equal(link.host.route, "/note/1");
  } finally {
    link.dispose();
  }
});

test("storage is prefixed per app, even though the origin may be shared", async () => {
  const storage = fakeStorage({ "other-app:token": "not mine" });
  const link = connect(manifestWith(), { storage });
  try {
    await link.app.call("storage.set", { key: "note", value: "[]" });
    assert.equal(storage.map.get("com.example.page:note"), "[]", "the key carries the app prefix");
    assert.deepEqual(await link.app.call("storage.keys"), ["note"], "other apps' keys are not listed");
    assert.equal(await link.app.call("storage.get", { key: "note" }), "[]");
    assert.deepEqual(await link.app.call("storage.delete", { key: "note" }), { deleted: true });
    assert.deepEqual(await link.app.call("storage.delete", { key: "note" }), { deleted: false });
    assert.equal(storage.map.get("other-app:token"), "not mine", "we did not touch what is not ours");
  } finally {
    link.dispose();
  }
});

test("the key policy is the same as on the native hosts", async () => {
  const link = connect(manifestWith(), { storage: fakeStorage() });
  try {
    for (const key of ["../other", "sub/path", ".hidden"]) {
      await assert.rejects(link.app.call("storage.get", { key }), /invalid storage key/);
    }
  } finally {
    link.dispose();
  }
});

test("an unmounted platform piece says it is missing from the environment", async () => {
  const link = connect(manifestWith({ capabilities: ["device.camera", "device.location", "window.manage"] }), {});
  try {
    for (const method of ["camera.capture", "location.current", "storage.get"]) {
      await assert.rejects(
        link.app.call(method, { key: "a" }),
        (error: unknown) => (error as { code: string }).code === "raptor:host/unimplemented",
        `${method} should be reported as missing from the environment`,
      );
    }
  } finally {
    link.dispose();
  }
});

test("notifications go through the browser's permission, not just the manifest", async () => {
  const refuzat = connect(manifestWith({ capabilities: ["device.notifications"] }), {
    notifications: { requestPermission: async () => "denied", show: () => undefined },
  });
  try {
    await assert.rejects(refuzat.app.call("notify.show", { title: "x" }), /did not grant/);
  } finally {
    refuzat.dispose();
  }

  const aratate: string[] = [];
  const acceptat = connect(manifestWith({ capabilities: ["device.notifications"] }), {
    notifications: {
      requestPermission: async () => "granted",
      show: (title, body) => aratate.push(`${title}: ${body}`),
    },
  });
  try {
    await acceptat.app.call("notify.show", { title: "Hello", body: "done" });
    assert.deepEqual(aratate, ["Hello: done"]);
  } finally {
    acceptat.dispose();
  }
});

test("a page cannot close itself and does not update itself", async () => {
  const link = connect(manifestWith(), {});
  try {
    link.host.lifecycle.to("ready");
    link.host.lifecycle.to("foreground");
    const raspuns = (await link.app.call("lifecycle.requestStop")) as { state: string };
    assert.equal(raspuns.state, "background");

    assert.deepEqual(await link.app.call("update.check"), {
      available: false,
      version: "1.0.0",
      managedBy: "reload",
    });
    await assert.rejects(link.app.call("update.apply"), /reloading/);
  } finally {
    link.dispose();
  }
});

test("menus do not exist on web", async () => {
  const link = connect(manifestWith({ capabilities: ["window.manage"] }), {});
  try {
    // The capability exists on web, so the call passes the broker - but the
    // adapter has nothing to implement: in the browser there is no app menu bar.
    await assert.rejects(
      link.app.call("menu.set", { items: [] }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/unimplemented",
    );
  } finally {
    link.dispose();
  }
});

test("the web deep link is the entry URL, validated by origin", async () => {
  const link = connect(manifestWith(), {
    location: { pathname: "/", search: "", hash: "", origin: "https://example.com" },
  });
  try {
    link.host.deliverDeepLink("https://example.com/note/4");
    assert.deepEqual(await link.app.call("deeplink.pending"), ["https://example.com/note/4"]);
    assert.deepEqual(await link.app.call("deeplink.pending"), []);
    assert.throws(() => link.host.deliverDeepLink("https://attacker.example/note/4"), /allowed origins/);
  } finally {
    link.dispose();
  }
});
