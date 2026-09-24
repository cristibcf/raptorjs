import test from "node:test";
import assert from "node:assert/strict";
import { createBridge, createMemoryChannel, decodeFrame, encodeFrame, serveHost } from "../src/index.ts";
import type { AuditEntry, HostBridge, HostServer, HostTarget, MethodHandler } from "../src/index.ts";

interface Pair {
  readonly app: HostBridge;
  readonly host: HostServer;
  readonly audit: AuditEntry[];
  dispose(): void;
}

/** Cele doua capete ale granitei, legate prin canalul in memorie. */
function pair(
  target: HostTarget,
  capabilities: readonly string[],
  methods: Record<string, MethodHandler>,
  hostCapabilities = capabilities,
): Pair {
  const channel = createMemoryChannel();
  const audit: AuditEntry[] = [];
  const host = serveHost({
    target,
    capabilities: hostCapabilities,
    transport: channel.host,
    methods,
    onAudit: (entry) => audit.push(entry),
  });
  const app = createBridge({ target, capabilities, transport: channel.app, timeoutMs: 2000 });
  return { app, host, audit, dispose: () => app.dispose("test") };
}

test("un apel permis ajunge la adaptor si se intoarce cu rezultatul", async () => {
  const received: Array<Record<string, unknown>> = [];
  const link = pair("desktop", [], {
    "window.setTitle": (params) => {
      received.push({ ...params });
      return { ok: true };
    },
  });
  try {
    assert.deepEqual(await link.app.call("window.setTitle", { title: "Raptor" }), { ok: true });
    assert.deepEqual(received, [{ title: "Raptor" }]);
  } finally {
    link.dispose();
  }
});

test("un apel fara capabilitate este oprit in JS, inainte sa atinga transportul", async () => {
  const link = pair("desktop", [], { "camera.capture": () => ({ bytes: 0 }) });
  try {
    assert.equal(link.app.allows("camera.capture"), false);
    await assert.rejects(
      link.app.call("camera.capture"),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-undeclared",
    );
    assert.deepEqual(link.audit, [], "host-ul nu a vazut niciun apel");
  } finally {
    link.dispose();
  }
});

test("host-ul refuza singur chiar daca latura JS ar fi ocolita", async () => {
  // Punte care se crede indreptatita, host care stie ca nu este: granita reala
  // este la host, iar testul o exercita trimitand cadrul direct pe transport.
  const channel = createMemoryChannel();
  const audit: AuditEntry[] = [];
  serveHost({
    target: "desktop",
    capabilities: [],
    transport: channel.host,
    methods: { "camera.capture": () => ({ bytes: 1 }) },
    onAudit: (entry) => audit.push(entry),
  });

  const answer = new Promise<Record<string, unknown>>((resolve) => {
    channel.app.onMessage((line) => resolve(decodeFrame(line) as unknown as Record<string, unknown>));
  });
  channel.app.send(encodeFrame({ kind: "call", id: 1, method: "camera.capture", params: {} }));

  const frame = (await answer) as { kind: string; error: { code: string } };
  assert.equal(frame.kind, "failure");
  assert.equal(frame.error.code, "raptor:host/capability-undeclared");
  assert.deepEqual(
    audit.map((entry) => [entry.method, entry.granted]),
    [["camera.capture", false]],
    "refuzul intra in jurnalul de audit al host-ului",
  );
});

test("o metoda inexistenta este raportata ca necunoscuta, cu lista celor valide", async () => {
  const link = pair("desktop", [], {});
  try {
    await assert.rejects(link.app.call("window.teleport"), (error: unknown) => {
      const hostError = error as { code: string; detail: Record<string, unknown> };
      assert.equal(hostError.code, "raptor:host/method-unknown");
      assert.ok((hostError.detail["known"] as string[]).includes("window.open"));
      return true;
    });
  } finally {
    link.dispose();
  }
});

