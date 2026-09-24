import test from "node:test";
import assert from "node:assert/strict";
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createMobileHost } from "../src/index.ts";
import type { MobileHost, MobileHostOptions } from "../src/index.ts";

const BASE = {
  target: "mobile",
  bundleId: "com.exemplu.telefon",
  displayName: "Exemplu Mobil",
  version: "1.0.0",
  entry: "./index.html",
  capabilities: [] as string[],
  allowedOrigins: ["https://api.exemplu.com"],
  deepLinkSchemes: ["exemplu"],
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

test("adaptorul refuza un manifest care nu este de mobil", () => {
  const desktop = requireHostManifest(JSON.stringify({ ...BASE, target: "desktop" }));
  assert.throws(
    () => createMobileHost({ manifest: desktop, transport: createMemoryChannel().host }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
});

test("aplicatia mobila nu are acces la ferestre, nici daca le cere", async () => {
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

test("navigarea apartine adaptorului: aplicatia este anuntata, nu intrebata", async () => {
  const link = connect(manifestWith(), { initialRoute: "/acasa" });
  try {
    const rute: Array<{ route: string; depth: number }> = [];
    link.app.on("navigation.changed", (payload) =>
      rute.push({ route: String(payload["route"]), depth: Number(payload["depth"]) }),
    );

    assert.equal(link.host.route, "/acasa");
    link.host.navigate("/detalii/42");
    link.host.navigate("/detalii/42/editare");
    assert.equal(link.host.back(), true, "gestul de back al sistemului urca in stiva");
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.deepEqual(rute, [
      { route: "/detalii/42", depth: 2 },
      { route: "/detalii/42/editare", depth: 3 },
      { route: "/detalii/42", depth: 2 },
    ]);
    assert.deepEqual(link.host.stack, ["/acasa", "/detalii/42"]);
  } finally {
    link.dispose();
  }
});

test("back-ul din ecranul radacina nu scoate aplicatia din stiva", () => {
  const link = connect(manifestWith());
  try {
    assert.equal(link.host.back(), false);
    assert.deepEqual(link.host.stack, ["/"]);
    assert.throws(() => link.host.navigate("detalii"), /trebuie sa inceapa/);
  } finally {
    link.dispose();
  }
});

test("stocarea securizata foloseste magazinul platformei si aceeasi politica de chei", async () => {
  const keychain = new Map<string, string>();
  const link = connect(manifestWith(), { secureStore: keychain });
  try {
    await link.app.call("storage.set", { key: "token", value: "secret" });
    assert.equal(keychain.get("token"), "secret");
    assert.deepEqual(await link.app.call("storage.keys"), ["token"]);
    await assert.rejects(link.app.call("storage.set", { key: "../alt-app", value: "x" }), /cheie de stocare invalida/);
  } finally {
    link.dispose();
  }
});

test("modulele optionale exista doar daca manifestul le declara", async () => {
  const fara = connect(manifestWith());
  try {
    for (const method of ["camera.capture", "location.current", "files.pick", "notify.show"]) {
      assert.equal(fara.app.allows(method), false, `${method} nu ar trebui permisa`);
    }
  } finally {
    fara.dispose();
  }

  const cu = connect(manifestWith({ capabilities: ["device.camera", "device.location"] }), {
    capturePhoto: async () => ({ mimeType: "image/jpeg", byteLength: 1024, handle: "foto-1" }),
    readLocation: async () => ({ latitude: 44.43, longitude: 26.1, accuracyM: 12 }),
  });
  try {
    assert.deepEqual(await cu.app.call("camera.capture"), {
      mimeType: "image/jpeg",
      byteLength: 1024,
      handle: "foto-1",
    });
    assert.equal((await cu.app.call<{ latitude: number }>("location.current")).latitude, 44.43);
    assert.equal(cu.app.allows("files.pick"), false, "fiecare modul are capabilitatea lui");
  } finally {
    cu.dispose();
  }
});

test("un modul declarat dar nemontat spune ca lipseste, nu ca este refuzat", async () => {
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

test("actualizarile mobile sunt ale magazinului, nu ale aplicatiei", async () => {
  const link = connect(manifestWith());
  try {
    assert.deepEqual(await link.app.call("update.check"), {
      available: false,
      version: "1.0.0",
      managedBy: "store",
    });
    await assert.rejects(link.app.call("update.apply"), /magazin/);
  } finally {
    link.dispose();
  }
});

test("cererea de oprire trimite aplicatia in fundal; sistemul decide restul", async () => {
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

test("deep link-urile respecta schemele declarate", async () => {
  const link = connect(manifestWith());
  try {
    link.host.deliverDeepLink("exemplu://produs/9");
    assert.deepEqual(await link.app.call("deeplink.pending"), ["exemplu://produs/9"]);
    assert.throws(() => link.host.deliverDeepLink("altceva://produs/9"), /nu este declarata/);
  } finally {
    link.dispose();
  }
});

test("ruta curenta poate fi citita, dar nu exista metoda prin care sa fie schimbata", async () => {
  const link = connect(manifestWith(), { initialRoute: "/acasa" });
  try {
    assert.deepEqual(await link.app.call("navigation.current"), { route: "/acasa", depth: 1 });

    link.host.navigate("/detalii");
    assert.deepEqual(await link.app.call("navigation.current"), { route: "/detalii", depth: 2 });

    // Citirea este permisa (aplicatia trebuie sa stie ce deseneaza dupa o
    // reluare din suspendare); controlul ramane in intregime la adaptor.
    await assert.rejects(
      link.app.call("navigation.push", { route: "/altundeva" }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/method-unknown",
    );
  } finally {
    link.dispose();
  }
});
