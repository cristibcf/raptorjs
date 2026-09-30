import test from "node:test";
import assert from "node:assert/strict";
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createServiceHost, nodeListeners } from "../../src/service/index.ts";
import type { Listener, ListenerFactory, ServeHandler, ServiceHost, ServiceHostOptions } from "../../src/service/index.ts";

const BASE = {
  target: "server",
  bundleId: "com.example.service",
  displayName: "Example Service",
  version: "1.0.0",
  entry: "./src/app.ts",
  capabilities: ["net.listen", "service.config"] as string[],
  allowedOrigins: ["https://api.example.com"],
  deepLinkSchemes: [] as string[],
  update: { feed: null, channel: "stable" },
};

function manifestWith(patch: Record<string, unknown> = {}): HostManifest {
  return requireHostManifest(JSON.stringify({ ...BASE, ...patch }));
}

/** In-memory listener: keeps the handler so the test can call it. */
function fakeListeners(): ListenerFactory & { handlers: Map<string, ServeHandler>; closed: string[] } {
  const handlers = new Map<string, ServeHandler>();
  const closed: string[] = [];
  return {
    handlers,
    closed,
    async open(name: string, port: number, handler: ServeHandler): Promise<Listener> {
      handlers.set(name, handler);
      return {
        name,
        port: port === 0 ? 4000 : port,
        url: `http://127.0.0.1:${port === 0 ? 4000 : port}`,
        close: async () => {
          handlers.delete(name);
          closed.push(name);
        },
      };
    },
  };
}

interface Link {
  readonly app: HostBridge;
  readonly host: ServiceHost;
  readonly listeners: ReturnType<typeof fakeListeners>;
  dispose(): Promise<void>;
}

function connect(manifest: HostManifest, options: Partial<ServiceHostOptions> = {}): Link {
  const channel = createMemoryChannel();
  const listeners = fakeListeners();
  const host = createServiceHost({
    ports: { public: 0 },
    ...options,
    manifest,
    transport: channel.host,
    listeners: options.listeners ?? listeners,
  });
  const app = createBridge({
    target: "server",
    capabilities: manifest.capabilities,
    transport: channel.app,
    timeoutMs: 2000,
  });
  return {
    app,
    host,
    listeners,
    dispose: async () => {
      await host.close();
      app.dispose("test");
    },
  };
}

/** Responds to every request received, like a minimal service. */
function autoRespond(app: HostBridge, reply: (event: Record<string, unknown>) => Record<string, unknown>): void {
  app.on("serve.request", (payload) => {
    void app.call("serve.respond", { id: payload["id"], ...reply(payload) });
  });
}