test("o metoda permisa dar neimplementata de adaptor spune exact asta", async () => {
  const link = pair("desktop", [], {});
  try {
    await assert.rejects(link.app.call("window.open", { url: "/" }), (error: unknown) => {
      const hostError = error as { code: string; detail: Record<string, unknown> };
      assert.equal(hostError.code, "raptor:host/unimplemented");
      assert.equal(hostError.detail["hostCode"], "raptor:host/unimplemented");
      return true;
    });
    assert.equal(link.audit[0]?.reason, "neimplementata de acest adaptor");
  } finally {
    link.dispose();
  }
});

test("o eroare a adaptorului ajunge la aplicatie cu codul si mesajul ei", async () => {
  const link = pair("desktop", [], {
    "storage.get": () => {
      throw new Error("discul este plin");
    },
  });
  try {
    await assert.rejects(link.app.call("storage.get", { key: "a" }), /discul este plin/);
  } finally {
    link.dispose();
  }
});

test("apelurile concurente nu isi incurca raspunsurile", async () => {
  const link = pair("desktop", [], {
    "storage.get": async (params) => {
      const key = String(params["key"]);
      // Raspunsurile se intorc in ordine inversa fata de cereri.
      await new Promise((resolve) => setTimeout(resolve, key === "lent" ? 30 : 1));
      return `valoare:${key}`;
    },
  });
  try {
    const [lent, rapid] = await Promise.all([
      link.app.call("storage.get", { key: "lent" }),
      link.app.call("storage.get", { key: "rapid" }),
    ]);
    assert.equal(lent, "valoare:lent");
    assert.equal(rapid, "valoare:rapid");
  } finally {
    link.dispose();
  }
});

test("evenimentele host-ului ajung la ascultatorii aplicatiei", async () => {
  const link = pair("mobile", [], {});
  try {
    const seen: Array<Record<string, unknown>> = [];
    link.app.on("lifecycle.changed", (payload) => seen.push(payload));
    link.host.emit("lifecycle.changed", { state: "background" });
    link.host.emit("deeplink.received", { url: "aplicatie://cale" });

    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(seen, [{ state: "background" }], "un ascultator primeste doar evenimentul lui");
  } finally {
    link.dispose();
  }
});

