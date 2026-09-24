import test from "node:test";
import assert from "node:assert/strict";
import { requireHostManifest } from "@raptor/host";
import type { HostManifest } from "@raptor/host";
import { MOBILE_BACKENDS, mobileBackend, planMobilePackages } from "../src/index.ts";

function manifest(patch: Record<string, unknown> = {}): HostManifest {
  return requireHostManifest(
    JSON.stringify({
      target: "mobile",
      bundleId: "com.exemplu.telefon",
      displayName: "Exemplu",
      version: "3.0.1",
      ...patch,
    }),
  );
}

test("fiecare platforma mobila isi declara WebView-ul, magazinul de secrete si deep link-urile", () => {
  assert.deepEqual(MOBILE_BACKENDS.map((backend) => backend.platform), ["android", "ios"]);
  assert.equal(mobileBackend("android")?.secureStore, "EncryptedSharedPreferences");
  assert.equal(mobileBackend("ios")?.secureStore, "Keychain");
  assert.ok(MOBILE_BACKENDS.every((backend) => backend.deepLinkMechanism.length > 0));
});

test("planul mobil acopera Android si iOS cu numele de artefact asteptate", () => {
  const plan = planMobilePackages(manifest());
  const nume = plan.artifacts.map((artifact) => artifact.filename);
  assert.ok(nume.includes("com.exemplu.telefon-3.0.1-android-universal.aab"));
  assert.ok(nume.includes("com.exemplu.telefon-3.0.1-ios-arm64.ipa"));
  assert.deepEqual(plan.runners, ["macos-latest", "ubuntu-latest"]);
});

test("iOS se construieste doar pe macOS", () => {
  const ios = planMobilePackages(manifest(), { platforms: ["ios"] });
  assert.deepEqual(ios.runners, ["macos-latest"]);
});

test("artefactele de magazin sunt marcate ca atare, nu ca 'semnate de noi'", () => {
  const plan = planMobilePackages(manifest());
  const store = plan.artifacts.filter((artifact) => artifact.signing === "store").map((artifact) => artifact.format);
  assert.deepEqual(store.sort(), ["aab", "ipa"]);
  assert.deepEqual(
    plan.mustSign.filter((name) => name.endsWith(".ipa")),
    [],
    "un ipa nu intra in lista 'trebuie semnat de CI': il semneaza profilul de provisioning",
  );
  assert.ok(plan.mustSign.some((name) => name.endsWith(".apk")), "apk-ul distribuit direct trebuie semnat");
});

test("desktop si mobile nu impart formate", () => {
  const mobil = new Set(planMobilePackages(manifest()).artifacts.map((artifact) => artifact.format));
  for (const format of ["msi", "dmg", "deb", "appimage", "nsis"]) {
    assert.ok(!mobil.has(format), `${format} nu are ce cauta pe mobil`);
  }
});