test("the adapter rejects a manifest that is not for server", () => {
  const desktop = requireHostManifest(JSON.stringify({ ...BASE, target: "desktop", capabilities: [] }));
  assert.throws(
    () => createServiceHost({ manifest: desktop, transport: createMemoryChannel().host, listeners: fakeListeners() }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
});

test("a service has no windows, camera or notifications", async () => {
  const link = connect(manifestWith());
  try {
    for (const method of ["window.open", "menu.set", "camera.capture", "notify.show", "files.pick"]) {
      assert.equal(link.app.allows(method), false, `${method} has no place on a server`);
    }
    await assert.rejects(
      link.app.call("window.open", {}),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-unavailable",
    );
  } finally {
    await link.dispose();
  }
});

test("the app requests the listener by name; the host knows the port", async () => {
  const link = connect(manifestWith(), { ports: { public: 8080 } });
  try {
    const listener = (await link.app.call("serve.listen", { name: "public" })) as { port: number; url: string };
    assert.equal(listener.port, 8080, "the port comes from the deployment allocation");
    assert.equal(link.host.urlOf("public"), listener.url);
    assert.equal(link.host.listeners.length, 1);
  } finally {
    await link.dispose();
  }
});

test("an unallocated port is denied, with the list of available ones", async () => {
  const link = connect(manifestWith(), { ports: { public: 8080 } });
  try {
    await assert.rejects(link.app.call("serve.listen", { name: "admin" }), (error: unknown) => {
      const hostError = error as { code: string; detail: Record<string, unknown> };
      assert.equal(hostError.code, "raptor:host/capability-undeclared");
      assert.deepEqual(hostError.detail["allocated"], ["public"]);
      return true;
    });
  } finally {
    await link.dispose();
  }
});

test("the same listener cannot be opened twice", async () => {
  const link = connect(manifestWith());
  try {
    await link.app.call("serve.listen", { name: "public" });
    await assert.rejects(link.app.call("serve.listen", { name: "public" }), /already open/);
  } finally {
    await link.dispose();
  }
});

test("without the net.listen capability, the service cannot listen at all", async () => {
  const link = connect(manifestWith({ capabilities: ["service.config"] }));
  try {
    assert.equal(link.app.allows("serve.listen"), false);
    await assert.rejects(
      link.app.call("serve.listen", { name: "public" }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-undeclared",
    );
  } finally {
    await link.dispose();
  }
});

test("requests reach the app as events and responses come back through the bridge", async () => {
  const link = connect(manifestWith());
  try {
    const seen: string[] = [];
    autoRespond(link.app, (event) => {
      seen.push(`${String(event["method"])} ${new URL(String(event["url"])).pathname}`);
      return { status: 200, headers: { "content-type": "text/plain" }, body: "hello" };
    });
    await link.app.call("serve.listen", { name: "public" });

    const handler = link.listeners.handlers.get("public")!;
    const response = await handler(new Request("http://127.0.0.1/note"));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "hello");
    assert.deepEqual(seen, ["GET /note"]);
  } finally {
    await link.dispose();
  }
});

test("the request body reaches the app, and the app's status reaches the client", async () => {
  const link = connect(manifestWith());
  try {
    autoRespond(link.app, (event) => ({ status: 201, body: `received: ${String(event["body"])}` }));
    await link.app.call("serve.listen", { name: "public" });

    const handler = link.listeners.handlers.get("public")!;
    const response = await handler(new Request("http://127.0.0.1/note", { method: "POST", body: '{"text":"x"}' }));
    assert.equal(response.status, 201);
    assert.equal(await response.text(), 'received: {"text":"x"}');
  } finally {
    await link.dispose();
  }
});

test("a response for a request that no longer exists is reported, not thrown", async () => {
  const link = connect(manifestWith());
  try {
    assert.deepEqual(await link.app.call("serve.respond", { id: 999, status: 200 }), { delivered: false });
  } finally {
    await link.dispose();
  }
});

test("the health declared by the app moves the service into the state that serves", async () => {
  const link = connect(manifestWith());
  try {
    assert.equal(link.host.health, "starting");
    assert.equal(link.host.lifecycle.state, "launching");

    await link.app.call("health.set", { state: "ready" });
    assert.equal(link.host.health, "ready");
    assert.equal(link.host.lifecycle.state, "foreground", "'foreground' = takes traffic");

    await assert.rejects(link.app.call("health.set", { state: "draining" }), /unknown health state/);
  } finally {
    await link.dispose();
  }
});

test("draining closes the sockets and takes the service through the correct states", async () => {
  const link = connect(manifestWith());
  try {
    autoRespond(link.app, () => ({ status: 200, body: "ok" }));
    await link.app.call("serve.listen", { name: "public" });
    await link.app.call("health.set", { state: "ready" });

    await link.host.requestDrain("SIGTERM");

    assert.equal(link.host.health, "draining");
    assert.deepEqual(link.host.lifecycle.history, ["launching", "ready", "foreground", "background", "stopped"]);
    assert.deepEqual(link.listeners.closed, ["public"]);
    assert.equal(link.host.listeners.length, 0);
  } finally {
    await link.dispose();
  }
});

test("draining is idempotent and works even before the service has served", async () => {
  const link = connect(manifestWith());
  try {
    // A supervisor that changes its mind during startup: there is no traffic to
    // drain, and the only legal transition from 'launching' is the stop.
    await link.host.requestDrain("SIGTERM");
    await link.host.requestDrain("SIGTERM");
    assert.equal(link.host.lifecycle.state, "stopped");
    assert.deepEqual(link.host.lifecycle.history, ["launching", "stopped"]);
  } finally {
    await link.dispose();
  }
});

test("during draining, new requests get a 503 instead of being accepted", async () => {
  const link = connect(manifestWith());
  try {
    autoRespond(link.app, () => ({ status: 200, body: "ok" }));
    await link.app.call("serve.listen", { name: "public" });
    await link.app.call("health.set", { state: "ready" });

    const handler = link.listeners.handlers.get("public")!;
    assert.equal((await handler(new Request("http://127.0.0.1/note"))).status, 200);

    await link.host.requestDrain("SIGTERM");
    const refused = await handler(new Request("http://127.0.0.1/note"));
    assert.equal(refused.status, 503);
    assert.equal(refused.headers.get("retry-after"), "1");
  } finally {
    await link.dispose();
  }
});

test("configuration comes from the supervisor, not from the app's files", async () => {
  const link = connect(manifestWith(), { config: { DATABASE_URL: "postgres://x", GREETING: "hello" } });
  try {
    assert.equal(await link.app.call("config.get", { key: "GREETING" }), "hello");
    assert.equal(await link.app.call("config.get", { key: "MISSING" }), null, "an absent key is not an error");
  } finally {
    await link.dispose();
  }

  const fara = connect(manifestWith({ capabilities: ["net.listen"] }));
  try {
    await assert.rejects(
      fara.app.call("config.get", { key: "GREETING" }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-undeclared",
    );
  } finally {
    await fara.dispose();
  }
});

test("the service's storage honors the same key policy as the other hosts", async () => {
  const storage = new Map<string, string>();
  const link = connect(manifestWith(), { storage });
  try {
    await link.app.call("storage.set", { key: "note", value: "[]" });
    assert.equal(storage.get("note"), "[]");
    await assert.rejects(link.app.call("storage.get", { key: "../other" }), /invalid storage key/);
  } finally {
    await link.dispose();
  }
});

test("serve.status reports the open listeners and the health", async () => {
  const link = connect(manifestWith(), { ports: { public: 9100 } });
  try {
    await link.app.call("serve.listen", { name: "public" });
    await link.app.call("health.set", { state: "ready" });
    const status = (await link.app.call("serve.status")) as {
      listeners: Array<{ name: string; port: number }>;
      health: string;
      inFlight: number;
    };
    assert.deepEqual(status.listeners, [{ name: "public", port: 9100, url: "http://127.0.0.1:9100" }]);
    assert.equal(status.health, "ready");
    assert.equal(status.inFlight, 0);
  } finally {
    await link.dispose();
  }
});

test("a service updates through redeployment, not on its own", async () => {
  const link = connect(manifestWith());
  try {
    assert.deepEqual(await link.app.call("update.check"), {
      available: false,
      version: "1.0.0",
      managedBy: "deployment",
    });
    await assert.rejects(link.app.call("update.apply"), /redeployment/);
  } finally {
    await link.dispose();
  }
});

test("over a real socket, the contract is the same", async () => {
  const link = connect(manifestWith(), { ports: { public: 0 }, listeners: nodeListeners() });
  try {
    autoRespond(link.app, (event) => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: new URL(String(event["url"])).pathname }),
    }));
    const listener = (await link.app.call("serve.listen", { name: "public" })) as { url: string; port: number };
    assert.ok(listener.port > 0, "port 0 means 'pick a free one'");

    const response = await fetch(`${listener.url}/note`);
    assert.deepEqual(await response.json(), { path: "/note" });

    await link.host.requestDrain("SIGTERM");
    await assert.rejects(fetch(`${listener.url}/note`), "the socket is closed after draining");
  } finally {
    await link.dispose();
  }
});
