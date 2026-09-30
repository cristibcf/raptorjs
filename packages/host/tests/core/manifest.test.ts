import test from "node:test";
import assert from "node:assert/strict";
import { HOST_MANIFEST_FILENAME, parseHostManifest, requireHostManifest } from "../../src/core/index.ts";

const DESKTOP = {
  target: "desktop",
  bundleId: "com.example.app",
  displayName: "Application",
  version: "1.2.0",
  entry: "./index.html",
  capabilities: ["device.notifications"],
  allowedOrigins: ["https://api.example.com"],
  deepLinkSchemes: ["app"],
  window: { title: "Application", width: 1280, height: 800, resizable: true },
  update: { feed: "https://updates.example.com/stable.json", channel: "stable" },
  signing: { team: "Example Inc" },
};

const parse = (patch: Record<string, unknown> = {}): ReturnType<typeof parseHostManifest> =>
  parseHostManifest(JSON.stringify({ ...DESKTOP, ...patch }));

test("the file name is part of the contract", () => {
  assert.equal(HOST_MANIFEST_FILENAME, "raptor.host.json");
});

test("a complete desktop manifest is accepted and normalized", () => {
  const { manifest, issues } = parse();
  assert.deepEqual(issues, []);
  assert.equal(manifest?.target, "desktop");
  assert.equal(manifest?.window?.width, 1280);
  assert.equal(manifest?.signing.bundleId, "com.example.app", "the signing identity follows the bundleId");
  assert.equal(manifest?.signing.team, "Example Inc");
  assert.equal(manifest?.update.channel, "stable");
});

test("missing required fields are all reported at once", () => {
  const { manifest, issues } = parseHostManifest("{}");
  assert.equal(manifest, null);
  assert.deepEqual(issues.map((issue) => issue.path).sort(), ["bundleId", "displayName", "target"]);
});

test("bundleId requires the reverse-DNS form", () => {
  assert.equal(parse({ bundleId: "Application" }).manifest, null);
  assert.equal(parse({ bundleId: "com.example" }).manifest?.bundleId, "com.example");
  assert.match(parse({ bundleId: "com..example" }).issues[0]!.message, /reverse-DNS/);
});

test("the mobile target does not configure windows", () => {
  const mobile = parseHostManifest(
    JSON.stringify({ ...DESKTOP, target: "mobile", window: { title: "x" } }),
  );
  assert.equal(mobile.manifest, null);
  assert.match(mobile.issues[0]!.message, /the adapter controls them/);

  const fara = parseHostManifest(JSON.stringify({ ...DESKTOP, target: "mobile", window: undefined }));
  assert.deepEqual(fara.issues, []);
  assert.equal(fara.manifest?.window, null);
});

test("a capability unavailable on the target is a manifest error, not a silent denial", () => {
  const mobile = parseHostManifest(
    JSON.stringify({ ...DESKTOP, target: "mobile", window: undefined, capabilities: ["process.spawn"] }),
  );
  assert.equal(mobile.manifest, null);
  assert.equal(mobile.issues[0]?.path, "capabilities.process.spawn");

  const necunoscuta = parse({ capabilities: ["device.teleport"] });
  assert.equal(necunoscuta.manifest, null);
  assert.match(necunoscuta.issues[0]!.message, /unknown/);
});

test("an undeclared optional module is not a manifest error, just an absence", () => {
  const { manifest, issues } = parse({ capabilities: [] });
  assert.deepEqual(issues, []);
  assert.deepEqual(manifest?.capabilities, []);
});

test("the update channel rejects http, so the binary cannot be replaced in transit", () => {
  const nesigur = parse({ update: { feed: "http://updates.example.com/x.json" } });
  assert.equal(nesigur.manifest, null);
  assert.match(nesigur.issues[0]!.message, /https/);

  const magazin = parse({ update: { feed: null, channel: "beta" } });
  assert.equal(magazin.manifest?.update.feed, null, "null means distribution through the store");
  assert.equal(magazin.manifest?.update.channel, "beta");
});

test("the allowed origins must be absolute and secure", () => {
  assert.equal(parse({ allowedOrigins: ["/api"] }).manifest, null);
  assert.equal(parse({ allowedOrigins: ["http://api.example.com"] }).manifest, null);
  assert.deepEqual(
    parse({ allowedOrigins: ["http://localhost:5173"] }).manifest?.allowedOrigins,
    ["http://localhost:5173"],
    "localhost stays allowed for development",
  );
});

test("the deep link schemes are validated", () => {
  assert.equal(parse({ deepLinkSchemes: ["My App"] }).manifest, null);
  assert.deepEqual(parse({ deepLinkSchemes: ["app", "raptor-app"] }).manifest?.deepLinkSchemes, [
    "app",
    "raptor-app",
  ]);
});

test("the lists are sorted, so two equivalent manifests produce the same object", () => {
  const a = parse({ capabilities: ["device.location", "device.camera"], deepLinkSchemes: ["b", "a"] }).manifest;
  const b = parse({ capabilities: ["device.camera", "device.location"], deepLinkSchemes: ["a", "b"] }).manifest;
  assert.deepEqual(a, b);
});

test("requireHostManifest gathers the diagnostics into a single error", () => {
  assert.throws(
    () => requireHostManifest("{}"),
    (error: unknown) => {
      const hostError = error as { code: string; detail: { issues?: string[] } };
      assert.equal(hostError.code, "raptor:host/manifest-invalid");
      assert.equal((hostError.detail.issues ?? []).length, 3);
      return true;
    },
  );
  assert.match(parseHostManifest("not json").issues[0]!.message, /invalid JSON/);
});

test("a manifest produced by the parser passes through the parser again, unchanged", () => {
  // Generators write exactly the object returned here; if its serialization were
  // no longer accepted, the generated projects would be invalid from birth.
  for (const patch of [{}, { target: "mobile", window: undefined }, { capabilities: ["device.camera"] }]) {
    const first = parseHostManifest(JSON.stringify({ ...DESKTOP, ...patch })).manifest;
    assert.ok(first, `the base manifest should be valid: ${JSON.stringify(patch)}`);
    const second = parseHostManifest(JSON.stringify(first));
    assert.deepEqual(second.issues, [], JSON.stringify(second.issues));
    assert.deepEqual(second.manifest, first);
  }
});
