import test from "node:test";
import assert from "node:assert/strict";
import { requireHostManifest } from "@raptor/host";
import type { HostManifest } from "@raptor/host";
import { DESKTOP_BACKENDS, DESKTOP_FORMATS, desktopBackend, planDesktopPackages, runtimeRequirements } from "../../src/desktop/index.ts";

function manifest(patch: Record<string, unknown> = {}): HostManifest {
  return requireHostManifest(
    JSON.stringify({
      target: "desktop",
      bundleId: "com.example.desktop",
      displayName: "Example",
      version: "2.1.0",
      window: { title: "Example" },
      ...patch,
    }),
  );
}

test("there is a WebView back-end for each of the three platforms", () => {
  assert.deepEqual(DESKTOP_BACKENDS.map((backend) => backend.platform), ["windows", "macos", "linux"]);
  assert.equal(desktopBackend("windows")?.webview, "WebView2");
  assert.equal(desktopBackend("macos")?.runtimeDependency, null, "WKWebView comes with the system");
  assert.equal(desktopBackend("beos"), undefined);
});

test("the plan covers all the formats and names the artifacts deterministically", () => {
  const plan = planDesktopPackages(manifest());
  const expected = DESKTOP_FORMATS.reduce((sum, format) => sum + format.architectures.length, 0);
  assert.equal(plan.artifacts.length, expected);
  assert.ok(plan.artifacts.every((artifact) => artifact.filename.startsWith("com.example.desktop-2.1.0-")));
  assert.ok(plan.artifacts.some((artifact) => artifact.filename === "com.example.desktop-2.1.0-windows-x64.msi"));
  assert.ok(plan.artifacts.some((artifact) => artifact.filename === "com.example.desktop-2.1.0-linux-arm64.AppImage"));
});

test("the same manifest produces exactly the same plan", () => {
  assert.deepEqual(planDesktopPackages(manifest()), planDesktopPackages(manifest()));
});

test("the plan can be restricted to one platform, and a nonexistent one is an error", () => {
  const doarWindows = planDesktopPackages(manifest(), { platforms: ["windows"] });
  assert.deepEqual([...new Set(doarWindows.artifacts.map((artifact) => artifact.platform))], ["windows"]);
  assert.deepEqual(doarWindows.runners, ["windows-latest"]);

  assert.throws(
    () => planDesktopPackages(manifest(), { platforms: ["android"] }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
});

test("Windows and macOS cannot be published unsigned", () => {
  const plan = planDesktopPackages(manifest());
  const nesemnabile = plan.artifacts.filter((artifact) => artifact.signing !== "required").map((a) => a.platform);
  assert.deepEqual([...new Set(nesemnabile)], ["linux"], "only on Linux does signing stay optional");
  assert.equal(plan.mustSign.length, plan.artifacts.filter((artifact) => artifact.platform !== "linux").length);
});

test("the runner matrix is exactly what CI needs", () => {
  assert.deepEqual(planDesktopPackages(manifest()).runners, ["macos-latest", "ubuntu-latest", "windows-latest"]);
});

test("a version that is not semver is rejected before the build", () => {
  assert.throws(
    () => planDesktopPackages(manifest({ version: "latest" })),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
  assert.equal(planDesktopPackages(manifest({ version: "1.0.0-rc.1" })).version, "1.0.0-rc.1");
});

test("the target machine's runtime requirements are reported, not assumed", () => {
  const toate = runtimeRequirements(planDesktopPackages(manifest()));
  assert.deepEqual(toate.map((requirement) => requirement.platform), ["windows", "linux"]);
  assert.match(toate[0]!.dependency, /WebView2/);

  const doarMac = runtimeRequirements(planDesktopPackages(manifest(), { platforms: ["macos"] }));
  assert.deepEqual(doarMac, [], "macOS requires nothing extra");
});
