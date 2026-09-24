import test from "node:test";
import assert from "node:assert/strict";
import { HOST_MANIFEST_FILENAME, parseHostManifest, requireHostManifest } from "../src/index.ts";

const DESKTOP = {
  target: "desktop",
  bundleId: "com.exemplu.aplicatie",
  displayName: "Aplicatie",
  version: "1.2.0",
  entry: "./index.html",
  capabilities: ["device.notifications"],
  allowedOrigins: ["https://api.exemplu.com"],
  deepLinkSchemes: ["aplicatie"],
  window: { title: "Aplicatie", width: 1280, height: 800, resizable: true },
  update: { feed: "https://actualizari.exemplu.com/stable.json", channel: "stable" },
  signing: { team: "Exemplu SRL" },
};

const parse = (patch: Record<string, unknown> = {}): ReturnType<typeof parseHostManifest> =>
  parseHostManifest(JSON.stringify({ ...DESKTOP, ...patch }));

test("numele fisierului este parte din contract", () => {
  assert.equal(HOST_MANIFEST_FILENAME, "raptor.host.json");
});

test("un manifest desktop complet este acceptat si normalizat", () => {
  const { manifest, issues } = parse();
  assert.deepEqual(issues, []);
  assert.equal(manifest?.target, "desktop");
  assert.equal(manifest?.window?.width, 1280);
  assert.equal(manifest?.signing.bundleId, "com.exemplu.aplicatie", "identitatea de semnare urmeaza bundleId-ul");
  assert.equal(manifest?.signing.team, "Exemplu SRL");
  assert.equal(manifest?.update.channel, "stable");
});

test("campurile obligatorii lipsa sunt raportate toate odata", () => {
  const { manifest, issues } = parseHostManifest("{}");
  assert.equal(manifest, null);
  assert.deepEqual(issues.map((issue) => issue.path).sort(), ["bundleId", "displayName", "target"]);
});

test("bundleId cere forma invers-DNS", () => {
  assert.equal(parse({ bundleId: "Aplicatie" }).manifest, null);
  assert.equal(parse({ bundleId: "com.exemplu" }).manifest?.bundleId, "com.exemplu");
  assert.match(parse({ bundleId: "com..exemplu" }).issues[0]!.message, /invers-DNS/);
});

test("tinta mobile nu configureaza ferestre", () => {
  const mobile = parseHostManifest(
    JSON.stringify({ ...DESKTOP, target: "mobile", window: { title: "x" } }),
  );
  assert.equal(mobile.manifest, null);
  assert.match(mobile.issues[0]!.message, /adaptorul le controleaza/);

  const fara = parseHostManifest(JSON.stringify({ ...DESKTOP, target: "mobile", window: undefined }));
  assert.deepEqual(fara.issues, []);
  assert.equal(fara.manifest?.window, null);
});

test("o capabilitate indisponibila pe tinta este eroare de manifest, nu refuz tacit", () => {
  const mobile = parseHostManifest(
    JSON.stringify({ ...DESKTOP, target: "mobile", window: undefined, capabilities: ["process.spawn"] }),
  );
  assert.equal(mobile.manifest, null);
  assert.equal(mobile.issues[0]?.path, "capabilities.process.spawn");

  const necunoscuta = parse({ capabilities: ["device.teleport"] });
  assert.equal(necunoscuta.manifest, null);
  assert.match(necunoscuta.issues[0]!.message, /necunoscuta/);
});

test("un modul optional nedeclarat nu este o eroare de manifest, doar o lipsa", () => {
  const { manifest, issues } = parse({ capabilities: [] });
  assert.deepEqual(issues, []);
  assert.deepEqual(manifest?.capabilities, []);
});

test("canalul de actualizari refuza http, ca binarul sa nu poata fi inlocuit in tranzit", () => {
  const nesigur = parse({ update: { feed: "http://actualizari.exemplu.com/x.json" } });
  assert.equal(nesigur.manifest, null);
  assert.match(nesigur.issues[0]!.message, /https/);

  const magazin = parse({ update: { feed: null, channel: "beta" } });
  assert.equal(magazin.manifest?.update.feed, null, "null inseamna distributie prin magazin");
  assert.equal(magazin.manifest?.update.channel, "beta");
});

test("originile permise trebuie sa fie absolute si securizate", () => {
  assert.equal(parse({ allowedOrigins: ["/api"] }).manifest, null);
  assert.equal(parse({ allowedOrigins: ["http://api.exemplu.com"] }).manifest, null);
  assert.deepEqual(
    parse({ allowedOrigins: ["http://localhost:5173"] }).manifest?.allowedOrigins,
    ["http://localhost:5173"],
    "localhost ramane permis pentru dezvoltare",
  );
});

test("schemele de deep link sunt validate", () => {
  assert.equal(parse({ deepLinkSchemes: ["Aplicatie Mea"] }).manifest, null);
  assert.deepEqual(parse({ deepLinkSchemes: ["aplicatie", "raptor-app"] }).manifest?.deepLinkSchemes, [
    "aplicatie",
    "raptor-app",
  ]);
});

test("listele sunt sortate, deci doua manifeste echivalente produc acelasi obiect", () => {
  const a = parse({ capabilities: ["device.location", "device.camera"], deepLinkSchemes: ["b", "a"] }).manifest;
  const b = parse({ capabilities: ["device.camera", "device.location"], deepLinkSchemes: ["a", "b"] }).manifest;
  assert.deepEqual(a, b);
});

test("requireHostManifest aduna diagnosticele intr-o singura eroare", () => {
  assert.throws(
    () => requireHostManifest("{}"),
    (error: unknown) => {
      const hostError = error as { code: string; detail: { issues?: string[] } };
      assert.equal(hostError.code, "raptor:host/manifest-invalid");
      assert.equal((hostError.detail.issues ?? []).length, 3);
      return true;
    },
  );
  assert.match(parseHostManifest("nu e json").issues[0]!.message, /JSON invalid/);
});

test("un manifest produs de parser trece din nou prin parser, neschimbat", () => {
  // Generatoarele scriu exact obiectul intors de aici; daca serializarea lui nu
  // ar mai fi acceptata, proiectele generate ar fi invalide din nastere.
  for (const patch of [{}, { target: "mobile", window: undefined }, { capabilities: ["device.camera"] }]) {
    const first = parseHostManifest(JSON.stringify({ ...DESKTOP, ...patch })).manifest;
    assert.ok(first, `manifestul de baza ar trebui valid: ${JSON.stringify(patch)}`);
    const second = parseHostManifest(JSON.stringify(first));
    assert.deepEqual(second.issues, [], JSON.stringify(second.issues));
    assert.deepEqual(second.manifest, first);
  }
});
