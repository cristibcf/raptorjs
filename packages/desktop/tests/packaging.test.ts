import test from "node:test";
import assert from "node:assert/strict";
import { requireHostManifest } from "@raptor/host";
import type { HostManifest } from "@raptor/host";
import { DESKTOP_BACKENDS, DESKTOP_FORMATS, desktopBackend, planDesktopPackages, runtimeRequirements } from "../src/index.ts";

function manifest(patch: Record<string, unknown> = {}): HostManifest {
  return requireHostManifest(
    JSON.stringify({
      target: "desktop",
      bundleId: "com.exemplu.desktop",
      displayName: "Exemplu",
      version: "2.1.0",
      window: { title: "Exemplu" },
      ...patch,
    }),
  );
}

test("exista un back-end de WebView pentru fiecare din cele trei platforme", () => {
  assert.deepEqual(DESKTOP_BACKENDS.map((backend) => backend.platform), ["windows", "macos", "linux"]);
  assert.equal(desktopBackend("windows")?.webview, "WebView2");
  assert.equal(desktopBackend("macos")?.runtimeDependency, null, "WKWebView vine cu sistemul");
  assert.equal(desktopBackend("beos"), undefined);
});

test("planul acopera toate formatele si numeste artefactele determinist", () => {
  const plan = planDesktopPackages(manifest());
  const expected = DESKTOP_FORMATS.reduce((sum, format) => sum + format.architectures.length, 0);
  assert.equal(plan.artifacts.length, expected);
  assert.ok(plan.artifacts.every((artifact) => artifact.filename.startsWith("com.exemplu.desktop-2.1.0-")));
  assert.ok(plan.artifacts.some((artifact) => artifact.filename === "com.exemplu.desktop-2.1.0-windows-x64.msi"));
  assert.ok(plan.artifacts.some((artifact) => artifact.filename === "com.exemplu.desktop-2.1.0-linux-arm64.AppImage"));
});

test("acelasi manifest produce exact acelasi plan", () => {
  assert.deepEqual(planDesktopPackages(manifest()), planDesktopPackages(manifest()));
});

test("planul poate fi restrans la o platforma, iar una inexistenta este eroare", () => {
  const doarWindows = planDesktopPackages(manifest(), { platforms: ["windows"] });
  assert.deepEqual([...new Set(doarWindows.artifacts.map((artifact) => artifact.platform))], ["windows"]);
  assert.deepEqual(doarWindows.runners, ["windows-latest"]);

  assert.throws(
    () => planDesktopPackages(manifest(), { platforms: ["android"] }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
});

test("Windows si macOS nu pot fi publicate nesemnate", () => {
  const plan = planDesktopPackages(manifest());
  const nesemnabile = plan.artifacts.filter((artifact) => artifact.signing !== "required").map((a) => a.platform);
  assert.deepEqual([...new Set(nesemnabile)], ["linux"], "doar pe Linux semnarea ramane optionala");
  assert.equal(plan.mustSign.length, plan.artifacts.filter((artifact) => artifact.platform !== "linux").length);
});

test("matricea de runnere este exact ce ii trebuie CI-ului", () => {
  assert.deepEqual(planDesktopPackages(manifest()).runners, ["macos-latest", "ubuntu-latest", "windows-latest"]);
});

test("o versiune care nu este semver este refuzata inainte de build", () => {
  assert.throws(
    () => planDesktopPackages(manifest({ version: "ultima" })),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
  assert.equal(planDesktopPackages(manifest({ version: "1.0.0-rc.1" })).version, "1.0.0-rc.1");
});

test("cerintele de runtime ale masinii tinta sunt raportate, nu presupuse", () => {
  const toate = runtimeRequirements(planDesktopPackages(manifest()));
  assert.deepEqual(toate.map((requirement) => requirement.platform), ["windows", "linux"]);
  assert.match(toate[0]!.dependency, /WebView2/);

  const doarMac = runtimeRequirements(planDesktopPackages(manifest(), { platforms: ["macos"] }));
  assert.deepEqual(doarMac, [], "macOS nu cere nimic in plus");
});
