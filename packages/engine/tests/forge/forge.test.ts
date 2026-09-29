import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "@raptor/runtime";
import { parseHostManifest } from "@raptor/host";
import { createProject, runForgeCli, TARGETS } from "../../src/forge/index.ts";
import type { AppTarget } from "../../src/forge/index.ts";

function workspace(): { root: string; dispose(): void } {
  const root = mkdtempSync(join(tmpdir(), "raptor-forge-"));
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

function generate(target: AppTarget, name = "Demo App"): { root: string; files: readonly string[]; dispose(): void } {
  const space = workspace();
  const root = join(space.root, "app");
  const project = createProject({ name, target, directory: root });
  return { root, files: project.files, dispose: space.dispose };
}

const read = (root: string, relative: string): string => readFileSync(join(root, relative), "utf8");

test("target contracts keep native hosts separate from the web target", () => {
  assert.equal(TARGETS.web.host, "browser");
  assert.equal(TARGETS.web.hostTarget, null);
  assert.equal(TARGETS.desktop.host, "webview");
  assert.equal(TARGETS.desktop.hostTarget, "desktop");
  assert.equal(TARGETS.mobile.hostTarget, "mobile");
});

test("the generated runtime manifest is one RaptorRuntime actually accepts", () => {
  for (const target of ["web", "desktop", "mobile"] as const) {
    const project = generate(target);
    try {
      const parsed = parseManifest(read(project.root, "raptor.runtime.json"));
      assert.deepEqual(parsed.issues, [], `${target}: ${JSON.stringify(parsed.issues)}`);
      assert.equal(parsed.manifest?.entry, "./src/main.tsx");
      assert.equal(parsed.manifest?.policy, "development");
      assert.ok((parsed.manifest?.capabilities["files.read"] ?? []).includes("./src"));
    } finally {
      project.dispose();
    }
  }
});

test("only native targets get a host boundary, and it parses", () => {
  const web = generate("web");
  try {
    assert.ok(!web.files.includes("raptor.host.json"), "the browser is the host for a web app");
    assert.ok(!existsSync(join(web.root, "hosts")));
    assert.ok(!existsSync(join(web.root, ".github")));
  } finally {
    web.dispose();
  }

  for (const target of ["desktop", "mobile"] as const) {
    const project = generate(target);
    try {
      const parsed = parseHostManifest(read(project.root, "raptor.host.json"));
      assert.deepEqual(parsed.issues, [], `${target}: ${JSON.stringify(parsed.issues)}`);
      assert.equal(parsed.manifest?.target, target);
      assert.equal(parsed.manifest?.bundleId, "com.raptor.app");
      assert.equal(parsed.manifest?.displayName, "Demo App");
      assert.ok(project.files.includes(`hosts/${target}/README.md`));
      assert.ok(project.files.includes(`hosts/${target}/packaging.json`));
    } finally {
      project.dispose();
    }
  }
});

test("desktop declares a window, mobile does not", () => {
  const desktop = generate("desktop");
  try {
    assert.equal(parseHostManifest(read(desktop.root, "raptor.host.json")).manifest?.window?.title, "Demo App");
  } finally {
    desktop.dispose();
  }

  const mobile = generate("mobile");
  try {
    // Section 6: on a phone, navigation belongs to the adapter.
    assert.equal(parseHostManifest(read(mobile.root, "raptor.host.json")).manifest?.window, null);
  } finally {
    mobile.dispose();
  }
});

test("the packaging descriptor lists real artifacts for the target", () => {
  const desktop = generate("desktop");
  try {
    const plan = JSON.parse(read(desktop.root, "hosts/desktop/packaging.json")) as {
      target: string;
      runners: string[];
      mustSign: string[];
      artifacts: Array<{ filename: string; platform: string }>;
    };
    assert.equal(plan.target, "desktop");
    assert.deepEqual(plan.runners, ["macos-latest", "ubuntu-latest", "windows-latest"]);
    assert.ok(plan.artifacts.some((artifact) => artifact.filename === "com.raptor.app-0.1.0-windows-x64.msi"));
    assert.ok(plan.mustSign.length > 0, "Windows and macOS artifacts cannot ship unsigned");
  } finally {
    desktop.dispose();
  }

  const mobile = generate("mobile");
  try {
    const plan = JSON.parse(read(mobile.root, "hosts/mobile/packaging.json")) as {
      artifacts: Array<{ filename: string; platform: string }>;
    };
    assert.deepEqual([...new Set(plan.artifacts.map((artifact) => artifact.platform))].sort(), ["android", "ios"]);
  } finally {
    mobile.dispose();
  }
});

test("the installer workflow is generated from the plan, with a job per platform", () => {
  const project = generate("desktop");
  try {
    const workflow = read(project.root, ".github/workflows/installers.yml");
    for (const runner of ["windows-latest", "macos-latest", "ubuntu-latest"]) {
      assert.ok(workflow.includes(`runs-on: ${runner}`), `missing job for ${runner}`);
    }
    assert.ok(workflow.includes("com.raptor.app-0.1.0-macos-arm64.dmg"), "artifacts come from the plan");
    assert.ok(workflow.includes("RAPTOR_SIGNING_KEY"), "signing secrets are referenced, never defaulted");
    assert.ok(workflow.includes("smoke"), "CI proves the installer works, not just that it was produced");
  } finally {
    project.dispose();
  }
});

test("a mobile workflow never asks a Linux runner to build for iOS", () => {
  const project = generate("mobile");
  try {
    const workflow = read(project.root, ".github/workflows/installers.yml");
    const iosJob = workflow.slice(workflow.indexOf("  ios:"));
    assert.ok(iosJob.startsWith("  ios:\n    runs-on: macos-latest"));
    assert.ok(!iosJob.includes("ubuntu-latest"));
  } finally {
    project.dispose();
  }
});

test("the application source and host readme name the chosen target", () => {
  const project = generate("mobile", "Phone App");
  try {
    assert.match(read(project.root, "src/main.tsx"), /Raptor mobile application/);
    assert.match(read(project.root, "hosts/mobile/README.md"), /Android and iOS/);
    assert.match(read(project.root, "hosts/mobile/README.md"), /com\.raptor\.app/);
  } finally {
    project.dispose();
  }
});

test("a custom bundle id flows into the manifest and the artifact names", () => {
  const space = workspace();
  try {
    const root = join(space.root, "app");
    createProject({ name: "Exemplu", target: "desktop", directory: root, bundleId: "com.exemplu.desktop" });
    assert.equal(parseHostManifest(read(root, "raptor.host.json")).manifest?.bundleId, "com.exemplu.desktop");
    assert.match(read(root, "hosts/desktop/packaging.json"), /com\.exemplu\.desktop-0\.1\.0-windows-x64\.msi/);
  } finally {
    space.dispose();
  }
});

test("an invalid bundle id fails at generation, not at packaging time", () => {
  const space = workspace();
  try {
    assert.throws(
      () => createProject({ name: "Exemplu", target: "desktop", directory: join(space.root, "app"), bundleId: "Nope" }),
      (error: unknown) => (error as { code?: string }).code === "raptor:host/manifest-invalid",
    );
  } finally {
    space.dispose();
  }
});

test("CLI lists targets, rejects an unknown target and refuses a bundle id on web", () => {
  assert.equal(runForgeCli(["targets"]).out, "web\ndesktop\nmobile");
  assert.equal(runForgeCli(["demo", "--target", "space"]).code, 1);

  const web = runForgeCli(["demo", "--bundle-id", "com.exemplu.web"]);
  assert.equal(web.code, 1);
  assert.match(web.out, /no native host/);
});

test("CLI creates a project on disk and reports every file it wrote", () => {
  const space = workspace();
  try {
    const root = join(space.root, "cli-app");
    const result = runForgeCli(["CLI App", "--target", "desktop", "--dir", root]);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /raptor\.host\.json/);
    assert.ok(existsSync(join(root, ".github/workflows/installers.yml")));

    const again = runForgeCli(["CLI App", "--target", "desktop", "--dir", root]);
    assert.equal(again.code, 1);
    assert.match(again.out, /already exists/);
  } finally {
    space.dispose();
  }
});
