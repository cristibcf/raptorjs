import test from "node:test";
import assert from "node:assert/strict";
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createWebHost } from "../../src/web/index.ts";
import type { WebHost, WebHostOptions, WebPlatform, WebStorageLike } from "../../src/web/index.ts";

const BASE = {
  target: "web",
  bundleId: "com.exemplu.pagina",
  displayName: "Exemplu Web",
  version: "1.0.0",
  entry: "./index.html",
  capabilities: [] as string[],
  allowedOrigins: ["https://api.exemplu.com"],
  deepLinkSchemes: [] as string[],
  update: { feed: null, channel: "stable" },
};

function manifestWith(patch: Record<string, unknown> = {}): HostManifest {
  return requireHostManifest(JSON.stringify({ ...BASE, ...patch }));
}

/** `localStorage` de test: aceeasi semantica, inclusiv `key(index)`. */
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

test("adaptorul refuza un manifest care nu este de web", () => {
  const desktop = requireHostManifest(JSON.stringify({ ...BASE, target: "desktop", window: { title: "x" } }));
  assert.throws(
    () => createWebHost({ manifest: desktop, platform: {}, transport: createMemoryChannel().host }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
});

test("subprocesele nu exista in browser, sub nicio forma", async () => {
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

test("navigarea si popup-urile cer capabilitatea de ferestre, care pe web e optionala", async () => {
  const fara = connect(manifestWith(), {});
  try {
    assert.equal(fara.app.allows("window.navigate"), false, "pe web, window.manage nu e implicita");
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
    location: { pathname: "/", search: "", hash: "", origin: "https://exemplu.com" },
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

test("navigarea catre o origine straina este refuzata, ca pe desktop", async () => {
  const link = connect(manifestWith({ capabilities: ["window.manage"] }), {
    history: { pushState: () => undefined, back: () => undefined, length: 1 },
    location: { pathname: "/", search: "", hash: "", origin: "https://exemplu.com" },
  });
  try {
    await link.app.call("window.navigate", { url: "https://api.exemplu.com/panou" });
    await link.app.call("window.navigate", { url: "https://exemplu.com/acasa" });
    await assert.rejects(
      link.app.call("window.navigate", { url: "https://atacator.example/x" }),
      /navigare refuzata/,
    );
  } finally {
    link.dispose();
  }
});

test("un popup blocat de browser este raportat ca refuz, nu ca succes", async () => {
  const link = connect(manifestWith({ capabilities: ["window.manage"] }), {
    opener: { open: () => null },
    location: { pathname: "/", search: "", hash: "", origin: "https://exemplu.com" },
  });
  try {
    await assert.rejects(link.app.call("window.open", { url: "/raport" }), /popup blocat/);
  } finally {
    link.dispose();
  }
});

test("butonul de back al browserului anunta aplicatia, exact ca pe mobil", async () => {
  const popstate: { fire: ((path: string) => void) | null } = { fire: null };
  const link = connect(manifestWith(), {
    location: { pathname: "/note", search: "", hash: "", origin: "https://exemplu.com" },
    onPopState: (listener) => {
      popstate.fire = listener;
    },
  });
  try {
    const rute: string[] = [];
    link.app.on("navigation.changed", (payload) => rute.push(String(payload["route"])));
    assert.ok(popstate.fire, "adaptorul se aboneaza la popstate");

    popstate.fire("/note/1");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(rute, ["/note/1"]);
    assert.equal(link.host.route, "/note/1");
  } finally {
    link.dispose();
  }
});

test("stocarea este prefixata pe aplicatie, desi originea poate fi impartita", async () => {
  const storage = fakeStorage({ "alta-aplicatie:token": "nu al meu" });
  const link = connect(manifestWith(), { storage });
  try {
    await link.app.call("storage.set", { key: "note", value: "[]" });
    assert.equal(storage.map.get("com.exemplu.pagina:note"), "[]", "cheia poarta prefixul aplicatiei");
    assert.deepEqual(await link.app.call("storage.keys"), ["note"], "cheile altor aplicatii nu sunt listate");
    assert.equal(await link.app.call("storage.get", { key: "note" }), "[]");
    assert.deepEqual(await link.app.call("storage.delete", { key: "note" }), { deleted: true });
    assert.deepEqual(await link.app.call("storage.delete", { key: "note" }), { deleted: false });
    assert.equal(storage.map.get("alta-aplicatie:token"), "nu al meu", "nu am atins ce nu e al nostru");
  } finally {
    link.dispose();
  }
});

test("politica de chei este aceeasi ca pe host-urile native", async () => {
  const link = connect(manifestWith(), { storage: fakeStorage() });
  try {
    for (const key of ["../alta", "sub/cale", ".ascuns"]) {
      await assert.rejects(link.app.call("storage.get", { key }), /cheie de stocare invalida/);
    }
  } finally {
    link.dispose();
  }
});

test("o bucata de platforma nemontata spune ca lipseste din mediu", async () => {
  const link = connect(manifestWith({ capabilities: ["device.camera", "device.location", "window.manage"] }), {});
  try {
    for (const method of ["camera.capture", "location.current", "storage.get"]) {
      await assert.rejects(
        link.app.call(method, { key: "a" }),
        (error: unknown) => (error as { code: string }).code === "raptor:host/unimplemented",
        `${method} ar trebui raportata ca lipsa din mediu`,
      );
    }
  } finally {
    link.dispose();
  }
});

test("notificarile trec prin permisiunea browserului, nu doar prin manifest", async () => {
  const refuzat = connect(manifestWith({ capabilities: ["device.notifications"] }), {
    notifications: { requestPermission: async () => "denied", show: () => undefined },
  });
  try {
    await assert.rejects(refuzat.app.call("notify.show", { title: "x" }), /nu a acordat permisiunea/);
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
    await acceptat.app.call("notify.show", { title: "Salut", body: "gata" });
    assert.deepEqual(aratate, ["Salut: gata"]);
  } finally {
    acceptat.dispose();
  }
});

test("o pagina nu se poate inchide singura si nu se actualizeaza singura", async () => {
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
    await assert.rejects(link.app.call("update.apply"), /reincarcare/);
  } finally {
    link.dispose();
  }
});

test("meniurile nu exista pe web", async () => {
  const link = connect(manifestWith({ capabilities: ["window.manage"] }), {});
  try {
    // Capabilitatea exista pe web, deci apelul trece de broker - dar adaptorul
    // nu are ce implementa: in browser nu exista bara de meniu a aplicatiei.
    await assert.rejects(
      link.app.call("menu.set", { items: [] }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/unimplemented",
    );
  } finally {
    link.dispose();
  }
});

test("deep link-ul web este URL-ul de intrare, validat pe origine", async () => {
  const link = connect(manifestWith(), {
    location: { pathname: "/", search: "", hash: "", origin: "https://exemplu.com" },
  });
  try {
    link.host.deliverDeepLink("https://exemplu.com/nota/4");
    assert.deepEqual(await link.app.call("deeplink.pending"), ["https://exemplu.com/nota/4"]);
    assert.deepEqual(await link.app.call("deeplink.pending"), []);
    assert.throws(() => link.host.deliverDeepLink("https://atacator.example/nota/4"), /originilor permise/);
  } finally {
    link.dispose();
  }
});
