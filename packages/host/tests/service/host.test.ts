import test from "node:test";
import assert from "node:assert/strict";
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createServiceHost, nodeListeners } from "../../src/service/index.ts";
import type { Listener, ListenerFactory, ServeHandler, ServiceHost, ServiceHostOptions } from "../../src/service/index.ts";

const BASE = {
  target: "server",
  bundleId: "com.exemplu.serviciu",
  displayName: "Exemplu Serviciu",
  version: "1.0.0",
  entry: "./src/app.ts",
  capabilities: ["net.listen", "service.config"] as string[],
  allowedOrigins: ["https://api.exemplu.com"],
  deepLinkSchemes: [] as string[],
  update: { feed: null, channel: "stable" },
};

function manifestWith(patch: Record<string, unknown> = {}): HostManifest {
  return requireHostManifest(JSON.stringify({ ...BASE, ...patch }));
}

/** Listener in memorie: pastreaza handlerul, ca testul sa il poata chema. */
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

/** Raspunde la fiecare cerere primita, ca un serviciu minimal. */
function autoRespond(app: HostBridge, reply: (event: Record<string, unknown>) => Record<string, unknown>): void {
  app.on("serve.request", (payload) => {
    void app.call("serve.respond", { id: payload["id"], ...reply(payload) });
  });
}

