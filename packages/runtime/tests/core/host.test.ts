import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIME_VERSION, createRuntime, loadProject, normalizePath, requireManifest, stableStringify } from "../../src/core/index.ts";
import type { RuntimeManifest } from "../../src/core/index.ts";

interface Fixture {
  readonly root: string;
  readonly manifest: RuntimeManifest;
  dispose(): void;
}

let counter = 0;

/** A real project on disk: the host has no "in-memory" mode, so neither do the tests. */
function project(entrySource: string, manifestPatch: Record<string, unknown> = {}): Fixture {
  const root = normalizePath(mkdtempSync(join(tmpdir(), "raptor-host-")));
  const entry = "./src/main" + ++counter + ".ts";
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, entry), entrySource, "utf8");
  const source = stableStringify({ name: "fixture", version: "1.0.0", entry, ...manifestPatch });
  writeFileSync(join(root, "raptor.runtime.json"), source + "\n", "utf8");
  return { root, manifest: requireManifest(source), dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test("start evaluates the entry point and calls export default with the host context", async () => {
  const fixture = project(
    [
      'export const marker = "loaded";',
      "export default function main(context) {",
      "  globalThis.__raptorTestMain = { name: context.manifest.name, args: [...context.args] };",
      "}",
    ].join("\n"),
  );
  try {
    const host = createRuntime({ projectRoot: fixture.root, manifest: fixture.manifest, args: ["--port", "8080"] });
    const started = await host.start();
    assert.equal(started.namespace["marker"], "loaded");
    assert.ok(started.startupMs >= 0 && started.evaluationMs >= 0);
    assert.deepEqual((globalThis as Record<string, unknown>)["__raptorTestMain"], {
      name: "fixture",
      args: ["--port", "8080"],
    });
    await host.shutdown("test");
  } finally {
    delete (globalThis as Record<string, unknown>)["__raptorTestMain"];
    fixture.dispose();
  }
});

test("raptor: modules are importable from the application's code", async () => {
  const fixture = project(
    [
      'import observe from "raptor:observe";',
      'import { readText } from "raptor:files";',
      "export default async function main() {",
      '  const text = await readText("./raptor.runtime.json");',
      '  observe.log("info", "app.ready", { bytes: text.length });',
      "}",
    ].join("\n"),
  );
  try {
    const host = createRuntime({ projectRoot: fixture.root, manifest: fixture.manifest });
    await host.start();
    const logged = host.events().find((event) => event.name === "app.ready");
    assert.ok(logged, "the application's log reaches the host's observer");
    assert.ok(Number(logged.attributes["bytes"]) > 0, "destructured methods keep their context");
    await host.shutdown("test");
  } finally {
    fixture.dispose();
  }
});

test("a nonexistent host module is denied with a stable code, not searched on disk", async () => {
  const fixture = project(['import "raptor:teleport";', "export default () => undefined;"].join("\n"));
  try {
    const host = createRuntime({ projectRoot: fixture.root, manifest: fixture.manifest });
    await assert.rejects(host.start(), (error: unknown) => {
      const raptor = error as { code: string; detail: Record<string, unknown> };
      assert.equal(raptor.code, "raptor:module/not-found");
      assert.ok(Array.isArray(raptor.detail["available"]));
      return true;
    });
    await host.shutdown("test");
  } finally {
    fixture.dispose();
  }
});

test("an entry point outside the project root is denied", async () => {
  const fixture = project("export default () => undefined;", { entry: "../escape.ts" });
  try {
    const host = createRuntime({ projectRoot: fixture.root, manifest: fixture.manifest });
    await assert.rejects(host.start(), (error: unknown) => (error as { code: string }).code === "raptor:module/not-found");
  } finally {
    fixture.dispose();
  }
});

test("an application error is translated into a Raptor error, with the origin preserved", async () => {
  const fixture = project('throw new TypeError("broken source");');
  try {
    const host = createRuntime({ projectRoot: fixture.root, manifest: fixture.manifest });
    await assert.rejects(host.start(), (error: unknown) => {
      const raptor = error as { code: string; message: string; detail: Record<string, unknown> };
      assert.equal(raptor.code, "raptor:engine/evaluation");
      assert.equal(raptor.detail["origin"], "TypeError");
      assert.match(raptor.message, /broken source/);
      return true;
    });
    await host.shutdown("test");
  } finally {
    fixture.dispose();
  }
});

test("the runtime cannot be started twice", async () => {
  const fixture = project("export default () => undefined;");
  try {
    const host = createRuntime({ projectRoot: fixture.root, manifest: fixture.manifest });
    await host.start();
    await assert.rejects(host.start(), (error: unknown) => (error as { code: string }).code === "raptor:engine/evaluation");
    await host.shutdown("test");
  } finally {
    fixture.dispose();
  }
});

test("shutdown drains the application's tasks and is idempotent", async () => {
  const fixture = project(
    [
      'import tasks from "raptor:tasks";',
      "export default function main() {",
      "  tasks.spawn(async (context) => {",
      "    await new Promise((resolve) => setTimeout(resolve, 40));",
      "    context.throwIfCancelled();",
      "    globalThis.__raptorTestLeak = true;",
      '  }, { name: "fundal" }).catch(() => undefined);',
      "}",
    ].join("\n"),
  );
  try {
    const host = createRuntime({ projectRoot: fixture.root, manifest: fixture.manifest });
    await host.start();
    await host.shutdown("test");
    await host.shutdown("test");
    assert.equal((globalThis as Record<string, unknown>)["__raptorTestLeak"], undefined, "nothing survives the shutdown");
    assert.equal(host.tasks.closed, true);
    assert.equal(host.diagnostics().tasks.active, 0);
  } finally {
    delete (globalThis as Record<string, unknown>)["__raptorTestLeak"];
    fixture.dispose();
  }
});

test("the diagnostics describe the version, the engine, the project, the capabilities and the modules", async () => {
  const fixture = project(
    [
      'import { readText } from "raptor:files";',
      "export default async function main() {",
      '  await readText("./raptor.runtime.json");',
      "}",
    ].join("\n"),
    { capabilities: { "files.read": ["./raptor.runtime.json"] } },
  );
  try {
    const host = createRuntime({ projectRoot: fixture.root, manifest: fixture.manifest });
    await host.start();
    const diagnostics = host.diagnostics();

    assert.equal(diagnostics.runtimeVersion, RUNTIME_VERSION);
    assert.equal(diagnostics.engine.name, "bootstrap");
    assert.equal(diagnostics.project.name, "fixture");
    assert.equal(diagnostics.project.root, fixture.root);
    assert.ok(diagnostics.modules.some((node) => node.kind === "raptor" && node.specifier === "raptor:files"));
    assert.ok(diagnostics.capabilities.usage.some((usage) => usage.capability === "files.read" && usage.granted));
    await host.shutdown("test");
  } finally {
    fixture.dispose();
  }
});

test("the production policy switches the host into strict mode with no extra flag", async () => {
  const fixture = project("export default () => undefined;", { policy: "production" });
  try {
    const host = createRuntime({ projectRoot: fixture.root, manifest: fixture.manifest });
    assert.equal(host.broker.strict, true);
    assert.equal(host.broker.check("files.read", join(fixture.root, "src")).granted, false);
    await host.shutdown("test");
  } finally {
    fixture.dispose();
  }
});

test("loadProject walks up to the manifest and reports its absence with a stable code", async () => {
  const fixture = project("export default () => undefined;");
  try {
    const deep = join(fixture.root, "src", "adanc", "mai-adanc");
    mkdirSync(deep, { recursive: true });
    const loaded = await loadProject(deep);
    assert.equal(loaded.projectRoot, fixture.root);
    assert.equal(loaded.manifest.name, "fixture");

    const orphan = mkdtempSync(join(tmpdir(), "raptor-orfan-"));
    try {
      await assert.rejects(
        loadProject(orphan),
        (error: unknown) => (error as { code: string }).code === "raptor:manifest/missing",
      );
    } finally {
      rmSync(orphan, { recursive: true, force: true });
    }
  } finally {
    fixture.dispose();
  }
});
