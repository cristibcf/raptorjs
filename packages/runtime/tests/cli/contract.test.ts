/**
 * The RaptorRuntime contract suite - the spike's acceptance list
 * (spec section 14), run against the real example in the repository.
 *
 * The spec requires these five checks to become the base suite. They do not
 * test implementation details, but the product's observable behavior: what
 * someone who installs the runtime and gives it a project sees.
 *
 * An honest limitation: the "autonomous launch" check confirms here that the
 * launcher starts as a separate process and reports structured output. The "with
 * no Node.js installed on the machine" part belongs to the native binary and
 * remains the exit criterion of milestone 0 - it cannot be demonstrated by a
 * launcher that runs in bootstrap on the engine already present.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { promisify } from "node:util";
import { normalizePath } from "@raptorstack/runtime";
import { runCli } from "../../src/cli/index.ts";

const run = promisify(execFile);

const PACKAGE_ROOT = normalizePath(join(fileURLToPath(import.meta.url), "..", "..", ".."));
const REPO_ROOT = normalizePath(join(PACKAGE_ROOT, "..", ".."));
const SPIKE_ROOT = join(REPO_ROOT, "examples", "raptor-runtime-spike");
const BINARY = join(PACKAGE_ROOT, "src", "cli", "bin.ts");

async function cli(...argv: string[]) {
  return await runCli(argv, { cwd: SPIKE_ROOT, interactive: false, waitForSignals: false });
}

/** (1) Autonomous launch: the binary starts on its own and reports structured output. */
test("check 1 - the launcher starts as its own process and reports structured output", async () => {
  const { stdout } = await run(process.execPath, [BINARY, "doctor", "--json", "--cwd", SPIKE_ROOT], {
    cwd: REPO_ROOT,
    timeout: 60_000,
  });
  const report = JSON.parse(stdout) as Record<string, Record<string, unknown>>;

  assert.equal(typeof report["environment"]!["runtimeVersion"], "string");
  assert.equal(typeof report["environment"]!["platform"], "string");
  assert.equal(report["project"]!["name"], "raptor-runtime-spike");
  assert.ok(Array.isArray(report["findings"]), "the diagnostics are structured, not free text");
});

/** (2) TypeScript module: a single local module evaluates and reports its result. */
test("check 2 - the TypeScript entry module evaluates without a compile step", async () => {
  const result = await cli("run", "--json");
  assert.equal(result.code, 0, result.out);

  const diagnostics = result.data["diagnostics"] as Record<string, Array<Record<string, unknown>>>;
  const modules = diagnostics["modules"]!;
  assert.ok(
    modules.some((module) => String(module["url"]).endsWith("src/main.ts")),
    "the TypeScript entry point appears in the module graph",
  );
  assert.ok(
    modules.some((module) => module["kind"] === "raptor"),
    "the raptor: modules were resolved as real modules",
  );
});

test("check 2 - the result is reported through structured diagnostics", async () => {
  const events: Array<Record<string, unknown>> = [];
  const result = await cli("trace", "--json");
  assert.equal(result.code, 0, result.out);
  events.push(...((result.data["requests"] as Array<Record<string, unknown>>) ?? []));

  const spanCount = Number(result.data["spanCount"]);
  assert.ok(spanCount > 0, "the run produced trace spans");
  assert.match(String(result.data["trace"]), /trace\.json$/);
});

/** (3) Permission denial: a read outside the declared scope fails clearly. */
test("check 3 - a read outside the declared scope is denied with a clear error", async () => {
  const result = await cli("run", "--json");
  const capabilities = (result.data["diagnostics"] as Record<string, Record<string, unknown>>)["capabilities"]!;
  const usage = capabilities["usage"] as Array<Record<string, unknown>>;

  const denied = usage.filter((entry) => entry["granted"] === false);
  assert.ok(denied.length > 0, "the spike deliberately attempts a disallowed access");
  assert.ok(
    denied.some((entry) => entry["capability"] === "files.read"),
    "the denial is recorded on the correct capability",
  );
  assert.equal(result.code, 0, "the application handles the denial; the runtime does not crash");
});

/** (4) Clean shutdown: after success, after error and after cancellation. */
test("check 4 - shutdown is clean after success, failure and cancellation", async () => {
  const result = await cli("run", "--json");
  const tasks = (result.data["diagnostics"] as Record<string, Record<string, number | boolean>>)["tasks"]!;

  assert.ok(Number(tasks["completed"]) >= 1, "at least one task completed successfully");
  assert.ok(Number(tasks["failed"]) >= 1, "the deliberate failure was recorded as a failure");
  assert.ok(Number(tasks["cancelled"]) >= 1, "the in-flight task was cancelled at shutdown");
  assert.equal(Number(tasks["active"]), 0, "nothing remains in flight after draining");
});

test("check 4 - the binary exits with code 0 after a clean shutdown, without hanging", async () => {
  // If shutdown left a handle open, the call would time out here.
  const { stdout } = await run(process.execPath, [BINARY, "run", "--cwd", SPIKE_ROOT], { cwd: REPO_ROOT, timeout: 60_000 });
  assert.match(stdout, /raptor-runtime-spike/);
});

/** (5) Contract tests: the acceptance list runs and passes through `raptor-runtime test`. */
test("check 5 - the acceptance list runs through `raptor-runtime test`", async () => {
  const result = await cli("test", "--json");
  assert.equal(result.code, 0, result.out);

  const summary = result.data["summary"] as Record<string, number>;
  assert.ok(summary["total"]! >= 5, "the base suite covers at least the five behaviors");
  assert.equal(summary["failed"], 0);

  const cases = result.data["cases"] as Array<Record<string, unknown>>;
  assert.ok(cases.every((item) => typeof item["durationMs"] === "number"), "reporting is structured, with per-case timings");
});

test("check 5 - the filter selects a subset and stays repeatable", async () => {
  const all = await cli("test", "--json");
  const filtered = await cli("test", "--filter", "checks", "--json");
  assert.equal(filtered.code, 0, filtered.out);
  assert.ok(
    (filtered.data["files"] as string[]).length <= (all.data["files"] as string[]).length,
    "the filter cannot add files",
  );

  const again = await cli("test", "--filter", "checks", "--json");
  assert.deepEqual(
    (again.data["cases"] as Array<Record<string, unknown>>).map((item) => [item["file"], item["name"], item["status"]]),
    (filtered.data["cases"] as Array<Record<string, unknown>>).map((item) => [item["file"], item["name"], item["status"]]),
    "the same suite produces the same result on a second run",
  );
});

/** Packaging the spike project stays reproducible (spec sections 8 and 12). */
test("the spike's packaged unit is reproducible and carries the capabilities", async () => {
  const first = await cli("pack", "--out", "./.raptor/pack-test", "--json");
  assert.equal(first.code, 0, first.out);
  const second = await cli("pack", "--out", "./.raptor/pack-test", "--json");

  const bundleOf = (result: typeof first): Record<string, unknown> => result.data["bundle"] as Record<string, unknown>;
  assert.equal(bundleOf(first)["contentIntegrity"], bundleOf(second)["contentIntegrity"]);
  assert.deepEqual(bundleOf(first)["capabilities"], bundleOf(second)["capabilities"]);
  assert.equal(bundleOf(first)["policy"], "development");
});