test("inchiderea puntii respinge apelurile in zbor in loc sa le lase agatate", async () => {
  const link = pair("desktop", [], { "storage.get": () => new Promise(() => undefined) });
  const inFlight = link.app.call("storage.get", { key: "a" });
  link.app.dispose("aplicatia se opreste");

  await assert.rejects(inFlight, (error: unknown) => (error as { code: string }).code === "raptor:host/transport-closed");
  await assert.rejects(
    link.app.call("storage.get", { key: "b" }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/transport-closed",
  );
});

test("un host mut face apelul sa expire, nu sa astepte la nesfarsit", async () => {
  const channel = createMemoryChannel();
  const app = createBridge({ target: "desktop", transport: channel.app, timeoutMs: 20 });
  try {
    await assert.rejects(app.call("storage.get", { key: "a" }), (error: unknown) => {
      const hostError = error as { code: string; detail: Record<string, unknown> };
      assert.equal(hostError.code, "raptor:host/transport-closed");
      assert.equal(hostError.detail["timeoutMs"], 20);
      return true;
    });
  } finally {
    app.dispose();
  }
});

test("un cadru corupt este raportat ca eroare de protocol, nu aruncat in aplicatie", async () => {
  const channel = createMemoryChannel();
  const app = createBridge({ target: "desktop", transport: channel.app, timeoutMs: 50 });
  try {
    const problems: Array<Record<string, unknown>> = [];
    app.on("host.protocolError", (payload) => problems.push(payload));
    channel.host.send("{ nu e json");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(problems.length, 1);
    assert.match(String(problems[0]?.["message"]), /JSON/);
  } finally {
    app.dispose();
  }
});

test("metodele de baza nu cer capabilitati pe nicio tinta", async () => {
  for (const target of ["desktop", "mobile"] as const) {
    const link = pair(target, [], { "lifecycle.state": () => "foreground" });
    try {
      assert.equal(link.app.allows("lifecycle.state"), true);
      assert.equal(await link.app.call("lifecycle.state"), "foreground");
    } finally {
      link.dispose();
    }
  }
});

test("host.describe spune ce implementeaza adaptorul, nu doar ce e permis", async () => {
  const link = pair("desktop", ["device.notifications"], {
    "window.open": () => ({ id: "w1" }),
    "storage.get": () => null,
  });
  try {
    const description = await link.app.describe();
    assert.equal(description.target, "desktop");
    assert.deepEqual(description.capabilities, ["device.notifications"]);
    assert.deepEqual(description.implemented, ["host.describe", "storage.get", "window.open"]);
  } finally {
    link.dispose();
  }
});

test("supported() combina capabilitatea cu implementarea", async () => {
  const link = pair("desktop", [], { "window.open": () => ({ id: "w1" }) });
  try {
    const supported = await link.app.supported();
    assert.equal(supported("window.open"), true);
    assert.equal(supported("window.close"), false, "permisa, dar neimplementata de acest adaptor");
    assert.equal(link.app.allows("window.close"), true, "capabilitatea singura ar fi spus 'da'");
    assert.equal(supported("notify.show"), false, "nici implementata, nici permisa");
  } finally {
    link.dispose();
  }
});

test("un adaptor poate inlocui host.describe cu propriul raspuns", async () => {
  const link = pair("desktop", [], {
    "host.describe": () => ({ target: "desktop", capabilities: [], implemented: ["doar-ce-vreau-eu"] }),
  });
  try {
    assert.deepEqual((await link.app.describe()).implemented, ["doar-ce-vreau-eu"]);
  } finally {
    link.dispose();
  }
});

/**
 * Regresie pentru auditul din 2026-09-24 (S9).
 *
 * `plain()` curata `__proto__` / `constructor` / `prototype` doar la primul
 * nivel. `JSON.parse` le produce ca proprietati proprii, deci obiectul decodat
 * era inofensiv in sine - dar primul consumator care face `Object.assign({}, x)`
 * cu un sub-obiect ramas necuratat ar fi declansat setter-ul de prototip.
 */
test("nicio cheie periculoasa nu supravietuieste decodarii, oricat de adanc", () => {
  const frame = decodeFrame(
    JSON.stringify({
      kind: "call",
      id: 1,
      method: "storage.set",
      params: {
        __proto__: { poluat: true },
        adanc: { mai: { __proto__: { poluat: true }, constructor: { poluat: true }, ok: 1 } },
        lista: [{ __proto__: { poluat: true }, valoare: 2 }],
      },
    }),
  ) as unknown as { params: Record<string, unknown> };

  const params = frame.params;
  const adanc = params["adanc"] as Record<string, unknown>;
  const mai = adanc["mai"] as Record<string, unknown>;
  const lista = params["lista"] as Array<Record<string, unknown>>;

  // Cheile au disparut la fiecare nivel, inclusiv in interiorul unui array.
  assert.deepEqual(Object.keys(params).sort(), ["adanc", "lista"]);
  assert.deepEqual(Object.keys(mai), ["ok"]);
  assert.deepEqual(Object.keys(lista[0]!), ["valoare"]);

  // Iar datele utile au trecut neatinse.
  assert.equal(mai["ok"], 1);
  assert.equal(lista[0]!["valoare"], 2);

  // Proba care conteaza: copierea oricareia dintre ele nu atinge prototipul.
  for (const candidate of [params, adanc, mai, lista[0]!]) {
    const copy = Object.assign({}, candidate) as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(copy), Object.prototype, "copia si-a pastrat prototipul");
    assert.equal((copy as { poluat?: unknown }).poluat, undefined);
  }
  assert.equal(({} as { poluat?: unknown }).poluat, undefined, "Object.prototype a ramas curat");
});
