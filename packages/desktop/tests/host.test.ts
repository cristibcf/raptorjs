import test from "node:test";
import assert from "node:assert/strict";
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createDesktopHost } from "../src/index.ts";
import type { DesktopHost, DesktopHostOptions } from "../src/index.ts";

const BASE = {
  target: "desktop",
  bundleId: "com.exemplu.desktop",
  displayName: "Exemplu Desktop",
  version: "1.0.0",
  entry: "./index.html",
  capabilities: [] as string[],
  allowedOrigins: ["https://api.exemplu.com"],
  deepLinkSchemes: ["exemplu"],
  window: { title: "Exemplu", width: 1200, height: 800, resizable: true },
  update: { feed: "https://actualizari.exemplu.com/stable.json", channel: "stable" },
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

test("adaptorul refuza un manifest care nu este de desktop", () => {
  const mobile = requireHostManifest(
    JSON.stringify({ ...BASE, target: "mobile", window: undefined, deepLinkSchemes: ["exemplu"] }),
  );
  assert.throws(
    () => createDesktopHost({ manifest: mobile, transport: createMemoryChannel().host }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
});

test("ferestrele se deschid cu dimensiunile din manifest si se inchid", async () => {
  const link = connect(manifestWith());
  try {
    const opened = (await link.app.call("window.open", { title: "Principala" })) as { id: string };
    assert.equal(link.host.windows.length, 1);
    assert.equal(link.host.windows[0]?.width, 1200);
    assert.equal(link.host.windows[0]?.url, "./index.html", "fara url explicit se incarca intrarea aplicatiei");

    await link.app.call("window.setTitle", { id: opened.id, title: "Redenumita" });
    assert.equal(link.host.windows[0]?.title, "Redenumita");

    await link.app.call("window.close", { id: opened.id });
    assert.equal(link.host.windows.length, 0);
  } finally {
    link.dispose();
  }
});

test("navigarea in afara originilor declarate este refuzata", async () => {
  const link = connect(manifestWith());
  try {
    const opened = (await link.app.call("window.open", {})) as { id: string };
    await link.app.call("window.navigate", { id: opened.id, url: "https://api.exemplu.com/panou" });
    assert.equal(link.host.windows[0]?.url, "https://api.exemplu.com/panou");

    await assert.rejects(
      link.app.call("window.navigate", { id: opened.id, url: "https://atacator.example/pagina" }),
      /navigare refuzata/,
    );
    assert.equal(link.host.windows[0]?.url, "https://api.exemplu.com/panou", "starea nu se schimba la refuz");

    // Caile relative raman permise: sunt in unitatea ambalata a aplicatiei.
    await link.app.call("window.navigate", { id: opened.id, url: "/setari" });
    assert.equal(link.host.windows[0]?.url, "/setari");
  } finally {
    link.dispose();
  }
});

test("o fereastra inexistenta nu poate fi manipulata", async () => {
  const link = connect(manifestWith());
  try {
    await assert.rejects(link.app.call("window.setTitle", { id: "w99", title: "x" }), /nu exista/);
    await assert.rejects(link.app.call("window.close", { id: "w99" }), /nu exista/);
  } finally {
    link.dispose();
  }
});

test("stocarea locala este un spatiu plat, legat de aplicatie", async () => {
  const magazin = new Map<string, string>();
  const link = connect(manifestWith(), { storage: magazin });
  try {
    await link.app.call("storage.set", { key: "sesiune", value: "abc" });
    assert.equal(await link.app.call("storage.get", { key: "sesiune" }), "abc");
    assert.equal(await link.app.call("storage.get", { key: "lipsa" }), null);
    assert.deepEqual(await link.app.call("storage.keys"), ["sesiune"]);
    assert.equal(magazin.get("sesiune"), "abc", "magazinul injectat este cel scris");

    for (const key of ["../escapare", "sub/cale", ".ascuns", "a\\b"]) {
      await assert.rejects(link.app.call("storage.get", { key }), /cheie de stocare invalida/);
    }

    assert.deepEqual(await link.app.call("storage.delete", { key: "sesiune" }), { deleted: true });
    assert.deepEqual(await link.app.call("storage.delete", { key: "sesiune" }), { deleted: false });
  } finally {
    link.dispose();
  }
});

test("notificarile cer capabilitatea lor", async () => {
  const fara = connect(manifestWith());
  try {
    await assert.rejects(
      fara.app.call("notify.show", { title: "Salut" }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-undeclared",
    );
  } finally {
    fara.dispose();
  }

  const cu = connect(manifestWith({ capabilities: ["device.notifications"] }), { now: () => 1000 });
  try {
    await cu.app.call("notify.show", { title: "Salut", body: "gata" });
    assert.deepEqual(cu.host.notifications, [{ title: "Salut", body: "gata", atMs: 1000 }]);
  } finally {
    cu.dispose();
  }
});

test("subprocesele cer si capabilitatea, si comanda din lista explicita", async () => {
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
      "lista explicita nu inlocuieste capabilitatea",
    );
  } finally {
    fara.dispose();
  }
});

test("deep link-urile cu schema nedeclarata nu ajung la aplicatie", async () => {
  const link = connect(manifestWith());
  try {
    const primite: string[] = [];
    link.app.on("deeplink.received", (payload) => primite.push(String(payload["url"])));

    link.host.deliverDeepLink("exemplu://comanda/42");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(primite, ["exemplu://comanda/42"]);
    assert.deepEqual(await link.app.call("deeplink.pending"), ["exemplu://comanda/42"]);
    assert.deepEqual(await link.app.call("deeplink.pending"), [], "lista se consuma o singura data");

    assert.throws(() => link.host.deliverDeepLink("altceva://comanda"), /nu este declarata/);
    assert.throws(() => link.host.deliverDeepLink("nu-e-url"), /deep link invalid/);
  } finally {
    link.dispose();
  }
});

test("meniul este definit de aplicatie si comenzile vin inapoi ca evenimente", async () => {
  const link = connect(manifestWith());
  try {
    await link.app.call("menu.set", {
      items: [
        { id: "file.new", label: "Fisier nou", accelerator: "Ctrl+N" },
        { id: "file.quit", label: "Iesire" },
      ],
    });
    assert.deepEqual(link.host.menu.map((item) => item.id), ["file.new", "file.quit"]);

    const comenzi: string[] = [];
    link.app.on("menu.command", (payload) => comenzi.push(String(payload["id"])));
    link.host.invokeMenu("file.new");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(comenzi, ["file.new"]);

    assert.throws(() => link.host.invokeMenu("file.inexistent"), /nu exista/);
    await assert.rejects(link.app.call("menu.set", { items: [{ label: "fara id" }] }), /id, label/);
  } finally {
    link.dispose();
  }
});

test("ciclul de viata al host-ului ajunge la aplicatie ca evenimente", async () => {
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

test("actualizarile raporteaza starea canalului si refuza ce nu pot face", async () => {
  const fara = connect(manifestWith());
  try {
    assert.deepEqual(await fara.app.call("update.check"), { available: false, version: "1.0.0", url: null });
    await assert.rejects(fara.app.call("update.apply"), /nicio actualizare/);
  } finally {
    fara.dispose();
  }

  const cu = connect(manifestWith(), {
    availableUpdate: { version: "1.1.0", url: "https://actualizari.exemplu.com/1.1.0" },
  });
  try {
    assert.equal((await cu.app.call<{ version: string }>("update.check")).version, "1.1.0");
    assert.deepEqual(await cu.app.call("update.apply"), { applied: true, version: "1.1.0" });
    assert.equal(cu.host.lifecycle.state, "stopped", "aplicarea opreste aplicatia pentru repornire");
  } finally {
    cu.dispose();
  }

  const magazin = connect(manifestWith({ update: { feed: null, channel: "stable" } }), {
    availableUpdate: { version: "1.1.0", url: "https://x" },
  });
  try {
    await assert.rejects(magazin.app.call("update.apply"), /magazin/);
  } finally {
    magazin.dispose();
  }
});

test("jurnalul de audit al host-ului retine fiecare apel, permis sau refuzat", async () => {
  const channel = createMemoryChannel();
  const audit: Array<{ method: string; granted: boolean }> = [];
  const host = createDesktopHost({
    manifest: manifestWith(),
    transport: channel.host,
    onAudit: (entry) => audit.push({ method: entry.method, granted: entry.granted }),
  });
  // Punte care pretinde capabilitati pe care manifestul nu le da: host-ul decide.
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

test("pe desktop nu exista stiva de navigare: aplicatia conduce ferestrele", async () => {
  const link = connect(manifestWith());
  try {
    // Metoda este permisa de protocol pe orice tinta, dar adaptorul desktop nu
    // are ce raspunde: acolo navigarea se face per fereastra, prin window.navigate.
    await assert.rejects(
      link.app.call("navigation.current"),
      (error: unknown) => (error as { code: string }).code === "raptor:host/unimplemented",
    );
  } finally {
    link.dispose();
  }
});
