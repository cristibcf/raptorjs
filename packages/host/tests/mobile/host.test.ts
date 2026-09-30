import test from "node:test";
import assert from "node:assert/strict";
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createMobileHost } from "../../src/mobile/index.ts";
import type { MobileHost, MobileHostOptions } from "../../src/mobile/index.ts";

const BASE = {
  target: "mobile",
  bundleId: "com.example.phone",
  displayName: "Example Mobile",
  version: "1.0.0",
  entry: "./index.html",
  capabilities: [] as string[],
  allowedOrigins: ["https://api.example.com"],
  deepLinkSchemes: ["example"],
  update: { feed: null, channel: "stable" },
};

function manifestWith(patch: Record<string, unknown> = {}): HostManifest {
  return requireHostManifest(JSON.stringify({ ...BASE, ...patch }));
}

interface Link {
  readonly app: HostBridge;
  readonly host: MobileHost;
  dispose(): void;
}

function connect(manifest: HostManifest, options: Partial<MobileHostOptions> = {}): Link {
  const channel = createMemoryChannel();
  const host = createMobileHost({ ...options, manifest, transport: channel.host });
  const app = createBridge({
    target: "mobile",
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

test("the adapter rejects a manifest that is not for mobile", () => {
  const desktop = requireHostManifest(JSON.stringify({ ...BASE, target: "desktop" }));
  assert.throws(
    () => createMobileHost({ manifest: desktop, transport: createMemoryChannel().host }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
});

test("the mobile app has no access to windows, even if it asks for them", async () => {
  const link = connect(manifestWith());
  try {
    assert.equal(link.app.allows("window.open"), false);
    assert.equal(link.app.allows("menu.set"), false);
    await assert.rejects(
      link.app.call("window.open", {}),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-unavailable",
    );
    await assert.rejects(
      link.app.call("process.spawn", { command: "sh" }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-unavailable",
    );
  } finally {
    link.dispose();
  }
});

test("navigation belongs to the adapter: the app is notified, not asked", async () => {
  const link = connect(manifestWith(), { initialRoute: "/home" });
  try {
    const rute: Array<{ route: string; depth: number }> = [];
    link.app.on("navigation.changed", (payload) =>
      rute.push({ route: String(payload["route"]), depth: Number(payload["depth"]) }),
    );

    assert.equal(link.host.route, "/home");
    link.host.navigate("/details/42");
    link.host.navigate("/details/42/edit");
    assert.equal(link.host.back(), true, "the system's back gesture goes up the stack");
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.deepEqual(rute, [
      { route: "/details/42", depth: 2 },
      { route: "/details/42/edit", depth: 3 },
      { route: "/details/42", depth: 2 },
    ]);
    assert.deepEqual(link.host.stack, ["/home", "/details/42"]);
  } finally {
    link.dispose();
  }
});

test("back from the root screen does not pop the app off the stack", () => {
  const link = connect(manifestWith());
  try {
    assert.equal(link.host.back(), false);
    assert.deepEqual(link.host.stack, ["/"]);
    assert.throws(() => link.host.navigate("details"), /must start/);
  } finally {
    link.dispose();
  }
});

test("secure storage uses the platform's store and the same key policy", async () => {
  const keychain = new Map<string, string>();
  const link = connect(manifestWith(), { secureStore: keychain });
  try {
    await link.app.call("storage.set", { key: "token", value: "secret" });
    assert.equal(keychain.get("token"), "secret");
    assert.deepEqual(await link.app.call("storage.keys"), ["token"]);
    await assert.rejects(link.app.call("storage.set", { key: "../other-app", value: "x" }), /invalid storage key/);
  } finally {
    link.dispose();
  }
});

test("optional modules exist only if the manifest declares them", async () => {
  const fara = connect(manifestWith());
  try {
    for (const method of ["camera.capture", "location.current", "files.pick", "notify.show"]) {
      assert.equal(fara.app.allows(method), false, `${method} should not be allowed`);
    }
  } finally {
    fara.dispose();
  }

  const cu = connect(manifestWith({ capabilities: ["device.camera", "device.location"] }), {
    capturePhoto: async () => ({ mimeType: "image/jpeg", byteLength: 1024, handle: "photo-1" }),
    readLocation: async () => ({ latitude: 44.43, longitude: 26.1, accuracyM: 12 }),
  });
  try {
    assert.deepEqual(await cu.app.call("camera.capture"), {
      mimeType: "image/jpeg",
      byteLength: 1024,
      handle: "photo-1",
    });
    assert.equal((await cu.app.call<{ latitude: number }>("location.current")).latitude, 44.43);
    assert.equal(cu.app.allows("files.pick"), false, "each module has its own capability");
  } finally {
    cu.dispose();
  }
});

test("a declared but unmounted module says it is missing, not that it is denied", async () => {
  const link = connect(manifestWith({ capabilities: ["device.camera"] }));
  try {
    await assert.rejects(link.app.call("camera.capture"), (error: unknown) => {
      const hostError = error as { code: string; detail: Record<string, unknown> };
      assert.equal(hostError.code, "raptor:host/unimplemented");
      assert.equal(hostError.detail["hostCode"], "raptor:host/unimplemented");
      return true;
    });
  } finally {
    link.dispose();
  }
});

test("mobile updates belong to the store, not to the app", async () => {
  const link = connect(manifestWith());
  try {
    assert.deepEqual(await link.app.call("update.check"), {
      available: false,
      version: "1.0.0",
      managedBy: "store",
    });
    await assert.rejects(link.app.call("update.apply"), /store/);
  } finally {
    link.dispose();
  }
});

test("the stop request sends the app to the background; the system decides the rest", async () => {
  const link = connect(manifestWith());
  try {
    link.host.lifecycle.to("ready");
    link.host.lifecycle.to("foreground");
    const raspuns = (await link.app.call("lifecycle.requestStop")) as { state: string };
    assert.equal(raspuns.state, "background");
    assert.equal(link.host.lifecycle.state, "background");

    link.host.lifecycle.to("suspended");
    assert.equal(await link.app.call("lifecycle.state"), "suspended");
  } finally {
    link.dispose();
  }
});

test("deep links honor the declared schemes", async () => {
  const link = connect(manifestWith());
  try {
    link.host.deliverDeepLink("example://product/9");
    assert.deepEqual(await link.app.call("deeplink.pending"), ["example://product/9"]);
    assert.throws(() => link.host.deliverDeepLink("other://product/9"), /is not declared/);
  } finally {
    link.dispose();
  }
});

test("the current route can be read, but there is no method to change it", async () => {
  const link = connect(manifestWith(), { initialRoute: "/home" });
  try {
    assert.deepEqual(await link.app.call("navigation.current"), { route: "/home", depth: 1 });

    link.host.navigate("/details");
    assert.deepEqual(await link.app.call("navigation.current"), { route: "/details", depth: 2 });

    // Reading is allowed (the app must know what it draws after a resume from
    // suspension); control stays entirely with the adapter.
    await assert.rejects(
      link.app.call("navigation.push", { route: "/elsewhere" }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/method-unknown",
    );
  } finally {
    link.dispose();
  }
});
