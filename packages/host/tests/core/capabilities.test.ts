import test from "node:test";
import assert from "node:assert/strict";
import {
  HOST_CAPABILITIES,
  availabilityOn,
  capabilitiesFor,
  decideCapability,
  hostCapability,
  requireCapability,
} from "../../src/core/index.ts";

test("the matrix transcribes the section 6 table exactly", () => {
  // The table rows are contract; if one changes, the product changes.
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

test("each capability carries its policy and says who enforces it", () => {
  for (const capability of HOST_CAPABILITIES) {
    assert.ok(capability.policy.length > 0, `${capability.id} has no policy`);
    assert.ok(["host", "runtime"].includes(capability.enforcedBy));
  }
  assert.equal(hostCapability("net.connect")?.enforcedBy, "runtime", "the network is enforced by the capability broker");
  assert.equal(hostCapability("app.storage")?.enforcedBy, "host");
  assert.equal(hostCapability("inventata"), undefined);
});

test("windows and subprocesses exist only on desktop", () => {
  assert.equal(decideCapability("desktop", "window.manage", []).granted, true);
  assert.equal(decideCapability("mobile", "window.manage", []).granted, false);
  assert.equal(
    decideCapability("mobile", "window.manage", ["window.manage"]).granted,
    false,
    "on mobile even an explicit declaration does not bring it to life",
  );

  assert.equal(decideCapability("desktop", "process.spawn", ["process.spawn"]).granted, true);
  assert.equal(decideCapability("desktop", "process.spawn", []).granted, false, "subprocesses require an explicit list");
  assert.equal(decideCapability("mobile", "process.spawn", ["process.spawn"]).granted, false);
});

test("optional modules require declaration; granted ones do not", () => {
  for (const target of ["desktop", "mobile"] as const) {
    assert.equal(decideCapability(target, "app.storage", []).granted, true);
    assert.equal(decideCapability(target, "device.camera", []).granted, false);
    assert.equal(decideCapability(target, "device.camera", ["device.camera"]).granted, true);
    assert.equal(
      decideCapability(target, "device.location", ["device.camera"]).granted,
      false,
      "camera and location are distinct capabilities",
    );
  }
});

test("an unknown capability is denied, not ignored", () => {
  const verdict = decideCapability("desktop", "device.teleport", ["device.teleport"]);
  assert.equal(verdict.granted, false);
  assert.equal(verdict.availability, "unknown");
});

test("requireCapability distinguishes 'undeclared' from 'does not exist on the target'", () => {
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

test("a target's capabilities do not include what does not exist there", () => {
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