test("adaptorul refuza un manifest care nu este de server", () => {
  const desktop = requireHostManifest(JSON.stringify({ ...BASE, target: "desktop", capabilities: [] }));
  assert.throws(
    () => createServiceHost({ manifest: desktop, transport: createMemoryChannel().host, listeners: fakeListeners() }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
});

test("un serviciu nu are ferestre, camera si nici notificari", async () => {
  const link = connect(manifestWith());
  try {
    for (const method of ["window.open", "menu.set", "camera.capture", "notify.show", "files.pick"]) {
      assert.equal(link.app.allows(method), false, `${method} nu are ce cauta pe un server`);
    }
    await assert.rejects(
      link.app.call("window.open", {}),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-unavailable",
    );
  } finally {
    await link.dispose();
  }
});

test("aplicatia cere listenerul pe nume; portul il stie host-ul", async () => {
  const link = connect(manifestWith(), { ports: { public: 8080 } });
  try {
    const listener = (await link.app.call("serve.listen", { name: "public" })) as { port: number; url: string };
    assert.equal(listener.port, 8080, "portul vine din alocarea de deployment");
    assert.equal(link.host.urlOf("public"), listener.url);
    assert.equal(link.host.listeners.length, 1);
  } finally {
    await link.dispose();
  }
});

test("un port nealocat este refuzat, cu lista celor disponibile", async () => {
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

test("acelasi listener nu poate fi deschis de doua ori", async () => {
  const link = connect(manifestWith());
  try {
    await link.app.call("serve.listen", { name: "public" });
    await assert.rejects(link.app.call("serve.listen", { name: "public" }), /deja deschis/);
  } finally {
    await link.dispose();
  }
});

test("fara capabilitatea net.listen, serviciul nu poate asculta deloc", async () => {
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

test("cererile ajung la aplicatie ca evenimente si raspunsurile se intorc prin punte", async () => {
  const link = connect(manifestWith());
  try {
    const seen: string[] = [];
    autoRespond(link.app, (event) => {
      seen.push(`${String(event["method"])} ${new URL(String(event["url"])).pathname}`);
      return { status: 200, headers: { "content-type": "text/plain" }, body: "salut" };
    });
    await link.app.call("serve.listen", { name: "public" });

    const handler = link.listeners.handlers.get("public")!;
    const response = await handler(new Request("http://127.0.0.1/note"));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "salut");
    assert.deepEqual(seen, ["GET /note"]);
  } finally {
    await link.dispose();
  }
});

test("corpul cererii ajunge la aplicatie, iar statusul aplicatiei ajunge la client", async () => {
  const link = connect(manifestWith());
  try {
    autoRespond(link.app, (event) => ({ status: 201, body: `primit: ${String(event["body"])}` }));
    await link.app.call("serve.listen", { name: "public" });

    const handler = link.listeners.handlers.get("public")!;
    const response = await handler(new Request("http://127.0.0.1/note", { method: "POST", body: '{"text":"x"}' }));
    assert.equal(response.status, 201);
    assert.equal(await response.text(), 'primit: {"text":"x"}');
  } finally {
    await link.dispose();
  }
});

test("un raspuns pentru o cerere care nu mai exista este raportat, nu aruncat", async () => {
  const link = connect(manifestWith());
  try {
    assert.deepEqual(await link.app.call("serve.respond", { id: 999, status: 200 }), { delivered: false });
  } finally {
    await link.dispose();
  }
});

test("sanatatea declarata de aplicatie muta serviciul in starea care serveste", async () => {
  const link = connect(manifestWith());
  try {
    assert.equal(link.host.health, "starting");
    assert.equal(link.host.lifecycle.state, "launching");

    await link.app.call("health.set", { state: "ready" });
    assert.equal(link.host.health, "ready");
    assert.equal(link.host.lifecycle.state, "foreground", "'foreground' = primeste trafic");

    await assert.rejects(link.app.call("health.set", { state: "draining" }), /stare de sanatate necunoscuta/);
  } finally {
    await link.dispose();
  }
});

test("drenarea inchide socketii si duce serviciul prin starile corecte", async () => {
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

test("drenarea este idempotenta si merge si inainte ca serviciul sa fi servit", async () => {
  const link = connect(manifestWith());
  try {
    // Un supervizor care se razgandeste in timpul pornirii: nu exista trafic de
    // drenat, iar singura tranzitie legala din 'launching' este oprirea.
    await link.host.requestDrain("SIGTERM");
    await link.host.requestDrain("SIGTERM");
    assert.equal(link.host.lifecycle.state, "stopped");
    assert.deepEqual(link.host.lifecycle.history, ["launching", "stopped"]);
  } finally {
    await link.dispose();
  }
});

test("in timpul drenarii, cererile noi primesc 503 in loc sa fie acceptate", async () => {
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

test("configuratia vine de la supervizor, nu din fisierele aplicatiei", async () => {
  const link = connect(manifestWith(), { config: { DATABASE_URL: "postgres://x", GREETING: "salut" } });
  try {
    assert.equal(await link.app.call("config.get", { key: "GREETING" }), "salut");
    assert.equal(await link.app.call("config.get", { key: "LIPSA" }), null, "o cheie absenta nu este o eroare");
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

test("stocarea serviciului respecta aceeasi politica de chei ca pe celelalte host-uri", async () => {
  const storage = new Map<string, string>();
  const link = connect(manifestWith(), { storage });
  try {
    await link.app.call("storage.set", { key: "note", value: "[]" });
    assert.equal(storage.get("note"), "[]");
    await assert.rejects(link.app.call("storage.get", { key: "../alt" }), /cheie de stocare invalida/);
  } finally {
    await link.dispose();
  }
});

test("serve.status raporteaza listenerii deschisi si sanatatea", async () => {
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

test("un serviciu se actualizeaza prin redeployment, nu singur", async () => {
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

test("peste un socket real, contractul este acelasi", async () => {
  const link = connect(manifestWith(), { ports: { public: 0 }, listeners: nodeListeners() });
  try {
    autoRespond(link.app, (event) => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: new URL(String(event["url"])).pathname }),
    }));
    const listener = (await link.app.call("serve.listen", { name: "public" })) as { url: string; port: number };
    assert.ok(listener.port > 0, "portul 0 inseamna 'alege unul liber'");

    const response = await fetch(`${listener.url}/note`);
    assert.deepEqual(await response.json(), { path: "/note" });

    await link.host.requestDrain("SIGTERM");
    await assert.rejects(fetch(`${listener.url}/note`), "socketul este inchis dupa drenare");
  } finally {
    await link.dispose();
  }
});
