import test from "node:test";
import assert from "node:assert/strict";
import { requireHostManifest } from "@raptor/host";
import type { HostManifest } from "@raptor/host";
import { MOBILE_BACKENDS, mobileBackend, planMobilePackages } from "../../src/mobile/index.ts";

function manifest(patch: Record<string, unknown> = {}): HostManifest {
  return requireHostManifest(
    JSON.stringify({
      target: "mobile",
      bundleId: "com.example.phone",
      displayName: "Example",
      version: "3.0.1",
      ...patch,
    }),
  );
}

test("each mobile platform declares its WebView, its secret store and its deep links", () => {
  assert.deepEqual(MOBILE_BACKENDS.map((backend) => backend.platform), ["android", "ios"]);
  assert.equal(mobileBackend("android")?.secureStore, "EncryptedSharedPreferences");
  assert.equal(mobileBackend("ios")?.secureStore, "Keychain");
  assert.ok(MOBILE_BACKENDS.every((backend) => backend.deepLinkMechanism.length > 0));
});

test("the mobile plan covers Android and iOS with the expected artifact names", () => {
  const plan = planMobilePackages(manifest());
  const nume = plan.artifacts.map((artifact) => artifact.filename);
  assert.ok(nume.includes("com.example.phone-3.0.1-android-universal.aab"));
  assert.ok(nume.includes("com.example.phone-3.0.1-ios-arm64.ipa"));
  assert.deepEqual(plan.runners, ["macos-latest", "ubuntu-latest"]);
});

test("iOS builds only on macOS", () => {
  const ios = planMobilePackages(manifest(), { platforms: ["ios"] });
  assert.deepEqual(ios.runners, ["macos-latest"]);
});

test("store artifacts are marked as such, not as 'signed by us'", () => {
  const plan = planMobilePackages(manifest());
  const store = plan.artifacts.filter((artifact) => artifact.signing === "store").map((artifact) => artifact.format);
  assert.deepEqual(store.sort(), ["aab", "ipa"]);
  assert.deepEqual(
    plan.mustSign.filter((name) => name.endsWith(".ipa")),
    [],
    "an ipa does not go into the 'must be signed by CI' list: the provisioning profile signs it",
  );
  assert.ok(plan.mustSign.some((name) => name.endsWith(".apk")), "the directly distributed apk must be signed");
});

test("desktop and mobile do not share formats", () => {
  const mobil = new Set(planMobilePackages(manifest()).artifacts.map((artifact) => artifact.format));
  for (const format of ["msi", "dmg", "deb", "appimage", "nsis"]) {
    assert.ok(!mobil.has(format), `${format} has no place on mobile`);
  }
});
