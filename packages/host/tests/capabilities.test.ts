import test from "node:test";
import assert from "node:assert/strict";
import {
  HOST_CAPABILITIES,
  availabilityOn,
  capabilitiesFor,
  decideCapability,
  hostCapability,
  requireCapability,
} from "../src/index.ts";

test("matricea transcrie exact tabelul din sectiunea 6", () => {
  // Randurile tabelului sunt contract; daca unul se schimba, se schimba produsul.
  const table = HOST_CAPABILITIES.filter((capability) => capability.source === "table");
  assert.deepEqual(
    table.map((capability) => [capability.id, capability.desktop, capability.mobile]),
    [
      ["app.storage", "granted", "granted"],
      ["net.connect", "granted", "granted"],
      ["window.manage", "granted", "unavailable"],
      ["device.camera", "optional", "optional"],
      ["device.location", "optional", "optional"],
      ["process.spawn", "optional", "unavailable"],
    ],
  );
});

test("fiecare capabilitate poarta politica ei si spune cine o aplica", () => {
  for (const capability of HOST_CAPABILITIES) {
    assert.ok(capability.policy.length > 0, `${capability.id} nu are politica`);
    assert.ok(["host", "runtime"].includes(capability.enforcedBy));
  }
  assert.equal(hostCapability("net.connect")?.enforcedBy, "runtime", "reteaua este aplicata de capability broker");
  assert.equal(hostCapability("app.storage")?.enforcedBy, "host");
  assert.equal(hostCapability("inventata"), undefined);
});

test("ferestrele si subprocesele exista doar pe desktop", () => {
  assert.equal(decideCapability("desktop", "window.manage", []).granted, true);
  assert.equal(decideCapability("mobile", "window.manage", []).granted, false);
  assert.equal(
    decideCapability("mobile", "window.manage", ["window.manage"]).granted,
    false,
    "pe mobil nici declararea explicita nu o aduce la viata",
  );

  assert.equal(decideCapability("desktop", "process.spawn", ["process.spawn"]).granted, true);
  assert.equal(decideCapability("desktop", "process.spawn", []).granted, false, "subprocesele cer lista explicita");
  assert.equal(decideCapability("mobile", "process.spawn", ["process.spawn"]).granted, false);
});

test("modulele optionale cer declarare; cele acordate nu", () => {
  for (const target of ["desktop", "mobile"] as const) {
    assert.equal(decideCapability(target, "app.storage", []).granted, true);
    assert.equal(decideCapability(target, "device.camera", []).granted, false);
    assert.equal(decideCapability(target, "device.camera", ["device.camera"]).granted, true);
    assert.equal(
      decideCapability(target, "device.location", ["device.camera"]).granted,
      false,
      "camera si locatia sunt capabilitati distincte",
    );
  }
});

test("o capabilitate necunoscuta este refuzata, nu ignorata", () => {
  const verdict = decideCapability("desktop", "device.teleport", ["device.teleport"]);
  assert.equal(verdict.granted, false);
  assert.equal(verdict.availability, "unknown");
});

test("requireCapability distinge 'nedeclarata' de 'nu exista pe tinta'", () => {
  assert.throws(
    () => requireCapability("desktop", "device.camera", []),
    (error: unknown) => (error as { code: string }).code === "raptor:host/capability-undeclared",
  );
  assert.throws(
    () => requireCapability("mobile", "process.spawn", ["process.spawn"]),
    (error: unknown) => (error as { code: string }).code === "raptor:host/capability-unavailable",
  );
  assert.equal(requireCapability("desktop", "device.camera", ["device.camera"]).granted, true);
});

test("capabilitatile unei tinte nu includ ce nu exista acolo", () => {
  const mobile = capabilitiesFor("mobile").map((capability) => capability.id);
  assert.ok(!mobile.includes("window.manage"));
  assert.ok(!mobile.includes("process.spawn"));
  assert.ok(mobile.includes("app.storage"));

  const desktop = capabilitiesFor("desktop").map((capability) => capability.id);
  assert.ok(desktop.includes("window.manage"));
  assert.ok(desktop.includes("process.spawn"));
  assert.ok(
    capabilitiesFor("desktop").every((capability) => availabilityOn(capability, "desktop") !== "unavailable"),
  );
});
